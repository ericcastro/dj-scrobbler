const { EventEmitter } = require('node:events')
const { PassThrough } = require('node:stream')

class FakeChild extends EventEmitter {
  constructor() {
    super()
    this.stdout = new PassThrough()
    this.stderr = new PassThrough()
    this.stdin = new PassThrough()
    this.exitCode = null
    this.signalCode = null
    this.signals = []
  }

  kill(signal = 'SIGTERM') {
    this.signals.push(signal)
    return true
  }

  exit(code = 0, signal = null) {
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }

  close(code = this.exitCode, signal = this.signalCode) {
    this.stdout.end()
    this.stderr.end()
    this.emit('close', code, signal)
  }
}

module.exports = { FakeChild }
