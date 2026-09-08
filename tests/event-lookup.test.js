const test = require('node:test')
const assert = require('node:assert/strict')

const {
  artistMatches,
  countryMatches,
  earliestEvent,
  formatDateLabel,
  locationMatches,
} = require('../lib/event-lookup-core')
const { withinDeadline } = require('../lib/shotgun-browser')
const { lookupNextEvents } = require('../plugins/events')
const { ResidentAdvisorClient, selectArea } = require('../plugins/events/resident-advisor')
const { createShotgunSource } = require('../plugins/events/shotgun')

const PARIS = {
  id: '44',
  name: 'Paris',
  urlName: 'paris',
  country: { name: 'France', urlCode: 'FR' },
}

test('Resident Advisor location setup requires the exact city and country', () => {
  const texas = { ...PARIS, id: '99', country: { name: 'United States', urlCode: 'US' } }
  assert.equal(selectArea([texas, PARIS], 'Paris', 'FR'), PARIS)
  assert.equal(selectArea([texas, PARIS], 'Paris', 'US'), texas)
  assert.equal(selectArea([PARIS], 'Paris', 'DE'), null)
  assert.equal(selectArea([PARIS], 'Paris', '', 'France'), PARIS)
})

test('event dates use deterministic English copy rather than the operating-system locale', () => {
  assert.equal(formatDateLabel('2026-12-18', '2026-12-18T23:00:00'), 'Fri, 18 Dec 2026 · 23:00')
})

test('event matching is exact for artist and configured city', () => {
  assert.equal(artistMatches(['Cloudy'], 'Cloudy'), true)
  assert.equal(artistMatches(['Cloudy Bay'], 'Cloudy'), false)
  assert.equal(locationMatches({ city: 'Paris', country: 'France' }, { city: 'Paris', country: 'France', countryCode: 'FR' }), true)
  assert.equal(locationMatches({ city: 'Paris', country: 'United States' }, { city: 'Paris', country: 'France', countryCode: 'FR' }), false)
  assert.equal(locationMatches({ city: 'Paris 11e', country: 'France' }, { city: 'Paris', country: 'France', countryCode: 'FR' }), false)
  assert.equal(locationMatches({ city: null, country: 'France' }, { city: 'Paris', country: 'France', countryCode: 'FR' }), false)
  assert.equal(locationMatches({ city: 'London', country: 'UK' }, { city: 'London', country: 'United Kingdom', countryCode: 'GB' }), true)
  assert.equal(countryMatches('USA', 'US'), true)
})

test('Resident Advisor never substitutes a fuzzy artist result', async () => {
  const client = new ResidentAdvisorClient()
  client.query = async () => ({
    search: [
      { id: 'wrong', value: 'Cloudy Bay', searchType: 'ARTIST' },
      { id: 'event', value: 'Cloudy', searchType: 'EVENT' },
    ],
  })

  assert.equal(await client.searchArtist('Cloudy'), null)
})

test('Shotgun normalizes structured MusicEvent results and filters other cities', async () => {
  const source = createShotgunSource({
    browserSearch: async () => [
      shotgunEvent('Cloudy at Phantom', 'Cloudy', 'Paris', '2026-12-18T23:00:00+01:00'),
      shotgunEvent('Cloudy elsewhere', 'Cloudy', 'Lyon', '2026-11-01T23:00:00+01:00'),
    ],
  })
  const events = await source.findEvents({
    artist: 'Cloudy',
    location: { city: 'Paris', country: 'France', countryCode: 'FR' },
    today: '2026-09-07',
  })
  assert.equal(events.length, 1)
  assert.equal(events[0].date, '2026-12-18')
  assert.equal(events[0].sourceName, 'Shotgun')
})

test('multi-source lookup returns one earliest event per DJ and keeps source priority on ties', async () => {
  const progress = []
  const sources = [
    fakeSource('resident-advisor', 10, {
      Cloudy: normalizedEvent('ra-cloudy', '2026-12-18', 'Resident Advisor'),
      Anetha: normalizedEvent('ra-anetha', '2027-01-01', 'Resident Advisor'),
    }),
    fakeSource('shotgun', 20, {
      Cloudy: normalizedEvent('shotgun-cloudy', '2026-12-18', 'Shotgun'),
      Anetha: normalizedEvent('shotgun-anetha', '2026-10-02', 'Shotgun'),
    }),
  ]
  const results = await lookupNextEvents({
    djNames: ['Cloudy', 'Anetha'],
    location: { city: 'Paris', country: 'France', countryCode: 'FR' },
    today: '2026-09-07',
    sources,
    onProgress: update => progress.push(update),
  })
  assert.equal(results.length, 2)
  assert.equal(results[0].event.id, 'ra-cloudy')
  assert.equal(results[1].event.id, 'shotgun-anetha')
  assert.equal(earliestEvent([results[0].event, results[1].event]).id, 'shotgun-anetha')
  assert.equal(progress.at(-1).completed, 4)
  assert.equal(progress.at(-1).total, 4)
  assert.ok(progress.some(update => update.artist === 'Cloudy' && update.activeSourceNames.length === 2))
})

test('Shotgun browser operations cannot outlive the lookup deadline', async () => {
  assert.equal(await withinDeadline(Promise.resolve('ok'), Date.now() + 100), 'ok')
  await assert.rejects(
    withinDeadline(new Promise(() => {}), Date.now() + 10),
    /timed out/
  )
})

function shotgunEvent(title, artist, city, startDate) {
  return {
    url: `https://shotgun.live/en/events/${title.toLowerCase().replace(/\s+/g, '-')}`,
    event: {
      '@type': 'MusicEvent',
      name: title,
      startDate,
      location: { name: 'Phantom', address: { addressLocality: city, addressCountry: 'France' } },
      performer: [{ name: artist }],
    },
  }
}

function normalizedEvent(id, date, sourceName) {
  return { id, date, startTime: `${date}T23:00:00`, sourceName, url: 'https://example.com', title: id, venue: 'Venue' }
}

function fakeSource(id, priority, events) {
  return {
    id,
    name: id,
    priority,
    appliesTo: () => true,
    findEvents: async ({ artist }) => events[artist] ? [events[artist]] : [],
  }
}
