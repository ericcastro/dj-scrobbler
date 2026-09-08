const test = require('node:test')
const assert = require('node:assert/strict')

const {
  artworkLookupKey,
  chooseDeezerArtwork,
  deezerSearchUrl,
  isArtworkLookupCandidate,
  normalizeTitle,
} = require('../lib/deezer-artwork')

function track(overrides = {}) {
  return {
    artist: 'AGATA & Subsequence',
    title: 'Arcana',
    artUrl: '',
    isId: false,
    ...overrides,
  }
}

function result(overrides = {}) {
  return {
    id: 2866847212,
    title: 'Arcana',
    artist: { name: 'AGATA & SUBSEQUENCE' },
    album: {
      cover_medium: 'https://cdn-images.dzcdn.net/images/cover/hash/250x250.jpg',
      cover_big: 'https://cdn-images.dzcdn.net/images/cover/hash/500x500.jpg',
      cover_xl: 'https://cdn-images.dzcdn.net/images/cover/hash/1000x1000.jpg',
    },
    ...overrides,
  }
}

test('only identified tracks with both labels and no existing art are eligible', () => {
  assert.equal(isArtworkLookupCandidate(track()), true)
  assert.equal(isArtworkLookupCandidate(track({ isApproximate: true })), true,
    'a labeled approximate identification is still eligible')
  assert.equal(isArtworkLookupCandidate(track({ isId: true })), false)
  assert.equal(isArtworkLookupCandidate(track({ artist: 'ID' })), false)
  assert.equal(isArtworkLookupCandidate(track({ artist: 'Unknown Artist' })), false)
  assert.equal(isArtworkLookupCandidate(track({ title: '?' })), false)
  assert.equal(isArtworkLookupCandidate(track({ artist: '' })), false)
  assert.equal(isArtworkLookupCandidate(track({ artUrl: 'https://existing.test/art.jpg' })), false)
  assert.equal(isArtworkLookupCandidate(track({ artUrl: '   ' })), true)
})

test('Deezer searches are structured, bounded, and require no API credential', () => {
  const url = deezerSearchUrl(track({ artist: '240 KM/H & RESA UTOPICA', title: 'CORRIDA' }))
  assert.equal(url.origin, 'https://api.deezer.com')
  assert.equal(url.pathname, '/search')
  assert.equal(url.searchParams.get('q'), 'artist:"240 KM/H & RESA UTOPICA" track:"CORRIDA"')
  assert.equal(url.searchParams.get('limit'), '10')
  for (const forbidden of ['key', 'token', 'secret', 'client_id']) {
    assert.equal(url.searchParams.has(forbidden), false)
  }
})

test('matching is strict on title while allowing Deezer to name only the primary collaborator', () => {
  const wanted = track({ artist: '240 KM/H & RESA UTOPICA', title: 'CORRIDA' })
  const match = chooseDeezerArtwork(wanted, [
    result({ title: 'Corrida', artist: { name: 'Someone Else' } }),
    result({ title: 'CORRIDA', artist: { name: '240 KM/H' } }),
  ])

  assert.equal(match.artUrl, 'https://cdn-images.dzcdn.net/images/cover/hash/250x250.jpg')
  assert.equal(match.deezerTrackId, '2866847212')
})

test('matching tolerates accents and the set79-only Mixed suffix', () => {
  const wanted = track({ artist: 'Kamäleon', title: 'Trapez (Radio Edit) [Mixed]' })
  const match = chooseDeezerArtwork(wanted, [
    result({ title: 'Trapez (Radio Edit)', artist: { name: 'Kamaleon' } }),
  ])

  assert.ok(match)
  assert.equal(normalizeTitle('Trapez (Radio Edit) [Mixed]'), 'trapez radio edit')
  assert.equal(artworkLookupKey(wanted), 'kamaleon\u001ftrapez radio edit')
})

test('wrong titles, partial artist names, and oversized or foreign image URLs are rejected', () => {
  assert.equal(chooseDeezerArtwork(track(), [result({ title: 'Arcana Remix' })]), null)
  assert.equal(chooseDeezerArtwork(track(), [result({ artist: { name: 'AGA' } })]), null)
  assert.equal(chooseDeezerArtwork(track(), [result({ album: {
    cover_medium: null,
    cover_big: 'https://cdn-images.dzcdn.net/images/cover/hash/500x500.jpg',
  } })]), null)
  assert.equal(chooseDeezerArtwork(track(), [result({ album: {
    cover_medium: 'https://images.example.test/wrong.jpg',
  } })]), null)
})
