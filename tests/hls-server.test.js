const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  collectLanIpv4Addresses,
  parseByteRange,
  startHlsServer,
} = require('../lib/hls-server')

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-scrobbler-hls-test-'))
  fs.writeFileSync(path.join(directory, 'index.m3u8'), '#EXTM3U\n#EXTINF:1,\nsegment-000001.ts\n')
  fs.writeFileSync(path.join(directory, 'segment-000001.ts'), Buffer.from('0123456789'))
  return directory
}

test('LAN address selection returns unique external IPv4 addresses', () => {
  assert.deepEqual(collectLanIpv4Addresses({
    lo0: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    en0: [
      { family: 'IPv6', address: 'fe80::1', internal: false },
      { family: 'IPv4', address: '192.168.1.50', internal: false },
    ],
    bridge: [{ family: 4, address: '192.168.1.50', internal: false }],
  }), ['192.168.1.50'])
})

test('byte ranges accept normal, open, and suffix forms', () => {
  assert.deepEqual(parseByteRange('bytes=2-5', 10), { start: 2, end: 5 })
  assert.deepEqual(parseByteRange('bytes=7-', 10), { start: 7, end: 9 })
  assert.deepEqual(parseByteRange('bytes=-3', 10), { start: 7, end: 9 })
  assert.equal(parseByteRange('bytes=20-30', 10), null)
  assert.equal(parseByteRange('bytes=5-2', 10), null)
  assert.equal(parseByteRange('nonsense', 10), null)
})

test('HLS server exposes only tokenized media with receiver-friendly headers and ranges', async () => {
  const directory = fixture()
  const server = await startHlsServer({
    directory,
    token: 'known-token',
    host: '127.0.0.1',
    networkInterfaces: {
      en0: [{ family: 'IPv4', address: '192.168.4.20', internal: false }],
    },
  })
  try {
    assert.equal(server.playbackUrls.length, 1)
    assert.match(server.playbackUrls[0], /^http:\/\/192\.168\.4\.20:\d+\/cast\/known-token\/index\.m3u8$/)

    const playlist = await fetch(server.localUrl)
    assert.equal(playlist.status, 200)
    assert.equal(playlist.headers.get('content-type'), 'application/vnd.apple.mpegurl')
    assert.equal(playlist.headers.get('access-control-allow-origin'), '*')
    assert.match(playlist.headers.get('cache-control'), /no-store/)
    assert.match(await playlist.text(), /segment-000001\.ts/)

    const segmentUrl = server.localUrl.replace('index.m3u8', 'segment-000001.ts')
    const partial = await fetch(segmentUrl, { headers: { Range: 'bytes=2-5' } })
    assert.equal(partial.status, 206)
    assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10')
    assert.equal(await partial.text(), '2345')

    const head = await fetch(segmentUrl, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('content-length'), '10')
    assert.equal(await head.text(), '')

    assert.equal((await fetch(server.localUrl.replace('known-token', 'wrong-token'))).status, 404)
    assert.equal((await fetch(server.localUrl.replace('index.m3u8', '..%2Fpackage.json'))).status, 404)
    assert.equal((await fetch(server.localUrl, { method: 'POST' })).status, 405)
  } finally {
    await server.stop()
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('HLS server requires an explicit existing output directory', async () => {
  await assert.rejects(startHlsServer(), /output directory is required/)
  await assert.rejects(
    startHlsServer({ directory: path.join(os.tmpdir(), 'missing-dj-scrobbler-hls-output') }),
    /does not exist/
  )
})
