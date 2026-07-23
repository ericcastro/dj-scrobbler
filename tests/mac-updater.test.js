const test = require('node:test')
const assert = require('node:assert/strict')

const {
  INSTALL_SCRIPT,
  pickMacZipAsset,
  appBundleFromExecPath,
} = require('../lib/mac-updater')

// Asset names as electron-builder actually publishes them (see the v0.5.5
// release): arm64 zips carry an "-arm64-" marker, x64 zips carry none.
const releaseAssets = [
  { name: 'DJ-Scrobbler-0.5.5-arm64-mac.zip', browser_download_url: 'https://example.test/arm64-mac.zip' },
  { name: 'DJ-Scrobbler-0.5.5-arm64.dmg', browser_download_url: 'https://example.test/arm64.dmg' },
  { name: 'DJ-Scrobbler-0.5.5-mac.zip', browser_download_url: 'https://example.test/x64-mac.zip' },
  { name: 'DJ-Scrobbler-0.5.5.dmg', browser_download_url: 'https://example.test/x64.dmg' },
  { name: 'DJ-Scrobbler-Setup-0.5.5.exe', browser_download_url: 'https://example.test/setup.exe' },
  { name: 'DJ-Scrobbler-0.5.5.AppImage', browser_download_url: 'https://example.test/appimage' },
  { name: 'DJ.Scrobbler-0.5.5-arm64-mac.zip.blockmap', browser_download_url: 'https://example.test/blockmap' },
  { name: 'latest-mac.yml', browser_download_url: 'https://example.test/latest-mac.yml' },
]

test('mac update asset picking matches the CPU architecture', () => {
  assert.equal(pickMacZipAsset(releaseAssets, 'arm64').name, 'DJ-Scrobbler-0.5.5-arm64-mac.zip')
  assert.equal(pickMacZipAsset(releaseAssets, 'x64').name, 'DJ-Scrobbler-0.5.5-mac.zip')
})

test('mac update asset picking never selects dmg, blockmap, or yml files', () => {
  const junkOnly = releaseAssets.filter(a => !a.name.endsWith('-mac.zip'))
  assert.equal(pickMacZipAsset(junkOnly, 'arm64'), null)
  assert.equal(pickMacZipAsset(junkOnly, 'x64'), null)
})

test('mac update asset picking falls back across architectures safely', () => {
  const universal = [{ name: 'DJ-Scrobbler-0.6.0-universal-mac.zip', browser_download_url: 'https://example.test/u.zip' }]
  assert.equal(pickMacZipAsset(universal, 'arm64').name, 'DJ-Scrobbler-0.6.0-universal-mac.zip')
  assert.equal(pickMacZipAsset(universal, 'x64').name, 'DJ-Scrobbler-0.6.0-universal-mac.zip')

  // Apple Silicon can run an x64 build under Rosetta as a last resort...
  const x64Only = [{ name: 'DJ-Scrobbler-0.6.0-mac.zip', browser_download_url: 'https://example.test/x.zip' }]
  assert.equal(pickMacZipAsset(x64Only, 'arm64').name, 'DJ-Scrobbler-0.6.0-mac.zip')

  // ...but an Intel Mac must never be handed an arm64 build.
  const armOnly = [{ name: 'DJ-Scrobbler-0.6.0-arm64-mac.zip', browser_download_url: 'https://example.test/a.zip' }]
  assert.equal(pickMacZipAsset(armOnly, 'x64'), null)

  assert.equal(pickMacZipAsset([], 'arm64'), null)
  assert.equal(pickMacZipAsset(undefined, 'arm64'), null)
})

test('app bundle path is derived from the executable path', () => {
  assert.equal(
    appBundleFromExecPath('/Applications/DJ Scrobbler.app/Contents/MacOS/DJ Scrobbler'),
    '/Applications/DJ Scrobbler.app'
  )
  assert.equal(appBundleFromExecPath('/usr/local/bin/node'), null)
  assert.equal(appBundleFromExecPath(''), null)
})

test('install helper script swaps, rolls back on failure, and relaunches', () => {
  // The script receives paths as positional args so spaces never need escaping.
  assert.match(INSTALL_SCRIPT, /PID="\$1"; STAGED="\$2"; TARGET="\$3"; LOG="\$4"/)
  // Waits for the app to exit before touching the bundle.
  assert.match(INSTALL_SCRIPT, /kill -0 "\$PID"/)
  // Keeps a backup and restores it if the swap fails.
  assert.match(INSTALL_SCRIPT, /update-backup\.app/)
  assert.match(INSTALL_SCRIPT, /restoring previous version/)
  // Strips quarantine defensively and relaunches the updated app.
  assert.match(INSTALL_SCRIPT, /xattr -dr com\.apple\.quarantine "\$TARGET"/)
  assert.match(INSTALL_SCRIPT, /open "\$TARGET"/)
})
