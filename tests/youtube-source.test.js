const test = require('node:test')
const assert = require('node:assert/strict')

const youtube = require('../plugins/sources/youtube')

test('YouTube source matches canonical watch URLs only', () => {
  assert.equal(youtube.matchUrl('https://www.youtube.com/watch?v=abcdefghijk'), true)
  assert.equal(youtube.matchUrl('https://youtube.com/watch?v=abcdefghijk&list=abc'), true)
  assert.equal(youtube.matchUrl('https://music.youtube.com/watch?v=abcdefghijk'), false)
  assert.equal(youtube.matchUrl('https://www.youtube.com/shorts/abcdefghijk'), false)
  assert.equal(youtube.matchUrl('not a url'), false)
})

test('YouTube search URL encodes user query', () => {
  assert.equal(
    youtube.searchQueryUrl('hernan cattaneo b2b nick warren'),
    'https://www.youtube.com/results?search_query=hernan%20cattaneo%20b2b%20nick%20warren'
  )
})

test('YouTube intercept parser only accepts its source prefix', () => {
  const url = 'https://www.youtube.com/watch?v=abcdefghijk'
  assert.equal(youtube.parseIntercept(`__INTERCEPT__youtube__${url}`), url)
  assert.equal(youtube.parseIntercept(`__INTERCEPT__soundcloud__${url}`), null)
})
