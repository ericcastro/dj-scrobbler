const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const {
  buildTvTargets,
  normalizeTvService,
  parseDnsSdBrowseLine,
  parseDnsSdResolveLine,
  parseDnsSdTxt,
  TvDiscovery,
} = require('../lib/tv-discovery')

test('TV targets combine Chromecast discovery with one stable Apple route-picker action', () => {
  const services = [
    { id: 'chromecast:1', protocol: 'chromecast', name: 'Office TV', addresses: ['10.0.0.8'], canConnect: true },
    { id: 'airplay:1', protocol: 'airplay', name: 'Living Room', addresses: ['10.0.0.9'], canConnect: false },
    { id: 'airplay:2', protocol: 'airplay', name: 'Bedroom', addresses: ['10.0.0.10'], canConnect: false },
  ]
  const targets = buildTvTargets(services, { canAirPlay: true })
  assert.deepEqual(targets.map(target => target.id), ['chromecast:1', 'airplay:system'])
  assert.deepEqual(targets[1].addresses, ['10.0.0.9', '10.0.0.10'])
  assert.equal(targets[1].canConnect, true)
  assert.match(targets[1].model, /system picker/)
})

test('macOS can offer its AirPlay picker before Bonjour finds a route', () => {
  assert.deepEqual(buildTvTargets([], { canAirPlay: true }), [{
    id: 'airplay:system',
    protocol: 'airplay',
    name: 'AirPlay…',
    model: 'Choose with Apple’s system picker',
    addresses: [],
    port: 0,
    canConnect: true,
  }])
})

test('TV services normalize protocol identity, friendly names, and IPv4 addresses', () => {
  assert.deepEqual(normalizeTvService('chromecast', {
    name: 'Chromecast-1234',
    fqdn: 'Chromecast-1234._googlecast._tcp.local',
    host: 'chromecast.local',
    port: 8009,
    addresses: ['fe80::1', '192.168.1.70'],
    txt: { id: 'ABC123', fn: 'Living Room', md: 'Chromecast Ultra' },
  }), {
    id: 'chromecast:abc123',
    protocol: 'chromecast',
    name: 'Living Room',
    model: 'Chromecast Ultra',
    host: 'chromecast.local',
    port: 8009,
    addresses: ['192.168.1.70'],
    available: true,
    canConnect: true,
  })

  const airplay = normalizeTvService('airplay', {
    name: 'Bedroom Apple TV',
    port: 7000,
    addresses: ['192.168.1.71'],
    txt: { deviceid: 'AA:BB:CC', model: 'AppleTV14,1' },
  })
  assert.equal(airplay.id, 'airplay:aa:bb:cc')
  assert.equal(airplay.canConnect, false)
})

test('macOS dns-sd output exposes Chromecast identity and endpoint', () => {
  assert.deepEqual(
    parseDnsSdBrowseLine('18:00:37.833  Add        2  14 local.               _googlecast._tcp.    Chromecast-cast123'),
    { action: 'Add', instance: 'Chromecast-cast123' }
  )
  assert.deepEqual(
    parseDnsSdResolveLine('Chromecast-cast123._googlecast._tcp.local. can be reached at cast123.local.:8009 (interface 14)'),
    { host: 'cast123.local', port: 8009 }
  )
  assert.deepEqual(
    parseDnsSdTxt(' id=cast123 md=Chromecast fn=Attic\\ TV rs=Chrome\\ Mirroring'),
    { id: 'cast123', md: 'Chromecast', fn: 'Attic TV', rs: 'Chrome Mirroring' }
  )
})

test('TV discovery merges browser events into one protocol-neutral snapshot', () => {
  class FakeBrowser extends EventEmitter {
    update() { this.updated = true }
    stop() { this.stopped = true }
  }
  class FakeBonjour {
    constructor() { this.browsers = [] }
    find(options) {
      const browser = new FakeBrowser()
      browser.options = options
      this.browsers.push(browser)
      return browser
    }
    destroy() { this.destroyed = true }
  }

  const discovery = new TvDiscovery({ BonjourClass: FakeBonjour })
  discovery.start()
  const [castBrowser, airplayBrowser] = discovery.browsers
  castBrowser.emit('up', { name: 'Kitchen', port: 8009, addresses: ['10.0.0.8'], txt: { id: 'cast-1', fn: 'Kitchen' } })
  airplayBrowser.emit('up', { name: 'Apple TV', port: 7000, addresses: ['10.0.0.9'], txt: { deviceid: 'air-1' } })
  assert.deepEqual(discovery.snapshot().map(device => device.protocol), ['chromecast', 'airplay'])
  discovery.refresh()
  assert.equal(castBrowser.updated, true)
  castBrowser.emit('down', { name: 'Kitchen', port: 8009, txt: { id: 'cast-1' } })
  assert.deepEqual(discovery.snapshot().map(device => device.protocol), ['airplay'])
  discovery.stop()
  assert.equal(castBrowser.stopped, true)
})
