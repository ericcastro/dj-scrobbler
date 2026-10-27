const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')

const {
  CastV2Client,
  decodeCastMessage,
  encodeCastMessage,
  NAMESPACE_MEDIA,
  NAMESPACE_RECEIVER,
  selectDeviceAddress,
  selectPlaybackUrl,
} = require('../lib/castv2')

function payloadFromFrame(frame) {
  const length = frame.readUInt32BE(0)
  return decodeCastMessage(frame.subarray(4, length + 4))
}

test('CASTV2 envelopes round-trip without a general-purpose protobuf runtime', () => {
  const expected = {
    sourceId: 'sender-test',
    destinationId: 'receiver-0',
    namespace: NAMESPACE_RECEIVER,
    payload: { type: 'GET_STATUS', requestId: 7 },
  }
  assert.deepEqual(payloadFromFrame(encodeCastMessage(expected)), expected)
})

test('HLS URL selection prefers the receiver subnet and private LAN addresses', () => {
  const urls = [
    'http://100.90.1.2:9000/cast/x/index.m3u8',
    'http://192.168.4.10:9000/cast/x/index.m3u8',
    'http://10.0.0.4:9000/cast/x/index.m3u8',
  ]
  const device = { addresses: ['192.168.4.75'], host: 'living-room.local' }
  assert.equal(selectDeviceAddress(device), '192.168.4.75')
  assert.equal(selectPlaybackUrl(urls, device), urls[1])
})

test('CASTV2 client handles coalesced buffering/playing frames, loads HLS, and stops it', async () => {
  class FakeSocket extends EventEmitter {
    constructor() {
      super()
      this.destroyed = false
      this.messages = []
      process.nextTick(() => this.emit('secureConnect'))
    }

    write(frame) {
      const message = payloadFromFrame(frame)
      this.messages.push(message)
      const requestId = message.payload.requestId
      let payload = null
      let followup = null
      if (message.payload.type === 'GET_STATUS') {
        payload = { type: 'RECEIVER_STATUS', requestId, status: { applications: [] } }
      } else if (message.payload.type === 'LAUNCH') {
        payload = {
          type: 'RECEIVER_STATUS',
          requestId,
          status: { applications: [{ appId: 'CC1AD845', sessionId: 'session-1', transportId: 'transport-1' }] },
        }
      } else if (message.payload.type === 'LOAD') {
        payload = { type: 'MEDIA_STATUS', requestId, status: [{ playerState: 'BUFFERING' }] }
        followup = { type: 'MEDIA_STATUS', status: [{ playerState: 'PLAYING' }] }
      } else if (message.payload.type === 'STOP') {
        payload = { type: 'RECEIVER_STATUS', requestId, status: { applications: [] } }
      }
      if (payload) {
        const response = encodeCastMessage({
          sourceId: message.destinationId,
          destinationId: message.sourceId,
          namespace: message.namespace,
          payload,
        })
        if (followup) {
          const playing = encodeCastMessage({
            sourceId: message.destinationId,
            destinationId: message.sourceId,
            namespace: message.namespace,
            payload: followup,
          })
          process.nextTick(() => this.emit('data', Buffer.concat([response, playing])))
        } else process.nextTick(() => this.emit('data', response))
      }
      return true
    }

    destroy() {
      this.destroyed = true
      this.emit('close')
    }
  }

  const socket = new FakeSocket()
  const client = new CastV2Client({ sourceId: 'sender-test', socketFactory: () => socket })
  await client.connect('192.168.4.75')
  const loaded = await client.launchAndLoad('http://192.168.4.10/live/index.m3u8', { title: 'Test set' })
  assert.equal(loaded.type, 'MEDIA_STATUS')
  assert.equal(loaded.status[0].playerState, 'PLAYING')
  const mediaLoad = socket.messages.find(message => message.namespace === NAMESPACE_MEDIA && message.payload.type === 'LOAD')
  assert.equal(mediaLoad.payload.media.contentType, 'application/vnd.apple.mpegurl')
  assert.equal(mediaLoad.payload.media.streamType, 'LIVE')
  assert.equal(mediaLoad.payload.media.metadata.title, 'Test set')
  await client.stop()
  assert.equal(socket.destroyed, true)
  assert.ok(socket.messages.some(message => message.payload.type === 'STOP'))
})

function pendingSocket() {
  const socket = new EventEmitter()
  socket.destroyed = false
  socket.write = () => true
  socket.destroy = () => {
    socket.destroyed = true
    socket.emit('close')
  }
  return socket
}

test('Chromecast connection timeout destroys its socket and permits a retry', async () => {
  const sockets = []
  const client = new CastV2Client({ socketFactory: () => {
    const socket = pendingSocket()
    sockets.push(socket)
    return socket
  } })
  await assert.rejects(client.connect('tv', 8009, 10), /Timed out/)
  assert.equal(sockets[0].destroyed, true)
  assert.equal(client.heartbeatTimer, null)
  const retry = client.connect('tv')
  sockets[1].emit('secureConnect')
  await retry
  sockets[0].emit('error', new Error('late error from old socket'))
  assert.equal(client.socket, sockets[1])
  client.close()
})

test('Chromecast disconnect during connection rejects immediately', async () => {
  const socket = pendingSocket()
  const client = new CastV2Client({ socketFactory: () => socket })
  const connecting = client.connect('tv')
  socket.emit('close')
  await assert.rejects(connecting, /connection closed/)
  assert.equal(socket.destroyed, true)
})

test('Chromecast close cancels pending response waits', async () => {
  const socket = pendingSocket()
  const client = new CastV2Client({ socketFactory: () => socket })
  const connecting = client.connect('tv')
  socket.emit('secureConnect')
  await connecting
  const waiting = client.waitFor(() => false)
  client.close()
  await assert.rejects(waiting, /connection closed/)
  assert.equal(client.waiters.size, 0)
})

test('Chromecast synchronous write failures cancel the registered response wait', async () => {
  const socket = pendingSocket()
  const client = new CastV2Client({ socketFactory: () => socket })
  const connecting = client.connect('tv')
  socket.emit('secureConnect')
  await connecting
  socket.write = () => { throw new Error('write failed') }
  await assert.rejects(client.request(NAMESPACE_RECEIVER, 'receiver-0', { type: 'GET_STATUS' }), /write failed/)
  assert.equal(client.waiters.size, 0)
  assert.equal(socket.destroyed, true)
})
