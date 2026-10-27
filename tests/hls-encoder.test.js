const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { buildHlsOutputArgs, startFfmpegHls, waitForHlsReady } = require('../lib/hls-encoder')
const { FakeChild } = require('./helpers/child-process')

test('HLS encoder uses short aligned segments and a bounded rolling playlist', () => {
  const directory = path.join(os.tmpdir(), 'hls-output')
  const args = buildHlsOutputArgs({ directory, segmentDuration: 1, listSize: 6, frameRate: 30 })
  assert.deepEqual(args.slice(0, 8), ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p'])
  assert.equal(args[args.indexOf('-g') + 1], '30')
  assert.equal(args[args.indexOf('-hls_time') + 1], '1')
  assert.equal(args[args.indexOf('-hls_list_size') + 1], '6')
  assert.equal(args[args.indexOf('-b:v') + 1], '5M')
  assert.equal(args[args.indexOf('-profile:a') + 1], 'aac_low')
  assert.equal(args[args.indexOf('-b:a') + 1], '320k')
  assert.equal(args[args.indexOf('-ar') + 1], '48000')
  assert.equal(args[args.indexOf('-ac') + 1], '2')
  assert.match(args[args.indexOf('-hls_flags') + 1], /delete_segments/)
  assert.equal(args.at(-1), path.join(directory, 'index.m3u8'))
})

test('HLS encoder does not apply an AAC profile to another audio codec', () => {
  const args = buildHlsOutputArgs({
    directory: path.join(os.tmpdir(), 'hls-output'),
    audioCodec: 'libopus',
  })
  assert.equal(args[args.indexOf('-c:a') + 1], 'libopus')
  assert.equal(args.includes('-profile:a'), false)
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

test('HLS readiness is cancellable without waiting for its deadline', async () => {
  const controller = new AbortController()
  const pending = waitForHlsReady(os.tmpdir(), { signal: controller.signal, pollMs: 10_000 })
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('HLS process failures retain stderr and stop readiness polling', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-hls-failure-'))
  try {
    const child = new FakeChild()
    const encoder = startFfmpegHls({ directory, executable: 'ffmpeg', spawnImpl: () => child })
    child.exit(1)
    child.stderr.write('codec failed')
    child.close()
    await assert.rejects(encoder.ready, /codec failed/)
    assert.equal((await encoder.stop()).code, 1)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('missing FFmpeg rejects readiness and still allows cleanup', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-hls-spawn-'))
  try {
    const encoder = startFfmpegHls({ directory, executable: path.join(directory, 'missing-ffmpeg') })
    await assert.rejects(encoder.ready, /ENOENT/)
    assert.equal((await encoder.stop()).error.code, 'ENOENT')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
