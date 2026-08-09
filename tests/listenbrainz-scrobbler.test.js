const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')

const { createListenBrainzScrobbler, normaliseBaseUrl } = require('../lib/scrobblers/listenbrainz')

/** Spin up a mock ListenBrainz-protocol server; returns { url, requests }. */
async function mockServer(handler) {
  const requests = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      const entry = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() }
      requests.push(entry)
      handler(entry, res)
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  // fetch() pools keep-alive sockets; force-close them so the test process can exit.
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => { server.closeAllConnections?.(); server.close() },
  }
}

const okJson = (res, obj = { status: 'ok' }) => {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

function makeScrobbler(statuses = []) {
  return createListenBrainzScrobbler({ onStatus: s => statuses.push(s) })
}

test('normaliseBaseUrl accepts full http(s) URLs and strips trailing slashes', () => {
  assert.equal(normaliseBaseUrl('http://localhost:9078/'), 'http://localhost:9078')
  assert.equal(normaliseBaseUrl(' https://ms.example.com// '), 'https://ms.example.com')
  assert.equal(normaliseBaseUrl('http://localhost:9078/api/listenbrainz/'), 'http://localhost:9078/api/listenbrainz')
})

test('normaliseBaseUrl forgives pasted endpoint/API-root URLs', () => {
  // Koito documents {host}/apis/listenbrainz/1 as the base URL
  assert.equal(normaliseBaseUrl('http://koito:4110/apis/listenbrainz/1'), 'http://koito:4110/apis/listenbrainz')
  // a user pasting the full endpoint path
  assert.equal(normaliseBaseUrl('http://koito:4110/apis/listenbrainz/1/submit-listens'), 'http://koito:4110/apis/listenbrainz')
  assert.equal(normaliseBaseUrl('https://api.listenbrainz.org/1/submit-listens/'), 'https://api.listenbrainz.org')
})

test('normaliseBaseUrl rejects garbage and non-http schemes', () => {
  assert.throws(() => normaliseBaseUrl('localhost:9078'), /full URL|http/)
  assert.throws(() => normaliseBaseUrl('ftp://localhost'), /http/)
  assert.throws(() => normaliseBaseUrl(''), /full URL|http/)
})

test('connect validates via an empty playing_now probe and stores the config', async () => {
  const statuses = []
  const ms = await mockServer((_req, res) => okJson(res))
  const s = makeScrobbler(statuses)
  const session = await s.connect({ url: ms.url, token: 'secret-token' })
  assert.equal(session.name, ms.url)
  assert.deepEqual(s.config, { url: ms.url, token: 'secret-token' })
  assert.deepEqual(statuses, ['ok'])
  // The probe, not validate-token: MS answers validate-token 200 even for bad tokens
  assert.equal(ms.requests.length, 1)
  assert.equal(ms.requests[0].url, '/1/submit-listens')
  assert.equal(ms.requests[0].headers.authorization, 'Token secret-token')
  assert.deepEqual(JSON.parse(ms.requests[0].body), { listen_type: 'playing_now', payload: [] })
  ms.close()
})

test('connect treats Koito\'s 400 "payload is nil" as proof of a valid token', async () => {
  // Koito's auth middleware rejects bad tokens with 401 before the handler;
  // a 400 payload complaint means auth already passed.
  const koito = await mockServer((_req, res) => { res.writeHead(400); res.end('payload is nil') })
  const s = makeScrobbler()
  await s.connect({ url: `${koito.url}/apis/listenbrainz/1`, token: 'koito-api-key' })
  assert.equal(koito.requests[0].url, '/apis/listenbrainz/1/submit-listens')
  koito.close()
})

test('connect rejects bad tokens (401 like ListenBrainz, 409 like Multi-Scrobbler) and unreachable servers', async () => {
  const ms401 = await mockServer((_req, res) => { res.writeHead(401); res.end() })
  await assert.rejects(() => makeScrobbler().connect({ url: ms401.url, token: 'wrong' }), /rejected the token/)
  ms401.close()

  const ms409 = await mockServer((_req, res) => { res.writeHead(409); res.end(JSON.stringify({ error: 'No Listenbrainz endpoint config matched' })) })
  await assert.rejects(() => makeScrobbler().connect({ url: ms409.url, token: 'wrong' }), /rejected the token/)
  ms409.close()

  await assert.rejects(
    () => makeScrobbler().connect({ url: 'http://127.0.0.1:1', token: 'x' }),
    /Could not reach/
  )
})

test('scrobble submits a single listen with listened_at and release_name', async () => {
  const statuses = []
  const ms = await mockServer((_req, res) => okJson(res))
  const s = makeScrobbler(statuses)
  await s.connect({ url: ms.url, token: 'tok' })

  s.scrobble('Artist A', 'Track B', 1750000000000, 'My DJ Set')
  await new Promise(r => setTimeout(r, 100))

  const req = ms.requests.map(r => ({ ...r, json: JSON.parse(r.body) }))
    .find(r => r.url === '/1/submit-listens' && r.json.listen_type === 'single')
  assert.ok(req)
  assert.equal(req.headers['content-type'], 'application/json')
  const body = req.json
  assert.equal(body.listen_type, 'single')
  assert.equal(body.payload.length, 1)
  assert.equal(body.payload[0].listened_at, 1750000000)
  assert.deepEqual(body.payload[0].track_metadata, {
    artist_name: 'Artist A',
    track_name: 'Track B',
    release_name: 'My DJ Set',
  })
  assert.deepEqual(statuses, ['ok', 'ok'])
  ms.close()
})

test('nowPlaying submits a playing_now listen without a timestamp or album requirement', async () => {
  const ms = await mockServer((_req, res) => okJson(res))
  const s = makeScrobbler()
  await s.connect({ url: ms.url, token: 'tok' })

  s.nowPlaying('Artist A', 'Track B')
  await new Promise(r => setTimeout(r, 100))

  const body = ms.requests.map(r => JSON.parse(r.body))
    .find(b => b.listen_type === 'playing_now' && b.payload.length > 0)
  assert.ok(body)
  assert.equal(body.payload[0].listened_at, undefined)
  assert.deepEqual(body.payload[0].track_metadata, { artist_name: 'Artist A', track_name: 'Track B' })
  ms.close()
})

test('scrobbles are dropped silently when not connected', async () => {
  const ms = await mockServer((_req, res) => okJson(res))
  const s = makeScrobbler()
  s.scrobble('A', 'B', 1750000000000)
  s.nowPlaying('A', 'B')
  await new Promise(r => setTimeout(r, 100))
  assert.equal(ms.requests.length, 0)
  ms.close()
})

test('server errors flip status to error', async () => {
  const statuses = []
  const ms = await mockServer((_req, res) => { res.writeHead(500); res.end() })
  const s = makeScrobbler(statuses)
  s.restore({ url: ms.url, token: 'tok' })
  s.scrobble('A', 'B', 1750000000000)
  await new Promise(r => setTimeout(r, 100))
  assert.deepEqual(statuses, ['ok', 'error'])
  ms.close()
})
