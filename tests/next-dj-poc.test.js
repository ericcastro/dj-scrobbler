const test = require('node:test')
const assert = require('node:assert/strict')

const {
  askYesNo,
  countryMatches,
  exactAreaEvents,
  formatEvent,
  noMatchMessage,
  parseArgs,
  parseRadius,
  rankArtists,
  selectArea,
} = require('../scripts/pocs/next-dj')
const { artistMatches, dateFromText, locationMatches, selectEarliestMatches } = require('../scripts/pocs/next-dj/core')
const { jsonLdEvents } = require('../scripts/pocs/next-dj/html-events')
const { parseBrowserOutput } = require('../scripts/pocs/next-dj/shotgun-browser-client')
const {
  createEdmtrainSource,
  edmtrainArtistMatches,
  edmtrainLocationMatches,
} = require('../scripts/pocs/next-dj/sources/edmtrain')
const { querySources } = require('../scripts/pocs/next-dj/sources')
const { passlineSearchUrl } = require('../scripts/pocs/next-dj/sources/passline')
const { createShotgunSource } = require('../scripts/pocs/next-dj/sources/shotgun')

const PARIS = {
  id: '44',
  name: 'Paris',
  urlName: 'paris',
  country: { id: '15', name: 'France', urlCode: 'FR' },
}

test('selectArea requires an exact city and country match', () => {
  const areas = [
    PARIS,
    {
      id: '999',
      name: 'Paris',
      urlName: 'paris',
      country: { id: '2', name: 'United States of America', urlCode: 'US' },
    },
  ]

  assert.equal(selectArea(areas, 'paris', 'FR'), PARIS)
  assert.equal(selectArea(areas, 'Paris', 'France'), PARIS)
  assert.equal(selectArea(areas, 'Paris', 'Germany'), null)
})

test('countryMatches recognizes common US and UK spellings', () => {
  assert.equal(countryMatches({ name: 'United States of America', urlCode: 'US' }, 'USA'), true)
  assert.equal(countryMatches({ name: 'United Kingdom', urlCode: 'UK' }, 'GB'), true)
  assert.equal(countryMatches({ name: 'France', urlCode: 'FR' }, 'US'), false)
})

test('rankArtists puts normalized exact names first', () => {
  const ranked = rankArtists([
    { id: '2', value: 'Ben', searchType: 'ARTIST' },
    { id: '1', value: 'Ben UFO', searchType: 'ARTIST' },
    { id: '3', value: 'Ben UFO night', searchType: 'EVENT' },
  ], 'ben ufo')

  assert.deepEqual(ranked.map(item => item.id), ['1', '2'])
})

test('exactAreaEvents excludes other cities and prior dates', () => {
  const events = [
    event('past', '44', '2026-09-05T00:00:00.000', '2026-09-05T23:00:00.000'),
    event('london', '13', '2026-09-07T00:00:00.000', '2026-09-07T20:00:00.000'),
    event('later', '44', '2026-09-08T00:00:00.000', '2026-09-08T22:00:00.000'),
    event('next', '44', '2026-09-07T00:00:00.000', '2026-09-07T23:00:00.000'),
  ]

  assert.deepEqual(
    exactAreaEvents(events, PARIS, '2026-09-06').map(item => item.id),
    ['next', 'later'],
  )
})

test('formatEvent keeps RA local clock text and builds an absolute link', () => {
  const formatted = formatEvent(event(
    '42',
    '44',
    '2026-10-02T00:00:00.000',
    '2026-10-02T23:30:00.000',
  ))

  assert.equal(formatted.date, '2026-10-02')
  assert.match(formatted.dateLabel, /23:30$/)
  assert.equal(formatted.url, 'https://ra.co/events/42')
})

test('parseRadius accepts exact and reserves numeric radius searches', () => {
  assert.deepEqual(parseRadius(''), { mode: 'exact', km: null })
  assert.deepEqual(parseRadius('exact'), { mode: 'exact', km: null })
  assert.throws(() => parseRadius('25 km'), /next iteration/)
})

test('saved-location confirmation defaults to no on Enter', async () => {
  const prompts = []
  const readline = {
    question: async prompt => {
      prompts.push(prompt)
      return ''
    },
  }

  assert.equal(await askYesNo(readline, 'Change location?', false), false)
  assert.deepEqual(prompts, ['Change location? [n]: '])
})

test('saved-location confirmation accepts a yes answer', async () => {
  const readline = { question: async () => 'yes' }
  assert.equal(await askYesNo(readline, 'Change location?', false), true)
})

test('parseArgs supports a non-interactive exact-city lookup', () => {
  assert.deepEqual(parseArgs([
    '--city', 'Paris', '--country', 'FR', '--dj', 'Ben UFO', '--radius', 'exact', '--json',
  ]), {
    city: 'Paris',
    configPath: null,
    configure: false,
    country: 'FR',
    dj: 'Ben UFO',
    help: false,
    json: true,
    radius: 'exact',
    sources: null,
    verbose: false,
  })
  assert.throws(() => parseArgs(['--city', 'Paris']), /must be used together/)
})

test('selectEarliestMatches announces one date and merges obvious cross-source duplicates', () => {
  const result = selectEarliestMatches([
    sourceResult('resident-advisor', 'Resident Advisor', [normalizedEvent('ra', '2026-09-10', 'Club X')]),
    sourceResult('shotgun', 'Shotgun', [
      normalizedEvent('sg', '2026-09-10', 'Club X'),
      normalizedEvent('other', '2026-09-10', 'Warehouse Y'),
      normalizedEvent('later', '2026-09-11', 'Club Z'),
    ]),
  ], '2026-09-06')

  assert.equal(result.date, '2026-09-10')
  assert.equal(result.matches.length, 2)
  assert.deepEqual(result.matches[0].sources.map(source => source.id), ['resident-advisor', 'shotgun'])
})

test('artist matching is exact for lineup arrays and word-bounded for card text', () => {
  assert.equal(artistMatches(['Ben UFO', 'Four Tet'], 'ben ufo'), true)
  assert.equal(artistMatches(['Ben'], 'Ben UFO'), false)
  assert.equal(artistMatches('Nü Androids presents: Ben UFO', 'Ben UFO'), true)
  assert.equal(artistMatches('Benny UFO tribute', 'Ben UFO'), false)
})

test('JSON-LD event pages normalize into the shared event shape', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'MusicEvent',
    name: 'Ben UFO',
    startDate: '2026-10-24T19:00:00',
    url: 'https://example.com/event',
    performer: [{ '@type': 'Person', name: 'Ben UFO' }],
    location: {
      '@type': 'Place',
      name: 'The Roundhouse',
      address: { addressLocality: 'London', addressCountry: 'UK' },
    },
  })}</script>`
  const parsed = jsonLdEvents(html, 'https://example.com/fallback')

  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].date, '2026-10-24')
  assert.deepEqual(parsed[0].artists, ['Ben UFO'])
  assert.equal(parsed[0].city, 'London')
})

test('regional page fallbacks understand Shotgun and Passline date/city text', () => {
  const now = new Date(2026, 8, 6)
  assert.equal(dateFromText('Sat, Oct 24 | 7:00 PM', now), '2026-10-24')
  assert.equal(dateFromText('Domingo 18 de Octubre 2026 - 19:00 hrs.', now), '2026-10-18')
  assert.equal(locationMatches({ city: 'Capital Federal', country: 'AR' }, {
    city: 'Buenos Aires', countryCode: 'AR',
  }), true)
})

test('regional source routing reflects the intended coverage', () => {
  const shotgun = createShotgunSource({ browserSearch: async () => { throw new Error('not called') } })
  assert.equal(shotgun.appliesTo({ countryCode: 'BR' }), true)
  assert.equal(shotgun.appliesTo({ countryCode: 'FR' }), true)
  assert.equal(shotgun.appliesTo({ countryCode: 'US' }), false)

  const url = new URL(passlineSearchUrl('DJ Nelson', { countryCode: 'AR' }))
  assert.equal(url.searchParams.get('q'), 'DJ Nelson')
  assert.equal(url.searchParams.get('pais'), 'argentina')
})

test('Shotgun browser results resolve exact artists and cities without guessing slugs', async () => {
  const source = createShotgunSource({
    browserSearch: async () => [
      shotgunEvent('Clouds', 'Lyon', '2026-10-10T21:00:00.000Z'),
      shotgunEvent('CLOUDY', 'Paris', '2026-12-18T22:00:00.000Z'),
    ],
  })
  const result = await source.findNext({
    artist: 'Cloudy',
    location: { city: 'Paris', countryCode: 'FR' },
    today: '2026-09-06',
  })

  assert.equal(result.status, 'ok')
  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].title, 'CLOUDY event')
  assert.equal(result.events[0].date, '2026-12-18')
  assert.equal(result.events[0].startTime, '2026-12-18T23:00:00')
  assert.equal(result.events[0].venue, 'Phantom Paris')
})

test('browser helper output is isolated from Electron log noise', () => {
  assert.deepEqual(parseBrowserOutput(`warning\n__SHOTGUN_BROWSER_RESULT__{"ok":true,"events":[]}\n`), {
    ok: true,
    events: [],
  })
})

test('no-match copy distinguishes unavailable coverage from a checked empty result', () => {
  const base = { artist: 'Cloudy', location: { city: 'Paris' } }
  assert.match(noMatchMessage({ ...base, sources: [sourceStatus('shotgun', 'unavailable')] }), /Could not determine/)
  assert.match(noMatchMessage({ ...base, sources: [sourceStatus('shotgun', 'ok')] }), /^No upcoming/)
  assert.match(noMatchMessage({
    ...base,
    sources: [sourceStatus('resident-advisor', 'ok'), sourceStatus('shotgun', 'unavailable')],
  }), /sources that responded/)
})

test('Edmtrain stays disabled without a key or explicit combination permission', async () => {
  const source = createEdmtrainSource({ clientKey: null, combinationApproved: false })
  const result = await source.findNext({
    artist: 'Ben UFO',
    location: { city: 'New York', countryCode: 'US' },
    today: '2026-09-06',
  })
  assert.equal(result.status, 'disabled')
  assert.match(result.message, /EDMTRAIN_CLIENT_KEY/)
})

test('Edmtrain recognizes artist qualifiers and Washington DC location variants', () => {
  assert.equal(edmtrainArtistMatches('Cloudy (Germany)', 'Cloudy'), true)
  assert.equal(edmtrainArtistMatches('Clouds', 'Cloudy'), false)
  const washington = {
    city: 'Washington',
    stateCode: 'DC',
    link: 'https://edmtrain.com/washington-dc',
  }
  assert.equal(edmtrainLocationMatches(washington, 'Washington DC'), true)
  assert.equal(edmtrainLocationMatches(washington, 'Washington'), true)
})

test('an isolated Edmtrain lookup needs a key but not multi-source permission', async () => {
  const responses = [
    {
      success: true,
      data: [{
        id: 243,
        city: 'Washington',
        stateCode: 'DC',
        countryCode: 'US',
        link: 'https://edmtrain.com/washington-dc',
      }],
    },
    {
      success: true,
      data: [{
        id: 72519,
        link: 'https://edmtrain.com/washington-dc/cloudy-72519',
        date: '2026-09-11',
        venue: { name: 'Echostage' },
        artistList: [{ name: 'Cloudy (Germany)' }],
      }],
    },
  ]
  const source = createEdmtrainSource({
    clientKey: 'test-key',
    combinationApproved: false,
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify(responses.shift()) }),
  })
  const [result] = await querySources([source], {
    artist: 'Cloudy',
    location: { city: 'Washington DC', countryCode: 'US' },
    today: '2026-09-06',
  }, ['edmtrain'])

  assert.equal(result.status, 'ok')
  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].venue, 'Echostage')
})

test('Edmtrain remains disabled in multi-source mode without combination permission', async () => {
  const source = createEdmtrainSource({ clientKey: 'test-key', combinationApproved: false })
  const other = {
    id: 'other',
    name: 'Other',
    scope: 'Global',
    appliesTo: () => true,
    findNext: async () => sourceResult('other', 'Other', []),
  }
  const results = await querySources([source, other], {
    artist: 'Cloudy',
    location: { city: 'Washington DC', countryCode: 'US' },
    today: '2026-09-06',
  })

  assert.equal(results[0].status, 'disabled')
  assert.match(results[0].message, /multi-source/)
})

function event(id, areaId, date, startTime) {
  return {
    id,
    title: `Event ${id}`,
    date,
    startTime,
    contentUrl: `/events/${id}`,
    venue: {
      id: `venue-${id}`,
      name: `Venue ${id}`,
      area: {
        id: areaId,
        name: areaId === '44' ? 'Paris' : 'London',
        country: areaId === '44'
          ? { name: 'France', urlCode: 'FR' }
          : { name: 'United Kingdom', urlCode: 'UK' },
      },
    },
  }
}

function sourceResult(sourceId, sourceName, events) {
  return { sourceId, sourceName, status: 'ok', events }
}

function normalizedEvent(id, date, venue) {
  const sourceId = id === 'ra' ? 'resident-advisor' : 'shotgun'
  const sourceName = sourceId === 'resident-advisor' ? 'Resident Advisor' : 'Shotgun'
  return {
    id,
    sourceId,
    sourceName,
    title: id === 'other' ? 'Different party' : 'Ben UFO',
    date,
    startTime: `${date}T22:00:00`,
    dateLabel: date,
    venue,
    url: `https://example.com/${id}`,
  }
}

function shotgunEvent(artist, city, startDate) {
  return {
    url: `https://shotgun.live/en/events/${artist.toLowerCase()}`,
    localStartTime: '23:00',
    event: {
      '@type': 'MusicEvent',
      name: `${artist} event`,
      startDate,
      performer: [{ '@type': 'MusicGroup', name: artist }],
      location: {
        '@type': 'Place',
        name: city === 'Paris' ? 'Phantom Paris' : 'Le Sucre',
        address: { addressLocality: city, addressCountry: 'FR' },
      },
    },
  }
}

function sourceStatus(sourceId, status) {
  return { sourceId, sourceName: sourceId, status, events: [], message: null }
}
