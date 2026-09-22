const test = require('node:test')
const assert = require('node:assert/strict')

const {
  artworkLookupKey,
  chooseDeezerArtwork,
  deezerFallbackSearchUrl,
  deezerSearchUrl,
  isArtworkLookupCandidate,
  lookupDeezerArtwork,
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

test('Deezer falls back to an unquoted collaborative-credit query', () => {
  const url = deezerFallbackSearchUrl(track({
    artist: 'Argy, Son of Son & Anyma',
    title: 'Voices In My Head (Amelie Lens Remix) [Mixed]',
  }))
  assert.equal(url.searchParams.get('q'), 'Argy, Son of Son & Anyma Voices In My Head (Amelie Lens Remix) [Mixed]')
  assert.equal(url.searchParams.get('limit'), '10')
})

test('ambiguous YouTube comment rows try a verified split instead of guessing one', async () => {
  const wanted = track({
    artist: 'ID',
    title: 'A-Track - Like I Said',
    commentTracklist: true,
    commentAmbiguousSplits: [
      { artist: 'A', title: 'Track - Like I Said' },
      { artist: 'A-Track', title: 'Like I Said' },
    ],
  })
  assert.equal(isArtworkLookupCandidate(wanted), true)
  assert.equal(isArtworkLookupCandidate(track({ artist: 'ID', title: 'No Dash', commentTracklist: true })), false)
  const queries = []
  const match = await lookupDeezerArtwork(wanted, {
    requestJson: async url => {
      queries.push(url.searchParams.get('q'))
      return { data: url.searchParams.get('q').includes('A-Track')
        ? [result({ title: 'Like I Said', artist: { name: 'A-Track' } })]
        : [] }
    },
  })
  assert.deepEqual(queries, [
    'artist:"A" track:"Track - Like I Said"',
    'A Track - Like I Said',
    'artist:"A-Track" track:"Like I Said"',
  ])
  assert.equal(match.artist, 'A-Track')
  assert.equal(match.title, 'Like I Said')
})

test('comment artwork keys change when its split strategy changes, preserving ordinary artwork cache entries', () => {
  assert.equal(
    artworkLookupKey(track({ commentTracklist: true, raw: 'A-Track - Like I Said', artist: 'A-Track', title: 'Like I Said' })),
    'youtube-comment:v2:a track like i said'
  )
  assert.equal(artworkLookupKey(track()), 'agata subsequence\u001farcana')
})

test('ordinary one-dash YouTube comment tracks use their parsed artist and title without a split list', async () => {
  const wanted = track({ artist: 'Major Lazer', title: 'pAPi wiTH tOKisCha (DJ Gigola Remix)', commentTracklist: true })
  assert.equal(isArtworkLookupCandidate(wanted), true)
  const match = await lookupDeezerArtwork(wanted, {
    requestJson: async () => ({ data: [result({ title: wanted.title, artist: { name: wanted.artist } })] }),
  })
  assert.equal(match.artUrl, 'https://cdn-images.dzcdn.net/images/cover/hash/250x250.jpg')
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
