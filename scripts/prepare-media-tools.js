const crypto = require('node:crypto')
const fs = require('node:fs')
const https = require('node:https')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
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
  })
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
  const cache = cacheDirectory || path.join(__dirname, '..', 'node_modules', '.cache', 'dj-scrobbler-media-tools')
  await fs.promises.mkdir(destination, { recursive: true })
  for (const asset of assetsFor(platform, arch)) {
    const source = await ensureAsset(asset, cache)
    const output = path.join(destination, asset.output)
    await fs.promises.copyFile(source, output)
    await fs.promises.chmod(output, asset.executable ? 0o755 : 0o644)
    console.log(`[media-tools] ${platform}-${arch}: ${asset.output}`)
  }
  const notice = [
    'DJ Scrobbler bundled media tools',
    '',
    'FFmpeg static binaries: https://github.com/eugeneware/ffmpeg-static',
    'FFmpeg source and license information: https://ffmpeg.org/',
    'yt-dlp binaries and source: https://github.com/yt-dlp/yt-dlp',
    '',
    'The exact component license texts are included beside this notice.',
    '',
  ].join('\n')
  await fs.promises.writeFile(path.join(destination, 'MEDIA-TOOLS-NOTICE.txt'), notice, 'utf8')
}

if (require.main === module) {
  const [platform = process.platform, arch = process.arch, destination] = process.argv.slice(2)
  prepareMediaTools({ platform, arch, destination }).catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}

module.exports = { ensureAsset, openUrl, prepareMediaTools, sha256 }
