#!/usr/bin/env node

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { startFfmpegHls } = require('../../lib/hls-encoder')
const { startHlsServer } = require('../../lib/hls-server')

function readNumberArgument(name, fallback) {
  const prefix = `--${name}=`
  const value = process.argv.find(argument => argument.startsWith(prefix))?.slice(prefix.length)
  return value === undefined ? fallback : Number(value)
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-scrobbler-hls-'))
  const durationSeconds = readNumberArgument('duration', 0)
  const server = await startHlsServer({ directory })
  const encoder = startFfmpegHls({
    directory,
    inputArgs: [
      '-re',
      '-f', 'lavfi',
      '-i', 'testsrc2=size=1280x720:rate=30,drawbox=x=40:y=500:w=1200:h=160:color=black@0.6:t=fill,drawbox=x=40:y=500:w=8:h=160:color=0xff785a@1:t=fill',
      '-f', 'lavfi',
      '-i', 'sine=frequency=440:sample_rate=48000',
    ],
    onLog: chunk => process.stderr.write(chunk),
  })

  let cleaningUp = false
  const cleanup = async () => {
    if (cleaningUp) return
    cleaningUp = true
    await encoder.stop().catch(() => {})
    await server.stop().catch(() => {})
    fs.rmSync(directory, { recursive: true, force: true })
  }
  process.once('SIGINT', () => cleanup().finally(() => process.exit(0)))
  process.once('SIGTERM', () => cleanup().finally(() => process.exit(0)))

  try {
    await encoder.ready
    console.log('HLS test stream is ready:')
    console.log(`  This Mac: ${server.localUrl}`)
    for (const url of server.playbackUrls) console.log(`  LAN/TV:   ${url}`)
    console.log('Open a URL in VLC, IINA, Safari, or an HLS-capable receiver. Press Ctrl+C to stop.')

    if (durationSeconds > 0) {
      await Promise.race([
        new Promise(resolve => setTimeout(resolve, durationSeconds * 1000)),
        encoder.exit.then(result => {
          if (!cleaningUp) throw new Error(`FFmpeg stopped unexpectedly (${result.code ?? result.signal}): ${result.stderr.trim()}`)
        }),
      ])
      await cleanup()
    } else {
      const result = await encoder.exit
      if (!cleaningUp) throw new Error(`FFmpeg stopped unexpectedly (${result.code ?? result.signal}): ${result.stderr.trim()}`)
    }
  } catch (error) {
    await cleanup()
    throw error
  }
}

main().catch(error => {
  console.error(error.message || error)
  process.exitCode = 1
})
