const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { BackgroundAudioSource, containedFile, decodeArgs, downloadArgs, runProcess } = require('../lib/background-audio')
const { FakeChild } = require('./helpers/child-process')
const fs = require('node:fs')
const os = require('node:os')

test('background downloader requests one best-audio file and uses the bundled Electron Node runtime', () => {
  const args = downloadArgs('https://www.youtube.com/watch?v=abc', '/tmp/job/source.%(ext)s', '/app/electron')
  assert.deepEqual(args.slice(0, 5), ['--ignore-config', '--no-playlist', '--no-warnings', '--quiet', '--no-progress'])
  assert.deepEqual(args.slice(5, 7), ['--js-runtimes', 'node:/app/electron'])
  assert.deepEqual(args.slice(-2), ['after_move:filepath', 'https://www.youtube.com/watch?v=abc'])
  assert.ok(args.includes('bestaudio'))
})

test('FFmpeg decodes bounded mono float PCM from an arbitrary point', () => {
  assert.deepEqual(decodeArgs('/tmp/source.webm', 42.5, 10), [
    '-hide_banner', '-loglevel', 'error', '-ss', '42.5', '-i', '/tmp/source.webm', '-t', '10',
    '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1',
  ])
})

test('downloaded files must remain inside the exact temporary directory', () => {
  assert.equal(containedFile('/tmp/job', '/tmp/job/source.webm'), path.resolve('/tmp/job/source.webm'))
  assert.throws(() => containedFile('/tmp/job', '/tmp/job-escape/source.webm'), /outside/)
  assert.throws(() => containedFile('/tmp/job', '/tmp/job'), /outside/)
})

test('audio commands collect output until the pipes close after process exit', async () => {
  const child = new FakeChild()
  const pending = runProcess('audio-tool', [], { spawnImpl: () => child })
  child.stdout.write('first')
  child.exit()
  child.stdout.write('-last')
  child.close()
  assert.equal((await pending).stdout.toString(), 'first-last')
})

test('already cancelled audio commands never spawn a process', async () => {
  const controller = new AbortController()
  controller.abort()
  let spawned = false
  await assert.rejects(runProcess('audio-tool', [], {
    signal: controller.signal,
    spawnImpl: () => { spawned = true; return new FakeChild() },
  }), /cancelled/)
  assert.equal(spawned, false)
})

test('audio cancellation waits for shutdown and force-kills an unresponsive process', async () => {
  const child = new FakeChild()
  const controller = new AbortController()
  const pending = runProcess('audio-tool', [], {
    signal: controller.signal,
    spawnImpl: () => child,
    stopTimeoutMs: 10,
  })
  let settled = false
  const result = pending.then(() => { settled = true }, error => { settled = true; return error })
  controller.abort()
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(settled, false)
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'])
  child.exit(null, 'SIGKILL')
  child.close()
  assert.match((await result).message, /cancelled/)
})

test('a missing audio executable rejects without an unhandled process error', async () => {
  await assert.rejects(runProcess(path.join(os.tmpdir(), 'dj-scrobbler-nonexistent-executable'), []), /ENOENT/)
})

test('disposing during audio preparation waits for its process before removing files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-scrobbler-audio-test-'))
  const child = new FakeChild()
  let spawned
  const started = new Promise(resolve => { spawned = resolve })
  const source = new BackgroundAudioSource('https://www.youtube.com/watch?v=test', {
    tempRoot: root,
    ytdlpExecutable: 'audio-tool',
    spawnImpl: () => { spawned(); return child },
  })
  try {
    const preparing = source.prepare()
    const failed = assert.rejects(preparing, /cancelled/)
    await started
    const directory = source.directory
    const disposed = source.dispose()
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(fs.existsSync(directory), true)
    child.exit(null, 'SIGTERM')
    child.close()
    await Promise.all([failed, disposed])
    assert.equal(fs.existsSync(directory), false)
    await assert.rejects(source.prepare(), /cancelled/)
  } finally {
    child.close()
    await source.dispose()
    fs.rmSync(root, { recursive: true, force: true })
  }
})
