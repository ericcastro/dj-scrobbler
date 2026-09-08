const test = require('node:test')
const assert = require('node:assert/strict')

const tracklists1001 = require('../plugins/tracklists/1001tracklists')

const { assertProviderResponse, extractVideoIdFromHtml, networkError } = tracklists1001._test

test('1001Tracklists plugin recognizes tracklist URLs', () => {
  assert.equal(tracklists1001.matchUrl('https://www.1001tracklists.com/tracklist/abc/foo.html'), true)
  assert.equal(tracklists1001.matchUrl('https://example.com/tracklist/abc/foo.html'), false)
})

test('1001Tracklists extracts embedded YouTube IDs from known markup variants', () => {
  assert.equal(
    extractVideoIdFromHtml('<iframe src="https://www.youtube.com/embed/AbCdEfGh123"></iframe>'),
    'AbCdEfGh123'
  )
  assert.equal(
    extractVideoIdFromHtml('<iframe src="https://www.youtube-nocookie.com/embed/ZyXwVuTs987"></iframe>'),
    'ZyXwVuTs987'
  )
  assert.equal(
    extractVideoIdFromHtml('ytPlayer = { idPlayer: "A1B2C3D4E5F" }'),
    'A1B2C3D4E5F'
  )
  assert.equal(
    extractVideoIdFromHtml('<button data-youtube-id="QwErTyUi123"></button>'),
    'QwErTyUi123'
  )
  assert.equal(extractVideoIdFromHtml('<main>No video here</main>'), null)
})

test('1001Tracklists provider guard detects overuse and browser challenge pages', () => {
  assert.throws(
    () => assertProviderResponse('Access has been limited due to overuse'),
    err => err.code === 'provider_access_limited' && err.providerId === '1001tracklists'
  )
  assert.throws(
    () => assertProviderResponse('<div class="turnstile-container"></div>'),
    err => err.code === 'provider_challenge' && err.providerId === '1001tracklists'
  )
})

test('1001Tracklists network errors are typed for renderer recovery', () => {
  const err = networkError('No internet')
  assert.equal(err.code, 'network_unavailable')
  assert.equal(err.providerId, '1001tracklists')
  assert.equal(err.message, 'No internet')
})

test('1001Tracklists defaults an untimed first real track to 0:00', () => {
  const tracks = [
    { trackNum: 1, raw: 'Artist - Opener', hasTimestamp: false, noTimestamp: true, cueSeconds: null, cueDisplay: '' },
    { trackNum: 2, raw: 'Artist - Later', hasTimestamp: false, noTimestamp: true, cueSeconds: null, cueDisplay: '' },
  ]

  const normalized = tracklists1001.normalizeTracklist(tracks)
  assert.deepEqual(normalized[0], {
    ...tracks[0],
    hasTimestamp: true,
    noTimestamp: false,
    cueSeconds: 0,
    cueDisplay: '0:00',
  })
  assert.deepEqual(normalized[1], tracks[1], 'later untimed tracks must stay untimed')
})

test('1001Tracklists preserves an explicit first timestamp and empty placeholders', () => {
  const explicit = [{ trackNum: 1, raw: 'Artist - Opener', hasTimestamp: true, noTimestamp: false, cueSeconds: 12, cueDisplay: '0:12' }]
  const placeholder = [{ trackNum: 1, raw: '', title: '', artist: '', isId: false, hasTimestamp: false, noTimestamp: true }]
  const unidentified = [{ trackNum: 1, raw: '', title: '', artist: '', isId: true, hasTimestamp: false, noTimestamp: true }]

  assert.equal(tracklists1001.normalizeTracklist(explicit), explicit)
  assert.equal(tracklists1001.normalizeTracklist(placeholder), placeholder)
  assert.deepEqual(tracklists1001.normalizeTracklist(unidentified)[0], {
    ...unidentified[0],
    hasTimestamp: true,
    noTimestamp: false,
    cueSeconds: 0,
    cueDisplay: '0:00',
  })
})

test('1001Tracklists default artwork is treated as missing artwork', () => {
  const tracks = [{
    trackNum: 2,
    artist: 'Artist',
    title: 'Track',
    artUrl: 'https://cdn.1001tracklists.com/images/artworks/default_100.png',
  }]

  assert.deepEqual(tracklists1001.normalizeTracklist(tracks), [{ ...tracks[0], artUrl: '' }])
  assert.equal(
    tracklists1001._test.isDefaultArtworkUrl('https://cdn.1001tracklists.com/images/artworks/default_100.png'),
    true
  )
  assert.equal(tracklists1001._test.isDefaultArtworkUrl('https://example.com/default_100.png'), false)
})
