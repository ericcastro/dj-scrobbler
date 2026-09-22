const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const tls = require('node:tls')

const DEFAULT_MEDIA_RECEIVER_APP_ID = 'CC1AD845'
const NAMESPACE_CONNECTION = 'urn:x-cast:com.google.cast.tp.connection'
const NAMESPACE_HEARTBEAT = 'urn:x-cast:com.google.cast.tp.heartbeat'
const NAMESPACE_RECEIVER = 'urn:x-cast:com.google.cast.receiver'
const NAMESPACE_MEDIA = 'urn:x-cast:com.google.cast.media'
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024

function encodeVarint(value) {
  const bytes = []
  let remaining = Number(value) >>> 0
  do {
    let byte = remaining & 0x7f
    remaining >>>= 7
    if (remaining) byte |= 0x80
    bytes.push(byte)
  } while (remaining)
  return Buffer.from(bytes)
}

function decodeVarint(buffer, offset) {
  let value = 0
  let shift = 0
  let cursor = offset
  while (cursor < buffer.length && shift <= 28) {
    const byte = buffer[cursor++]
    value |= (byte & 0x7f) << shift
    if (!(byte & 0x80)) return { value: value >>> 0, offset: cursor }
    shift += 7
  }
  throw new Error('Malformed CASTV2 varint')
}

function encodeField(number, wireType, value) {
  const key = encodeVarint((number << 3) | wireType)
  if (wireType === 0) return Buffer.concat([key, encodeVarint(value)])
  const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')
  return Buffer.concat([key, encodeVarint(data.length), data])
}

function encodeCastMessage(message) {
  const payload = Buffer.concat([
    encodeField(1, 0, 0),
    encodeField(2, 2, message.sourceId),
    encodeField(3, 2, message.destinationId),
    encodeField(4, 2, message.namespace),
    encodeField(5, 0, 0),
    encodeField(6, 2, JSON.stringify(message.payload)),
  ])
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32BE(payload.length)
  return Buffer.concat([header, payload])
}

function decodeCastMessage(buffer) {
  const result = {}
  let offset = 0
  while (offset < buffer.length) {
    const key = decodeVarint(buffer, offset)
    offset = key.offset
    const field = key.value >>> 3
    const wireType = key.value & 7
    if (wireType === 0) {
      const decoded = decodeVarint(buffer, offset)
      offset = decoded.offset
      continue
    }
    if (wireType !== 2) throw new Error(`Unsupported CASTV2 wire type ${wireType}`)
    const length = decodeVarint(buffer, offset)
    offset = length.offset
    const end = offset + length.value
    if (end > buffer.length) throw new Error('Truncated CASTV2 field')
    const value = buffer.subarray(offset, end)
    offset = end
    if (field === 2) result.sourceId = value.toString('utf8')
    if (field === 3) result.destinationId = value.toString('utf8')
    if (field === 4) result.namespace = value.toString('utf8')
    if (field === 6) result.payload = JSON.parse(value.toString('utf8'))
  }
  return result
}

class CastV2Client extends EventEmitter {
  constructor(options = {}) {
    super()
    this.socketFactory = options.socketFactory || (connectOptions => tls.connect(connectOptions))
    this.sourceId = options.sourceId || `sender-${crypto.randomBytes(4).toString('hex')}`
    this.requestId = 0
    this.socket = null
    this.buffer = Buffer.alloc(0)
    this.waiters = new Set()
    this.heartbeatTimer = null
    this.sessionId = null
  }

  async connect(host, port = 8009, timeoutMs = 8000) {
    if (this.socket) return
    const socket = this.socketFactory({ host, port, rejectUnauthorized: false })
    this.socket = socket
    socket.on('data', chunk => this.onData(chunk))
    socket.on('error', error => this.fail(error))
    socket.on('close', () => this.fail(new Error('Chromecast connection closed')))
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out connecting to Chromecast')), timeoutMs)
      const ready = () => {
        clearTimeout(timer)
        socket.off('error', failed)
        resolve()
      }
      const failed = error => {
        clearTimeout(timer)
        socket.off('secureConnect', ready)
        reject(error)
      }
      socket.once('secureConnect', ready)
      socket.once('error', failed)
    })
    this.send(NAMESPACE_CONNECTION, 'receiver-0', { type: 'CONNECT', origin: {} })
    this.heartbeatTimer = setInterval(() => {
      if (this.socket && !this.socket.destroyed) this.send(NAMESPACE_HEARTBEAT, 'receiver-0', { type: 'PING' })
    }, 5000)
    this.heartbeatTimer.unref?.()
  }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32BE(0)
      if (length > MAX_MESSAGE_BYTES) return this.fail(new Error('Chromecast message was unexpectedly large'))
      if (this.buffer.length < length + 4) return
      const frame = this.buffer.subarray(4, length + 4)
      this.buffer = this.buffer.subarray(length + 4)
      let message
      try {
        message = decodeCastMessage(frame)
      } catch (error) {
        this.fail(error)
        return
      }
      if (message.namespace === NAMESPACE_HEARTBEAT && message.payload?.type === 'PING') {
        this.send(NAMESPACE_HEARTBEAT, message.sourceId || 'receiver-0', { type: 'PONG' })
      }
      for (const waiter of [...this.waiters]) {
        if (!waiter.predicate(message)) continue
        this.waiters.delete(waiter)
        clearTimeout(waiter.timer)
        waiter.resolve(message)
      }
      this.emit('message', message)
    }
  }

  send(namespace, destinationId, payload) {
    if (!this.socket || this.socket.destroyed) throw new Error('Chromecast is not connected')
    this.socket.write(encodeCastMessage({
      sourceId: this.sourceId,
      destinationId,
      namespace,
      payload,
    }))
  }

  waitFor(predicate, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter)
          reject(new Error('Timed out waiting for Chromecast'))
        }, timeoutMs),
      }
      this.waiters.add(waiter)
    })
  }

  async request(namespace, destinationId, payload, predicate, timeoutMs) {
    const requestId = ++this.requestId
    const response = this.waitFor(message => (
      message.namespace === namespace &&
      (message.payload?.requestId === requestId || predicate?.(message.payload))
    ), timeoutMs)
    this.send(namespace, destinationId, { ...payload, requestId })
    return response
  }

  async launchAndLoad(hlsUrl, metadata = {}) {
    const statusMessage = await this.request(
      NAMESPACE_RECEIVER,
      'receiver-0',
      { type: 'GET_STATUS' },
      payload => payload?.type === 'RECEIVER_STATUS'
    )
    let application = statusMessage.payload?.status?.applications?.find(app => app.appId === DEFAULT_MEDIA_RECEIVER_APP_ID)
    if (!application) {
      const launched = await this.request(
        NAMESPACE_RECEIVER,
        'receiver-0',
        { type: 'LAUNCH', appId: DEFAULT_MEDIA_RECEIVER_APP_ID },
        payload => payload?.type === 'RECEIVER_STATUS' && payload.status?.applications?.some(app => app.appId === DEFAULT_MEDIA_RECEIVER_APP_ID),
        15000
      )
      application = launched.payload?.status?.applications?.find(app => app.appId === DEFAULT_MEDIA_RECEIVER_APP_ID)
    }
    if (!application?.transportId) throw new Error('Chromecast did not launch its media receiver')
    this.sessionId = application.sessionId || null
    this.send(NAMESPACE_CONNECTION, application.transportId, { type: 'CONNECT', origin: {} })

    const loaded = await this.request(NAMESPACE_MEDIA, application.transportId, {
      type: 'LOAD',
      sessionId: this.sessionId,
      autoplay: true,
      currentTime: 0,
      media: {
        contentId: hlsUrl,
        contentType: 'application/vnd.apple.mpegurl',
        streamType: 'LIVE',
        hlsSegmentFormat: 'TS',
        metadata: {
          metadataType: 0,
          title: metadata.title || 'DJ Scrobbler',
          subtitle: metadata.subtitle || 'Live from the focus window',
        },
      },
    }, payload => payload?.type === 'LOAD_FAILED', 15000)
    if (loaded.payload?.type === 'LOAD_FAILED') throw new Error(loaded.payload?.reason || 'Chromecast could not load the HLS stream')
    const isPlaying = payload => payload?.type === 'MEDIA_STATUS' &&
      payload.status?.some(status => status.playerState === 'PLAYING')
    if (isPlaying(loaded.payload)) return loaded.payload
    const playing = await this.waitFor(message => (
      message.namespace === NAMESPACE_MEDIA && isPlaying(message.payload)
    ), 25000)
    return playing.payload
  }

  async stop() {
    if (!this.socket || this.socket.destroyed) return
    if (this.sessionId) {
      await this.request(
        NAMESPACE_RECEIVER,
        'receiver-0',
        { type: 'STOP', sessionId: this.sessionId },
        payload => payload?.type === 'RECEIVER_STATUS',
        3000
      ).catch(() => {})
    }
    this.close()
  }

  fail(error) {
    if (!this.socket) return
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.waiters.clear()
    this.emit('failure', error)
  }

  close() {
    clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
    const socket = this.socket
    this.socket = null
    if (socket && !socket.destroyed) socket.destroy()
  }
}

function selectDeviceAddress(device) {
  return device?.addresses?.find(address => /^192\.168\./.test(address)) ||
    device?.addresses?.find(address => /^10\./.test(address)) ||
    device?.addresses?.find(address => /^172\.(1[6-9]|2\d|3[01])\./.test(address)) ||
    device?.addresses?.[0] || device?.host || null
}

function selectPlaybackUrl(playbackUrls, device) {
  const urls = (playbackUrls || []).map(value => new URL(value))
  const receiverAddress = selectDeviceAddress(device)
  const receiverPrefix = receiverAddress?.split('.').slice(0, 3).join('.')
  return urls.find(url => url.hostname.split('.').slice(0, 3).join('.') === receiverPrefix)?.href ||
    urls.find(url => /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname))?.href ||
    urls[0]?.href || null
}

module.exports = {
  CastV2Client,
  decodeCastMessage,
  DEFAULT_MEDIA_RECEIVER_APP_ID,
  encodeCastMessage,
  NAMESPACE_CONNECTION,
  NAMESPACE_HEARTBEAT,
  NAMESPACE_MEDIA,
  NAMESPACE_RECEIVER,
  selectDeviceAddress,
  selectPlaybackUrl,
}
