const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const path = require('node:path')

const {
  resolveAirPlayHelperPath,
  startAirPlayHelper,
} = require('../lib/airplay-helper')

class FakePipe extends EventEmitter {
  setEncoding() {}
}

class FakeChild extends EventEmitter {
  constructor() {
    super()
    this.stdout = new FakePipe()
    this.stderr = new FakePipe()
    this.exitCode = null
    this.signalCode = null
  }

  kill(signal) {
    this.signalCode = signal
    process.nextTick(() => this.emit('exit', null, signal))
    return true
  }
}

test('AirPlay helper path follows development, packaged, and explicit layouts', () => {
  assert.equal(
    resolveAirPlayHelperPath({ appPath: '/project' }),
    path.join('/project', 'native', 'bin', 'dj-scrobbler-airplay')
  )
  assert.equal(
    resolveAirPlayHelperPath({ isPackaged: true, resourcesPath: '/app/Contents/Resources' }),
    path.join('/app/Contents/Resources', 'bin', 'dj-scrobbler-airplay')
  )
  assert.equal(
    resolveAirPlayHelperPath({ overridePath: '/custom/airplay' }),
    path.resolve('/custom/airplay')
  )
})

test('AirPlay helper exposes route-picker status and stops its native process', async () => {
  const child = new FakeChild()
  const calls = []
  const helper = startAirPlayHelper({
    helperPath: process.execPath,
    hlsUrl: 'http://192.168.1.4/live/index.m3u8',
    spawnImpl: (...args) => {
      calls.push(args)
      return child
    },
  })
  const statuses = []
  helper.events.on('status', event => statuses.push(event.status))
  child.stdout.emit('data', '{"status":"ready"}\n{"status":"casting"}\n')

  await helper.ready
  assert.deepEqual(statuses, ['ready', 'casting'])
  assert.deepEqual(calls[0].slice(0, 2), [
    process.execPath,
    ['http://192.168.1.4/live/index.m3u8'],
  ])
  const result = await helper.stop()
  assert.equal(result.signal, 'SIGTERM')
})
