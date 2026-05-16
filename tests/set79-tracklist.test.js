const test = require('node:test')
const assert = require('node:assert/strict')

const set79 = require('../plugins/tracklists/set79')

test('set79 constructs a tracklist URL from a SoundCloud path', async () => {
  const results = await set79.findTracklists({
    url: 'https://soundcloud.com/artist-name/set-title?si=ignored',
  })

  assert.deepEqual(results, [{
    url: 'https://set79.com/tracklist/soundcloud.com/artist-name/set-title',
    title: '',
  }])
})

test('set79 recognizes its own tracklist URLs', () => {
  assert.equal(set79.matchUrl('https://set79.com/tracklist/soundcloud.com/foo/bar'), true)
  assert.equal(set79.matchUrl('https://soundcloud.com/foo/bar'), false)
})
