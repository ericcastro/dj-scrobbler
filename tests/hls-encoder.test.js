const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { buildHlsOutputArgs, waitForHlsReady } = require('../lib/hls-encoder')

test('HLS encoder uses short aligned segments and a bounded rolling playlist', () => {
  const directory = path.join(os.tmpdir(), 'hls-output')
  const args = buildHlsOutputArgs({ directory, segmentDuration: 1, listSize: 6, frameRate: 30 })
  assert.deepEqual(args.slice(0, 8), ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p'])
  assert.equal(args[args.indexOf('-g') + 1], '30')
  assert.equal(args[args.indexOf('-hls_time') + 1], '1')
  assert.equal(args[args.indexOf('-hls_list_size') + 1], '6')
  assert.match(args[args.indexOf('-hls_flags') + 1], /delete_segments/)
  assert.equal(args.at(-1), path.join(directory, 'index.m3u8'))
})

test('HLS readiness requires both a manifest entry and its completed segment', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-scrobbler-hls-ready-'))
  try {
    fs.writeFileSync(path.join(directory, 'index.m3u8'), '#EXTM3U\n#EXTINF:1,\nsegment-000001.ts\n')
    const pending = waitForHlsReady(directory, { timeoutMs: 1000, pollMs: 10 })
    setTimeout(() => fs.writeFileSync(path.join(directory, 'segment-000001.ts'), 'segment'), 30)
    assert.equal(await pending, path.join(directory, 'index.m3u8'))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('HLS readiness times out with an actionable error', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-scrobbler-hls-timeout-'))
  try {
    await assert.rejects(
      waitForHlsReady(directory, { timeoutMs: 30, pollMs: 10 }),
      /did not become ready within 30ms/
    )
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
