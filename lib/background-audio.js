const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { resolveMediaTool } = require('./media-tools')

const SAMPLE_RATE = 16_000
const BYTES_PER_FLOAT = 4

function downloadArgs(sourceUrl, outputTemplate, javascriptRuntime = process.execPath) {
  return [
    '--ignore-config', '--no-playlist', '--no-warnings', '--quiet', '--no-progress',
    '--js-runtimes', `node:${javascriptRuntime}`,
    '--no-keep-video', '-f', 'bestaudio',
    '-o', outputTemplate,
    '--print', 'after_move:filepath',
    sourceUrl,
  ]
}

function decodeArgs(sourcePath, seconds, clipSeconds, sampleRate = SAMPLE_RATE) {
  return [
    '-hide_banner', '-loglevel', 'error',
    '-ss', String(Math.max(0, Number(seconds) || 0)),
    '-i', sourcePath,
    '-t', String(Math.max(1, Number(clipSeconds) || 10)),
    '-vn', '-ac', '1', '-ar', String(sampleRate),
    '-f', 'f32le', 'pipe:1',
  ]
}

function runProcess(executable, args, options = {}) {
  const spawnImpl = options.spawnImpl || spawn
  const maxStdoutBytes = Math.max(1, options.maxStdoutBytes || 1024 * 1024)
  const maxStderrBytes = Math.max(1, options.maxStderrBytes || 128 * 1024)
  const timeoutMs = Math.max(1, options.timeoutMs || 60_000)
  const child = spawnImpl(executable, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: options.env || process.env,
  })
  const stdout = []
  const stderr = []
  let stdoutBytes = 0
  let stderrBytes = 0
  let settled = false

  return new Promise((resolve, reject) => {
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      error ? reject(error) : resolve(value)
    }
    const stop = reason => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      finish(reason)
    }
    const abort = () => stop(new Error(`${path.basename(executable)} was cancelled.`))
    const timer = setTimeout(() => stop(new Error(`${path.basename(executable)} timed out.`)), timeoutMs)
    timer.unref?.()
    options.signal?.addEventListener('abort', abort, { once: true })
    if (options.signal?.aborted) return abort()

    child.once('error', error => finish(error))
    child.stdout.on('data', chunk => {
      stdoutBytes += chunk.length
      if (stdoutBytes > maxStdoutBytes) return stop(new Error(`${path.basename(executable)} produced too much output.`))
      stdout.push(chunk)
    })
    child.stderr.on('data', chunk => {
      stderrBytes += chunk.length
      if (stderrBytes <= maxStderrBytes) stderr.push(chunk)
    })
    child.once('exit', (code, signal) => {
      const errorText = Buffer.concat(stderr).toString('utf8').trim()
      if (code !== 0) return finish(new Error(`${path.basename(executable)} failed (${code ?? signal}): ${errorText || 'no details'}`))
      finish(null, { stdout: Buffer.concat(stdout), stderr: errorText })
    })
  })
}

function containedFile(directory, candidate) {
  const resolvedDirectory = path.resolve(directory)
  const resolvedCandidate = path.resolve(candidate)
  if (resolvedCandidate === resolvedDirectory || !resolvedCandidate.startsWith(`${resolvedDirectory}${path.sep}`)) {
    throw new Error('Media downloader returned a path outside its temporary directory.')
  }
  return resolvedCandidate
}

class BackgroundAudioSource {
  constructor(sourceUrl, options = {}) {
    this.sourceUrl = sourceUrl
    this.options = options
    this.directory = null
    this.sourcePath = null
    this.controller = new AbortController()
    this.preparing = null
  }

  async prepare() {
    if (this.sourcePath) return this.sourcePath
    if (this.preparing) return this.preparing
    this.preparing = this.#prepare().catch(async error => {
      const directory = this.directory
      this.directory = null
      this.preparing = null
      if (directory) await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => {})
      throw error
    })
    return this.preparing
  }

  async #prepare() {
    this.directory = await fs.promises.mkdtemp(path.join(this.options.tempRoot || os.tmpdir(), 'dj-scrobbler-audio-'))
    const template = path.join(this.directory, 'source.%(ext)s')
    const executable = this.options.ytdlpExecutable || resolveMediaTool('yt-dlp')
    const result = await runProcess(executable, downloadArgs(this.sourceUrl, template, this.options.javascriptRuntime), {
      spawnImpl: this.options.spawnImpl,
      // The packaged Electron executable doubles as yt-dlp's Node runtime.
      // This keeps current YouTube extraction self-contained on every OS.
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeoutMs: this.options.downloadTimeoutMs || 30 * 60_000,
      maxStdoutBytes: 64 * 1024,
      signal: this.controller.signal,
    })
    const lines = result.stdout.toString('utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    if (!lines.length) throw new Error('Media downloader did not report an audio file.')
    const sourcePath = containedFile(this.directory, lines[lines.length - 1])
    const stat = await fs.promises.stat(sourcePath)
    if (!stat.isFile() || stat.size === 0) throw new Error('Downloaded audio file is empty.')
    this.sourcePath = sourcePath
    return sourcePath
  }

  async sample(seconds, clipSeconds = 10, sampleRate = SAMPLE_RATE) {
    const sourcePath = await this.prepare()
    const expectedBytes = Math.ceil(Math.max(1, clipSeconds) * sampleRate * BYTES_PER_FLOAT)
    const executable = this.options.ffmpegExecutable || resolveMediaTool('ffmpeg')
    const result = await runProcess(executable, decodeArgs(sourcePath, seconds, clipSeconds, sampleRate), {
      spawnImpl: this.options.spawnImpl,
      timeoutMs: this.options.decodeTimeoutMs || 30_000,
      maxStdoutBytes: expectedBytes + sampleRate * BYTES_PER_FLOAT,
      signal: this.controller.signal,
    })
    if (!result.stdout.length || result.stdout.length % BYTES_PER_FLOAT !== 0) {
      throw new Error('FFmpeg returned empty or malformed PCM audio.')
    }
    const buffer = result.stdout.buffer.slice(result.stdout.byteOffset, result.stdout.byteOffset + result.stdout.byteLength)
    return { samples: new Float32Array(buffer), sampleRate, playbackStartedAt: seconds, playbackEndedAt: seconds + result.stdout.length / BYTES_PER_FLOAT / sampleRate }
  }

  async dispose() {
    this.controller.abort()
    const directory = this.directory
    this.directory = null
    this.sourcePath = null
    this.preparing = null
    if (directory) await fs.promises.rm(directory, { recursive: true, force: true })
  }
}

module.exports = { BackgroundAudioSource, containedFile, decodeArgs, downloadArgs, runProcess }
