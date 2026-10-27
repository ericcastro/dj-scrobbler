const assert = require('node:assert/strict')
const path = require('node:path')
const { runProcess, decodeArgs } = require('../lib/background-audio')
const { resolveMediaTool, developmentMediaToolsDirectory } = require('../lib/media-tools')
const { assertFfmpegMaterials, assertRedistributableFfmpeg } = require('./prepare-media-tools')

async function main() {
  const directory = developmentMediaToolsDirectory()
  const executable = resolveMediaTool('ffmpeg', { isPackaged: false })
  assertRedistributableFfmpeg(executable)
  await assertFfmpegMaterials(directory)
  for (const filename of ['recognition-aac.m4a', 'recognition-opus.webm']) {
    const input = path.join(__dirname, '..', 'tests', 'fixtures', filename)
    const result = await runProcess(executable, decodeArgs(input, 0, 1))
    assert.equal(result.stdout.length, 64_000, `${filename}: expected one second of mono 16kHz float PCM`)
    const samples = new Float32Array(result.stdout.buffer.slice(result.stdout.byteOffset, result.stdout.byteOffset + result.stdout.byteLength))
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
    assert.ok(Number.isFinite(rms) && rms > 0.01, `${filename}: decoded audio must be non-silent`)
    console.log(`[media-runtime] ${process.platform}-${process.arch}: ${filename}, ${samples.length} samples, RMS=${rms.toFixed(4)}`)
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
