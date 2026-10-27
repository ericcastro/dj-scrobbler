const crypto = require('node:crypto')
const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const { execFileSync, spawnSync } = require('node:child_process')
const { assetsFor } = require('./media-tool-assets')

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const input = fs.createReadStream(file)
    input.on('error', reject)
    input.on('data', chunk => hash.update(chunk))
    input.on('end', () => resolve(hash.digest('hex')))
  })
}

function openUrl(url, redirects = 0) {
  if (redirects > 8) return Promise.reject(new Error(`Too many redirects downloading ${url}`))
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'DJ-Scrobbler-build' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume()
        resolve(openUrl(new URL(response.headers.location, url).toString(), redirects + 1))
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`Download failed (${response.statusCode}) for ${url}`))
        return
      }
      resolve(response)
    })
    request.on('error', reject)
    request.setTimeout(30_000, () => request.destroy(new Error('Media-tool download timed out.')))
  })
}

function assertRedistributableFfmpeg(executable, run = spawnSync) {
  const result = run(executable, ['-L'], { encoding: 'utf8', timeout: 15_000 })
  if (result.error) throw result.error
  const report = `${result.stdout || ''}\n${result.stderr || ''}`
  if (result.status !== 0 || /--enable-nonfree|nonfree and unredistributable|not legally redistributable/i.test(report)) {
    throw new Error('Refusing to bundle FFmpeg: its license report failed or marks this binary as nonfree/unredistributable.')
  }
  if (!/GNU\s+(?:Lesser\s+)?General\s+Public\s+License/i.test(report)) throw new Error('FFmpeg did not report a recognized license.')
}

function buildRecipeFor(platform) {
  return platform === 'darwin' ? 'build-mac-ffmpeg.sh' : 'build-decoder-ffmpeg.sh'
}

async function assertFfmpegMaterials(directory, platform = process.platform) {
  const [source, license] = assetsFor('darwin', 'arm64')
  for (const [filename, expected] of [['ffmpeg-SOURCE.tar.xz', source.sha256], ['ffmpeg.LICENSE', license.sha256]]) {
    if (await sha256(path.join(directory, filename)) !== expected) {
      throw new Error(`FFmpeg redistribution material does not match its pin: ${filename}`)
    }
  }
  const recipe = await fs.promises.readFile(path.join(directory, 'ffmpeg-BUILD.sh'))
  if (!recipe.equals(await fs.promises.readFile(path.join(__dirname, buildRecipeFor(platform))))) {
    throw new Error('The bundled FFmpeg build recipe is missing or outdated.')
  }
  for (const filename of ['FFmpeg-README.txt', 'THIRD_PARTY_NOTICES.md', 'DJ-Scrobbler.LICENSE', 'Electron.LICENSE', 'Chromium.LICENSES.html']) {
    if (!(await fs.promises.stat(path.join(directory, filename))).size) throw new Error(`Missing redistribution notice: ${filename}`)
  }
  if (platform === 'win32' && !(await fs.promises.readdir(path.join(directory, 'toolchain-licenses'))).length) {
    throw new Error('Missing Windows compiler/runtime notices.')
  }
}

async function buildFfmpeg(archive, platform, arch, cache) {
  const script = path.join(__dirname, buildRecipeFor(platform))
  const buildKey = crypto.createHash('sha256').update(await sha256(archive)).update(await fs.promises.readFile(script)).digest('hex')
  const output = path.resolve(cache, platform === 'darwin' ? `${buildKey}-${arch}-ffmpeg` : `${buildKey}-${platform}-${arch}-ffmpeg`)
  if (!fs.existsSync(output)) {
    const temporary = `${output}.${process.pid}.build`
    try {
      if (platform === 'darwin') {
        execFileSync('/bin/bash', [script, archive, arch, temporary], { stdio: 'inherit' })
      } else {
        const bash = platform === 'win32' ? (process.env.DJ_SCROBBLER_BUILD_BASH || 'bash.exe') : '/bin/bash'
        execFileSync(bash, ['-s', '--', archive, platform, arch, temporary], {
          input: await fs.promises.readFile(script),
          stdio: ['pipe', 'inherit', 'inherit'],
        })
      }
      await fs.promises.rename(temporary, output)
    } finally {
      await fs.promises.rm(temporary, { force: true })
    }
  }
  return output
}

async function ensureAsset(asset, cacheDirectory) {
  const cachePath = path.join(cacheDirectory, `${asset.sha256}-${path.basename(asset.output)}`)
  if (fs.existsSync(cachePath) && await sha256(cachePath) === asset.sha256) return cachePath
  const temporary = `${cachePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.download`
  await fs.promises.mkdir(cacheDirectory, { recursive: true })
  try {
    await pipeline(await openUrl(asset.url), fs.createWriteStream(temporary, { mode: asset.executable ? 0o755 : 0o644 }))
    const digest = await sha256(temporary)
    if (digest !== asset.sha256) throw new Error(`Checksum mismatch for ${asset.tool}: expected ${asset.sha256}, received ${digest}`)
    if (fs.existsSync(cachePath) && await sha256(cachePath) === asset.sha256) {
      await fs.promises.rm(temporary, { force: true })
    } else {
      await fs.promises.rm(cachePath, { force: true })
      await fs.promises.rename(temporary, cachePath)
    }
    if (asset.executable) await fs.promises.chmod(cachePath, 0o755)
    return cachePath
  } finally {
    await fs.promises.rm(temporary, { force: true }).catch(() => {})
  }
}

async function prepareMediaTools({ platform, arch, destination, cacheDirectory }) {
  if (!destination) throw new Error('A media-tool destination is required.')
  const cache = path.resolve(cacheDirectory || path.join(__dirname, '..', 'node_modules', '.cache', 'dj-scrobbler-media-tools'))
  await fs.promises.mkdir(destination, { recursive: true })
  for (const asset of assetsFor(platform, arch)) {
    const downloaded = await ensureAsset(asset, cache)
    const source = asset.buildFromSource ? await buildFfmpeg(downloaded, platform, arch, cache) : downloaded
    if (asset.buildFromSource) {
      await fs.promises.copyFile(downloaded, path.join(destination, 'ffmpeg-SOURCE.tar.xz'))
      await fs.promises.copyFile(path.join(__dirname, buildRecipeFor(platform)), path.join(destination, 'ffmpeg-BUILD.sh'))
    }
    const output = path.join(destination, asset.output)
    await fs.promises.copyFile(source, output)
    await fs.promises.chmod(output, asset.executable || asset.buildFromSource ? 0o755 : 0o644)
    if (asset.tool === 'ffmpeg' && platform === process.platform && arch === process.arch) assertRedistributableFfmpeg(output)
    console.log(`[media-tools] ${platform}-${arch}: ${asset.output}`)
  }
  const notice = [
    'DJ Scrobbler bundled media tools',
    '',
    'FFmpeg copyright (c) 2000-2023 the FFmpeg developers.',
    'FFmpeg source and license information: https://ffmpeg.org/',
    'FFmpeg is built from the included source archive using ffmpeg-BUILD.sh (LGPL 2.1 or later).',
    'GPL and nonfree components are disabled. Windows/Linux use a decoder-only build for recognition.',
    'yt-dlp binaries and source: https://github.com/yt-dlp/yt-dlp',
    '',
    'The exact component license texts are included beside this notice.',
    'See THIRD_PARTY_NOTICES.md and FFmpeg-README.txt for attribution, source, and replacement information.',
    '',
  ].join('\n')
  await fs.promises.writeFile(path.join(destination, 'MEDIA-TOOLS-NOTICE.txt'), notice, 'utf8')
  await fs.promises.copyFile(path.join(__dirname, '..', 'LICENSE'), path.join(destination, 'DJ-Scrobbler.LICENSE'))
  await fs.promises.copyFile(path.join(__dirname, '..', 'THIRD_PARTY_NOTICES.md'), path.join(destination, 'THIRD_PARTY_NOTICES.md'))
  // electron-builder removes these top-level distribution files on macOS.
  // Preserve the official runtime's notices explicitly in the accessible folder.
  const electronDist = path.join(path.dirname(require.resolve('electron/package.json')), 'dist')
  await fs.promises.copyFile(path.join(electronDist, 'LICENSE'), path.join(destination, 'Electron.LICENSE'))
  await fs.promises.copyFile(path.join(electronDist, 'LICENSES.chromium.html'), path.join(destination, 'Chromium.LICENSES.html'))
  if (platform === 'win32') {
    if (!process.env.DJ_SCROBBLER_TOOLCHAIN_LICENSES) throw new Error('Set DJ_SCROBBLER_TOOLCHAIN_LICENSES to the MSYS2 UCRT64 share/licenses directory.')
    await fs.promises.cp(process.env.DJ_SCROBBLER_TOOLCHAIN_LICENSES, path.join(destination, 'toolchain-licenses'), { recursive: true, dereference: true })
  }
  const rebuild = platform === 'darwin'
    ? 'bash "$PWD/ffmpeg-BUILD.sh" "$PWD/ffmpeg-SOURCE.tar.xz" arm64 "$PWD/ffmpeg-rebuilt"'
    : `bash "$PWD/ffmpeg-BUILD.sh" "$PWD/ffmpeg-SOURCE.tar.xz" ${platform} ${arch} "$PWD/ffmpeg-rebuilt${platform === 'win32' ? '.exe' : ''}"`
  const instructions = [
    'FFmpeg 6.1.1 - LGPL version 2.1 or later',
    'Copyright (c) 2000-2023 the FFmpeg developers. No warranty; see ffmpeg.LICENSE.',
    '',
    'Source changes: none. Complete original source and notices: ffmpeg-SOURCE.tar.xz.',
    platform === 'darwin'
      ? 'Prerequisites: macOS 11 or later, Xcode Command Line Tools (clang, SDK, make). Use x64 instead of arm64 for Intel.'
      : (platform === 'win32'
          ? 'Prerequisites: MSYS2 UCRT64 with mingw-w64-ucrt-x86_64-gcc, make, diffutils, tar, xz.'
          : 'Prerequisites: native Linux gcc, make, binutils, tar, xz.'),
    'From a writable copy of this directory, rebuild with absolute paths:',
    `  ${rebuild}`,
    'The recipe contains all configure flags. GPL/nonfree components and dependency autodetection are disabled.',
    platform === 'darwin'
      ? 'Apple VideoToolbox supplies H.264 encoding for experimental macOS casting.'
      : 'This build decodes files to float PCM for recognition; casting is unavailable on Windows/Linux in this release.',
    '',
    'Set DJ_SCROBBLER_FFMPEG to the absolute path of a compatible rebuilt executable before launching DJ Scrobbler.',
    'Quit any already-running instance first. This does not require modifying the signed app bundle.',
    '',
    'This software is based in part on the work of the Independent JPEG Group.',
    'The upstream JPEG-derived files are unmodified.',
  ]
  await fs.promises.writeFile(path.join(destination, 'FFmpeg-README.txt'), `${instructions.join('\n')}\n`, 'utf8')
  await assertFfmpegMaterials(destination, platform)
}

if (require.main === module) {
  const [platform = process.platform, arch = process.arch, destination] = process.argv.slice(2)
  prepareMediaTools({ platform, arch, destination }).catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { assertFfmpegMaterials, assertRedistributableFfmpeg, buildFfmpeg, ensureAsset, openUrl, prepareMediaTools, sha256 }
