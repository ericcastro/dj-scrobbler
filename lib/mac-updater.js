/**
 * Custom macOS self-updater for unsigned (ad-hoc signed) builds.
 *
 * Why not electron-updater / Squirrel.Mac:
 *   Squirrel's ShipIt helper validates the Apple code signature of the
 *   downloaded app before installing it. Our builds are ad-hoc signed
 *   (see scripts/afterPack.js), so ShipIt always refuses — auto-update
 *   silently breaks on macOS.
 *
 * Why this works without the `xattr -dr com.apple.quarantine` hack:
 *   The com.apple.quarantine attribute is only applied by apps that opt in
 *   (browsers, Mail, etc. via LSFileQuarantineEnabled). Files downloaded by
 *   our own process never receive it, so the swapped-in app launches without
 *   any Gatekeeper prompt. We still strip the attribute defensively in case
 *   the zip itself carries one.
 *
 * Flow:
 *   1. pickMacZipAsset()     — choose the right `-mac.zip` release asset for
 *                              the current CPU architecture.
 *   2. stageUpdate()         — download the zip, extract with `ditto -xk`,
 *                              verify the bundle version, strip quarantine.
 *   3. installAndRelaunch()  — spawn a detached shell script that waits for
 *                              the app to quit, swaps the bundle (keeping a
 *                              backup to roll back on failure), and relaunches.
 */

const { spawn, execFile } = require('child_process')
const fs = require('fs')
const path = require('path')
const https = require('https')
const { cleanVersion } = require('./update-utils')

// Positional args: parent PID, staged .app path, target .app path, log file.
// Paths are passed as arguments (never interpolated) so spaces are safe.
const INSTALL_SCRIPT = `#!/bin/bash
# DJ Scrobbler update helper — swaps the app bundle after the app exits.
set -u
PID="$1"; STAGED="$2"; TARGET="$3"; LOG="$4"
exec >>"$LOG" 2>&1
echo "[$(date '+%Y-%m-%dT%H:%M:%S')] waiting for pid $PID to exit"
for i in $(seq 1 300); do
  /bin/kill -0 "$PID" 2>/dev/null || break
  sleep 0.2
done
if /bin/kill -0 "$PID" 2>/dev/null; then
  echo "app still running after 60s; aborting update"
  exit 1
fi
sleep 0.3
echo "swapping $TARGET"
BACKUP="\${TARGET%.app}.update-backup.app"
/bin/rm -rf "$BACKUP"
if [ -e "$TARGET" ]; then
  /bin/mv "$TARGET" "$BACKUP" || { echo "could not move old app aside"; exit 1; }
fi
if /bin/mv "$STAGED" "$TARGET" 2>/dev/null || /usr/bin/ditto "$STAGED" "$TARGET"; then
  /usr/bin/xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
  /bin/rm -rf "$BACKUP"
  echo "relaunching"
  /usr/bin/open "$TARGET"
  echo "done"
else
  echo "install failed; restoring previous version"
  /bin/rm -rf "$TARGET"
  [ -e "$BACKUP" ] && /bin/mv "$BACKUP" "$TARGET"
  /usr/bin/open "$TARGET"
  exit 1
fi
`

// electron-builder names mac zips `<name>-<version>-arm64-mac.zip` for Apple
// Silicon and `<name>-<version>-mac.zip` (no arch marker) for Intel.
function pickMacZipAsset(assets, arch = process.arch) {
  const zips = (Array.isArray(assets) ? assets : []).filter(asset => {
    const name = String(asset?.name || '').toLowerCase()
    return asset?.browser_download_url && name.endsWith('.zip') && name.includes('mac')
  })
  if (!zips.length) return null
  const arm = zips.find(a => /arm64|aarch64/i.test(a.name))
  const universal = zips.find(a => /universal/i.test(a.name))
  const x64 = zips.find(a => !/arm64|aarch64|universal/i.test(a.name))
  // On Apple Silicon an x64 build still runs under Rosetta, so it is a valid
  // last resort; an arm64 build on an Intel Mac would not launch at all.
  if (arch === 'arm64') return arm || universal || x64 || null
  return x64 || universal || null
}

// <Bundle>.app/Contents/MacOS/<binary> → <Bundle>.app
function appBundleFromExecPath(execPath) {
  const bundle = path.resolve(String(execPath || ''), '..', '..', '..')
  return bundle.endsWith('.app') ? bundle : null
}

function runningAppBundlePath() {
  return appBundleFromExecPath(process.execPath)
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf8' }, (err, stdout) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

function downloadFile(url, dest, { onProgress = () => {}, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'DJ-Scrobbler-updater', Accept: 'application/octet-stream' },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        if (redirects >= 5) return reject(new Error('Too many redirects while downloading the update.'))
        return downloadFile(res.headers.location, dest, { onProgress, redirects: redirects + 1 }).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`Update download failed with HTTP ${res.statusCode}.`))
      }
      const total = Number(res.headers['content-length']) || 0
      let received = 0
      let lastPct = -1
      const out = fs.createWriteStream(dest)
      res.on('data', chunk => {
        received += chunk.length
        if (!total) return
        const pct = Math.floor((received / total) * 100)
        if (pct !== lastPct) {
          lastPct = pct
          onProgress(pct, received, total)
        }
      })
      res.pipe(out)
      out.on('finish', () => out.close(() => resolve(dest)))
      res.on('error', err => { out.destroy(); reject(err) })
      out.on('error', reject)
    })
    req.on('error', reject)
  })
}

function findAppBundle(dir) {
  try {
    const entry = fs.readdirSync(dir).find(name => name.endsWith('.app'))
    return entry ? path.join(dir, entry) : null
  } catch {
    return null
  }
}

async function readBundleVersion(appPath) {
  try {
    const out = await run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-',
      path.join(appPath, 'Contents', 'Info.plist')])
    return out.trim()
  } catch {
    return null
  }
}

async function stageUpdate({ url, version, dir, log = () => {}, onProgress = () => {} }) {
  if (!url) throw new Error('No macOS download was found in the latest release.')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })

  const zipPath = path.join(dir, 'update.zip')
  log('[mac-updater] downloading', url)
  await downloadFile(url, zipPath, { onProgress })

  const extractDir = path.join(dir, 'extracted')
  fs.mkdirSync(extractDir, { recursive: true })
  log('[mac-updater] extracting', zipPath)
  await run('/usr/bin/ditto', ['-xk', zipPath, extractDir])

  const appPath = findAppBundle(extractDir)
  if (!appPath) throw new Error('The downloaded update did not contain an app bundle.')

  const bundleVersion = await readBundleVersion(appPath)
  if (version && bundleVersion && cleanVersion(bundleVersion) !== cleanVersion(version)) {
    throw new Error(`The downloaded app is version ${bundleVersion}, expected ${version}.`)
  }

  await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', appPath]).catch(() => {})
  fs.rmSync(zipPath, { force: true })
  log('[mac-updater] staged', appPath)
  return appPath
}

function installAndRelaunch({ stagedAppPath, targetAppPath, dir, log = () => {} }) {
  const scriptPath = path.join(dir, 'install-update.sh')
  const logPath = path.join(dir, 'install-update.log')
  fs.writeFileSync(scriptPath, INSTALL_SCRIPT, { mode: 0o755 })
  log('[mac-updater] handing off to install helper', scriptPath)
  const child = spawn('/bin/bash', [scriptPath, String(process.pid), stagedAppPath, targetAppPath, logPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  return child
}

module.exports = {
  INSTALL_SCRIPT,
  pickMacZipAsset,
  appBundleFromExecPath,
  runningAppBundlePath,
  stageUpdate,
  installAndRelaunch,
}
