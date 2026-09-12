const crypto = require('node:crypto')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const CONTENT_TYPES = new Map([
  ['.m3u8', 'application/vnd.apple.mpegurl'],
  ['.ts', 'video/mp2t'],
  ['.m4s', 'video/iso.segment'],
  ['.mp4', 'video/mp4'],
  ['.aac', 'audio/aac'],
  ['.vtt', 'text/vtt; charset=utf-8'],
])

function collectLanIpv4Addresses(interfaces = os.networkInterfaces()) {
  const addresses = []
  for (const entries of Object.values(interfaces || {})) {
    for (const entry of entries || []) {
      const isIpv4 = entry.family === 'IPv4' || entry.family === 4
      if (isIpv4 && !entry.internal && entry.address) addresses.push(entry.address)
    }
  }
  return [...new Set(addresses)].sort()
}

function contentTypeFor(filePath) {
  return CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) || null
}

function parseByteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim())
  if (!match || (!match[1] && !match[2])) return null

  let start
  let end
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) {
    return null
  }
  return { start, end: Math.min(end, size - 1) }
}

function createHlsRequestHandler({ directory, token }) {
  const routePrefix = `/cast/${token}/`
  return async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Range')
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD, OPTIONS')
      response.writeHead(405)
      response.end()
      return
    }

    let pathname
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname)
    } catch {
      response.writeHead(400)
      response.end()
      return
    }

    const filename = pathname.startsWith(routePrefix) ? pathname.slice(routePrefix.length) : ''
    const safeFilename = filename && path.basename(filename) === filename && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(filename)
    const type = safeFilename ? contentTypeFor(filename) : null
    if (!safeFilename || !type) {
      response.writeHead(404)
      response.end()
      return
    }

    const filePath = path.join(directory, filename)
    let stat
    try {
      stat = await fs.promises.stat(filePath)
      if (!stat.isFile()) throw new Error('Not a file')
    } catch {
      response.writeHead(404)
      response.end()
      return
    }

    response.setHeader('Content-Type', type)
    response.setHeader('Accept-Ranges', 'bytes')
    response.setHeader('Cache-Control', path.extname(filename).toLowerCase() === '.m3u8'
      ? 'no-store, no-cache, must-revalidate'
      : 'private, max-age=30')

    const rangeHeader = request.headers.range
    const range = rangeHeader ? parseByteRange(rangeHeader, stat.size) : null
    if (rangeHeader && !range) {
      response.setHeader('Content-Range', `bytes */${stat.size}`)
      response.writeHead(416)
      response.end()
      return
    }

    const start = range?.start ?? 0
    const end = range?.end ?? stat.size - 1
    const contentLength = Math.max(0, end - start + 1)
    response.setHeader('Content-Length', contentLength)
    if (range) {
      response.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`)
      response.writeHead(206)
    } else {
      response.writeHead(200)
    }
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    if (stat.size === 0) {
      response.end()
      return
    }

    const stream = fs.createReadStream(filePath, { start, end })
    stream.on('error', () => response.destroy())
    stream.pipe(response)
  }
}

async function startHlsServer(options = {}) {
  if (!options.directory) throw new Error('An HLS output directory is required')
  const directory = path.resolve(options.directory)
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`HLS output directory does not exist: ${directory}`)
  }

  const token = options.token || crypto.randomBytes(24).toString('base64url')
  const host = options.host || '0.0.0.0'
  const server = http.createServer(createHlsRequestHandler({ directory, token }))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port || 0, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : options.port
  const route = `/cast/${token}/index.m3u8`
  const lanAddresses = collectLanIpv4Addresses(options.networkInterfaces)
  const playbackUrls = lanAddresses.map(ip => `http://${ip}:${port}${route}`)

  return {
    token,
    port,
    route,
    localUrl: `http://127.0.0.1:${port}${route}`,
    playbackUrls,
    async stop() {
      if (!server.listening) return
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      server.closeAllConnections?.()
    },
  }
}

module.exports = {
  collectLanIpv4Addresses,
  contentTypeFor,
  createHlsRequestHandler,
  parseByteRange,
  startHlsServer,
}
