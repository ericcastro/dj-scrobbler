const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

function buildHlsOutputArgs(options = {}) {
  const directory = path.resolve(options.directory)
  const segmentDuration = Math.max(0.5, Number(options.segmentDuration) || 1)
  const listSize = Math.max(3, Math.round(Number(options.listSize) || 6))
  const videoCodec = options.videoCodec || 'libx264'
  const audioCodec = options.audioCodec || 'aac'
  const frameRate = Math.max(1, Math.round(Number(options.frameRate) || 30))
  const keyframeInterval = Math.max(1, Math.round(frameRate * segmentDuration))

  return [
    '-c:v', videoCodec,
    ...(videoCodec === 'libx264' ? ['-preset', options.preset || 'veryfast', '-tune', 'zerolatency'] : []),
    '-pix_fmt', 'yuv420p',
    '-r', String(frameRate),
    '-g', String(keyframeInterval),
    '-keyint_min', String(keyframeInterval),
    '-sc_threshold', '0',
    '-b:v', options.videoBitrate || '5M',
    '-maxrate', options.videoMaxBitrate || '6M',
    '-bufsize', options.videoBufferSize || '10M',
    '-c:a', audioCodec,
    ...(audioCodec === 'aac' ? ['-profile:a', options.audioProfile || 'aac_low'] : []),
    '-b:a', options.audioBitrate || '320k',
    '-ar', '48000',
    '-ac', '2',
    '-f', 'hls',
    '-hls_time', String(segmentDuration),
    '-hls_list_size', String(listSize),
    '-hls_delete_threshold', '2',
    '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments+temp_file',
    '-hls_segment_filename', path.join(directory, 'segment-%06d.ts'),
    path.join(directory, 'index.m3u8'),
  ]
}

async function waitForHlsReady(directory, options = {}) {
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || 15000)
  const pollMs = Math.max(10, Number(options.pollMs) || 50)
  const playlistPath = path.join(directory, 'index.m3u8')
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const playlist = await fs.promises.readFile(playlistPath, 'utf8')
      const segment = playlist.split(/\r?\n/).find(line => line && !line.startsWith('#'))
      if (segment && fs.existsSync(path.join(directory, segment))) return playlistPath
    } catch {}
    await new Promise(resolve => setTimeout(resolve, pollMs))
  }
  throw new Error(`HLS stream did not become ready within ${timeoutMs}ms`)
}

function startFfmpegHls(options = {}) {
  const directory = path.resolve(options.directory)
  fs.mkdirSync(directory, { recursive: true })
  const executable = options.executable || process.env.DJ_SCROBBLER_FFMPEG || 'ffmpeg'
  const args = [
    '-hide_banner',
    '-loglevel', options.logLevel || 'warning',
    ...(options.inputArgs || []),
    ...buildHlsOutputArgs({ ...options, directory }),
  ]
  const child = spawn(executable, args, { stdio: [options.pipeInput ? 'pipe' : 'ignore', 'ignore', 'pipe'] })
  const stderr = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => {
    stderr.push(chunk)
    if (stderr.length > 20) stderr.shift()
    options.onLog?.(chunk)
  })
  child.stdin?.on('error', () => {})

  let stopped = false
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code, signal, stderr: stderr.join('') }))
  })

  return {
    child,
    args,
    exit,
    write(chunk) {
      if (!child.stdin?.writable || stopped) return false
      return child.stdin.write(chunk)
    },
    ready: Promise.race([
      waitForHlsReady(directory, options),
      exit.then(result => {
        if (!stopped) throw new Error(`FFmpeg exited before HLS was ready (${result.code ?? result.signal}): ${result.stderr.trim()}`)
      }),
    ]),
    async stop() {
      if (stopped) return exit
      stopped = true
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      const forceTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      }, 3000)
      forceTimer.unref?.()
      try {
        return await exit
      } finally {
        clearTimeout(forceTimer)
      }
    },
  }
}

module.exports = {
  buildHlsOutputArgs,
  startFfmpegHls,
  waitForHlsReady,
}
