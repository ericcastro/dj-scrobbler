const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { containedFile, decodeArgs, downloadArgs } = require('../lib/background-audio')

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
