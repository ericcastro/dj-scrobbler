const { EventEmitter } = require('node:events')
const { Bonjour } = require('bonjour-service')

function serviceAddresses(service) {
  return [...new Set((service?.addresses || [])
    .filter(address => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(address))))]
}

function normalizeTvService(protocol, service) {
  const txt = service?.txt || {}
  const identity = protocol === 'chromecast'
    ? txt.id
    : (txt.deviceid || txt.deviceId)
  const fallback = service?.fqdn || `${service?.name || 'unknown'}:${service?.port || 0}`
  return {
    id: `${protocol}:${String(identity || fallback).toLowerCase()}`,
    protocol,
    name: String(txt.fn || service?.name || (protocol === 'airplay' ? 'AirPlay device' : 'Chromecast')),
    model: String(txt.md || txt.model || ''),
    host: String(service?.host || ''),
    port: Number(service?.port) || (protocol === 'chromecast' ? 8009 : 7000),
    addresses: serviceAddresses(service),
    available: true,
    canConnect: protocol === 'chromecast',
  }
}

function buildTvTargets(devices, options = {}) {
  const chromecasts = (devices || []).filter(device => device.protocol === 'chromecast')
  const airPlayServices = (devices || []).filter(device => device.protocol === 'airplay')
  const canAirPlay = !!options.canAirPlay
  if (!canAirPlay && !airPlayServices.length) return chromecasts

  return [
    ...chromecasts,
    {
      id: 'airplay:system',
      protocol: 'airplay',
      name: 'AirPlay…',
      model: canAirPlay ? 'Choose with Apple’s system picker' : 'Requires the macOS AirPlay helper',
      addresses: [...new Set(airPlayServices.flatMap(device => device.addresses || []))],
      port: 0,
      canConnect: canAirPlay,
    },
  ]
}

class TvDiscovery extends EventEmitter {
  constructor(options = {}) {
    super()
    this.BonjourClass = options.BonjourClass || Bonjour
    this.devices = new Map()
    this.bonjour = null
    this.browsers = []
    this.error = null
  }

  snapshot() {
    return [...this.devices.values()].sort((left, right) => (
      Number(right.canConnect) - Number(left.canConnect) ||
      left.name.localeCompare(right.name)
    ))
  }

  start() {
    if (this.bonjour) return
    this.bonjour = new this.BonjourClass({}, error => {
      this.error = error?.message || String(error)
      this.emit('error-state', this.error)
    })
    for (const [protocol, type] of [['chromecast', 'googlecast'], ['airplay', 'airplay']]) {
      const browser = this.bonjour.find({ type, protocol: 'tcp' })
      browser.on('up', service => this.upsert(protocol, service))
      browser.on('srv-update', service => this.upsert(protocol, service))
      browser.on('txt-update', service => this.upsert(protocol, service))
      browser.on('down', service => this.remove(protocol, service))
      this.browsers.push(browser)
    }
  }

  upsert(protocol, service) {
    const device = normalizeTvService(protocol, service)
    this.devices.set(device.id, device)
    this.emit('devices', this.snapshot())
  }

  remove(protocol, service) {
    const device = normalizeTvService(protocol, service)
    if (this.devices.delete(device.id)) this.emit('devices', this.snapshot())
  }

  refresh() {
    this.start()
    this.error = null
    for (const browser of this.browsers) browser.update()
    return this.snapshot()
  }

  stop() {
    for (const browser of this.browsers) browser.stop()
    this.browsers = []
    this.bonjour?.destroy()
    this.bonjour = null
    this.devices.clear()
  }
}

module.exports = {
  buildTvTargets,
  normalizeTvService,
  serviceAddresses,
  TvDiscovery,
}
