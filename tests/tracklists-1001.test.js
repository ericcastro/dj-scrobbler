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
