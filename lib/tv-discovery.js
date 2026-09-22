const { EventEmitter } = require('node:events')
const dns = require('node:dns')
const { spawn } = require('node:child_process')
const { Bonjour } = require('bonjour-service')

const GOOGLECAST_SERVICE = '_googlecast._tcp'

function unescapeDnsSd(value) {
  return String(value || '').replace(/\\(\d{3}|.)/g, (_match, escaped) => (
    /^\d{3}$/.test(escaped) ? String.fromCharCode(Number(escaped)) : escaped
  ))
}

function parseDnsSdBrowseLine(line) {
  const match = String(line || '').match(/\s(Add|Rmv)\s+\d+\s+\d+\s+\S+\s+_googlecast\._tcp\.\s+(.+?)\s*$/)
  if (!match) return null
  return { action: match[1], instance: unescapeDnsSd(match[2]) }
}

function parseDnsSdResolveLine(line) {
  const match = String(line || '').match(/can be reached at\s+(.+?):(\d+)\s+\(interface\s+\d+\)/)
  if (!match) return null
  return { host: match[1].replace(/\.$/, ''), port: Number(match[2]) }
}

function parseDnsSdTxt(line) {
  const txt = {}
  const pattern = /([^\s=]+)=((?:\\.|[^\s])*)/g
  let match
  while ((match = pattern.exec(String(line || '')))) {
    txt[unescapeDnsSd(match[1])] = unescapeDnsSd(match[2])
  }
  return txt
}

function readProcessLines(stream, onLine) {
  let buffered = ''
  stream?.on('data', chunk => {
    buffered += String(chunk)
    const lines = buffered.split(/\r?\n/)
    buffered = lines.pop() || ''
    for (const line of lines) onLine(line)
  })
}

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
    this.spawn = options.spawn || spawn
    this.dnsLookup = options.dnsLookup || dns.lookup
    this.enableNativeDnsSd = options.enableNativeDnsSd ?? (process.platform === 'darwin' && !options.BonjourClass)
    this.devices = new Map()
    this.bonjour = null
    this.browsers = []
    this.nativeBrowser = null
    this.nativeResolvers = new Map()
    this.nativeInstances = new Map()
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
    this.startNativeChromecastDiscovery()
  }

  startNativeChromecastDiscovery() {
    if (!this.enableNativeDnsSd || this.nativeBrowser) return
    const browser = this.spawn('/usr/bin/dns-sd', ['-B', GOOGLECAST_SERVICE, 'local.'])
    this.nativeBrowser = browser
    readProcessLines(browser.stdout, line => {
      const event = parseDnsSdBrowseLine(line)
      if (!event) return
      if (event.action === 'Add') this.resolveNativeChromecast(event.instance)
      else this.removeNativeChromecast(event.instance)
    })
    browser.on('error', error => {
      if (this.nativeBrowser !== browser) return
      this.error = error?.message || String(error)
      this.emit('error-state', this.error)
    })
    browser.on('close', () => {
      if (this.nativeBrowser === browser) this.nativeBrowser = null
    })
  }

  resolveNativeChromecast(instance) {
    if (this.nativeResolvers.has(instance)) return
    const resolver = this.spawn('/usr/bin/dns-sd', ['-L', instance, GOOGLECAST_SERVICE, 'local.'])
    this.nativeResolvers.set(instance, resolver)
    let endpoint = null
    let settled = false
    const finish = txt => {
      if (settled || !endpoint) return
      settled = true
      resolver.kill()
      this.nativeResolvers.delete(instance)
      this.dnsLookup(endpoint.host, { all: true }, (error, results = []) => {
        const addresses = error ? [] : results.map(result => result.address)
        const device = normalizeTvService('chromecast', {
          name: instance,
          fqdn: `${instance}.${GOOGLECAST_SERVICE}.local`,
          host: endpoint.host,
          port: endpoint.port,
          addresses,
          txt,
        })
        this.nativeInstances.set(instance, device.id)
        this.devices.set(device.id, device)
        this.emit('devices', this.snapshot())
      })
    }
    readProcessLines(resolver.stdout, line => {
      endpoint ||= parseDnsSdResolveLine(line)
      if (!endpoint) return
      const txt = parseDnsSdTxt(line)
      if (Object.keys(txt).length) finish(txt)
    })
    resolver.on('error', error => {
      this.nativeResolvers.delete(instance)
      this.error = error?.message || String(error)
      this.emit('error-state', this.error)
    })
  }

  removeNativeChromecast(instance) {
    const resolver = this.nativeResolvers.get(instance)
    resolver?.kill()
    this.nativeResolvers.delete(instance)
    const id = this.nativeInstances.get(instance)
    this.nativeInstances.delete(instance)
    if (id && this.devices.delete(id)) this.emit('devices', this.snapshot())
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
    if (this.enableNativeDnsSd) {
      const browser = this.nativeBrowser
      this.nativeBrowser = null
      browser?.kill()
      this.startNativeChromecastDiscovery()
    }
    return this.snapshot()
  }

  stop() {
    for (const browser of this.browsers) browser.stop()
    this.browsers = []
    this.bonjour?.destroy()
    this.bonjour = null
    const nativeBrowser = this.nativeBrowser
    this.nativeBrowser = null
    nativeBrowser?.kill()
    for (const resolver of this.nativeResolvers.values()) resolver.kill()
    this.nativeResolvers.clear()
    this.nativeInstances.clear()
    this.devices.clear()
  }
}

module.exports = {
  buildTvTargets,
  normalizeTvService,
  parseDnsSdBrowseLine,
  parseDnsSdResolveLine,
  parseDnsSdTxt,
  serviceAddresses,
  TvDiscovery,
}
