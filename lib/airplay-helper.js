const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')

function resolveAirPlayHelperPath(options = {}) {
  if (options.overridePath) return path.resolve(options.overridePath)
  if (options.isPackaged) return path.join(options.resourcesPath, 'bin', 'dj-scrobbler-airplay')
  return path.join(options.appPath, 'native', 'bin', 'dj-scrobbler-airplay')
}

function airPlayHelperAvailable(helperPath) {
  try {
    fs.accessSync(helperPath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function startAirPlayHelper(options = {}) {
  const helperPath = options.helperPath
  if (!airPlayHelperAvailable(helperPath)) throw new Error('The AirPlay helper is not installed.')
  const child = (options.spawnImpl || spawn)(helperPath, [options.hlsUrl], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const events = new EventEmitter()
  let stdout = ''
  let stderr = ''
  let readySettled = false
  let stopped = false

  const ready = new Promise((resolve, reject) => {
    const fail = error => {
      if (readySettled) return
      readySettled = true
      reject(error)
    }
    child.once('error', fail)
    child.once('exit', (code, signal) => {
      if (!readySettled) fail(new Error(`AirPlay helper stopped before opening the route picker (${code ?? signal}): ${stderr.trim()}`))
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
      const lines = stdout.split(/\r?\n/)
      stdout = lines.pop()
      for (const line of lines) {
        let event
        try { event = JSON.parse(line) } catch { continue }
        events.emit('status', event)
        if (event.status === 'ready' && !readySettled) {
          readySettled = true
          resolve(event)
        }
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => {
      stderr = `${stderr}${chunk}`.slice(-4000)
    })
  })

  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal, stderr })))
  return {
    child,
    events,
    ready,
    exit,
    stop() {
      if (stopped) return exit
      stopped = true
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
      return exit
    },
  }
}

module.exports = {
  airPlayHelperAvailable,
  resolveAirPlayHelperPath,
  startAirPlayHelper,
}
