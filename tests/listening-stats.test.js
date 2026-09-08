const test = require('node:test')
const assert = require('node:assert/strict')

const {
  aggregateRange,
  djIdForName,
  emptyStats,
  localDayKey,
  migrateStats,
  recordListening,
  recordTrack,
  samplePlayback,
  setIdFor,
  totals,
  upsertSet,
} = require('../lib/listening-stats')

function set(overrides = {}) {
  return {
    sourceId: 'youtube',
    sourceUrl: 'https://www.youtube.com/watch?v=abc123',
    title: 'A great set',
    djNames: ['DJ Alpha'],
    ...overrides,
  }
}

test('v1 lifetime stats migrate without inventing historical set attribution', () => {
  const stats = migrateStats({
    totalListenedSeconds: 123.456,
    totalTracksListened: 7,
    listenDays: ['2026-09-01', '2026-02-31', 'bad-date', '2026-09-01'],
    firstListenDate: '2026-08-31',
  })

  assert.equal(stats.schemaVersion, 2)
  assert.deepEqual(stats.legacy, {
    listenedMs: 123456,
    tracksListened: 7,
    listenDays: ['2026-09-01'],
    firstListenDate: '2026-08-31',
  })
  assert.deepEqual(stats.days, {})
  assert.deepEqual(totals(stats), {
    totalListenedSeconds: 123.456,
    totalTracksListened: 7,
    listenDays: ['2026-09-01'],
    firstListenDate: '2026-08-31',
  })
})

test('YouTube set identity is stable across canonical URL variants', () => {
  assert.equal(
    setIdFor({ sourceId: 'youtube', sourceUrl: 'https://youtu.be/abc123?t=10' }),
    setIdFor({ sourceId: 'youtube', sourceUrl: 'https://www.youtube.com/watch?v=abc123&list=xyz' })
  )
  assert.equal(setIdFor(set()), 'youtube:abc123')
})

test('listening and track counts are recorded per local day and set', () => {
  const stats = emptyStats()
  const startedAt = new Date(2026, 8, 7, 12, 0, 0).getTime()

  recordListening(stats, set(), startedAt, startedAt + 1250)
  recordListening(stats, set(), startedAt + 2000, startedAt + 2750)
  recordTrack(stats, set(), startedAt + 3000)

  const day = localDayKey(startedAt)
  assert.deepEqual(stats.days[day].sets['youtube:abc123'], {
    listenedMs: 2000,
    tracksListened: 1,
  })
  assert.equal(totals(stats).totalListenedSeconds, 2)
  assert.equal(totals(stats).totalTracksListened, 1)
})

test('playback sampling accepts continuous play and rejects pauses, seeks, and long gaps', () => {
  const initial = samplePlayback(null, { isPlaying: true, currentTime: 10 }, 1000, 'set-url')
  assert.equal(initial.interval, null)

  const continuous = samplePlayback(initial.current, { isPlaying: true, currentTime: 10.5 }, 1500, 'set-url')
  assert.deepEqual(continuous.interval, { startedAtMs: 1000, endedAtMs: 1500 })

  assert.equal(samplePlayback(continuous.current, { isPlaying: false, currentTime: 10.7 }, 2000, 'set-url').interval, null)
  assert.equal(samplePlayback(continuous.current, { isPlaying: true, currentTime: 40 }, 2000, 'set-url').interval, null)
  assert.equal(samplePlayback(continuous.current, { isPlaying: true, currentTime: 11 }, 5000, 'set-url').interval, null)
  assert.equal(samplePlayback(continuous.current, { isPlaying: true, currentTime: 11 }, 2000, 'other-set').interval, null)
})

test('a listening interval crossing midnight is split between local days', () => {
  const stats = emptyStats()
  const startedAt = new Date(2026, 8, 7, 23, 59, 59, 500).getTime()
  const endedAt = startedAt + 1000

  recordListening(stats, set(), startedAt, endedAt)

  assert.equal(stats.days['2026-09-07'].sets['youtube:abc123'].listenedMs, 500)
  assert.equal(stats.days['2026-09-08'].sets['youtube:abc123'].listenedMs, 500)
})

test('metadata arriving after playback attributes earlier set time to its DJs', () => {
  const stats = emptyStats()
  const startedAt = new Date(2026, 8, 7, 12, 0, 0).getTime()
  const withoutMetadata = set({ djNames: [] })

  recordListening(stats, withoutMetadata, startedAt, startedAt + 60_000)
  assert.deepEqual(aggregateRange(stats, '2026-09-07', '2026-09-07').djs, [])

  upsertSet(stats, set({ djNames: ['DJ Alpha'] }))
  assert.deepEqual(aggregateRange(stats, '2026-09-07', '2026-09-07').djs, [{
    id: 'dj alpha',
    name: 'DJ Alpha',
    listenedMs: 60_000,
    tracksListened: 0,
  }])
})

test('each DJ in a shared set receives full listening-time credit', () => {
  const stats = emptyStats()
  const startedAt = new Date(2026, 8, 7, 12, 0, 0).getTime()
  recordListening(stats, set({ djNames: ['DJ Alpha', 'DJ Beta'] }), startedAt, startedAt + 60_000)

  const result = aggregateRange(stats, '2026-09-07', '2026-09-07')
  assert.equal(result.listenedMs, 60_000)
  assert.deepEqual(result.djs.map(dj => [dj.name, dj.listenedMs]), [
    ['DJ Alpha', 60_000],
    ['DJ Beta', 60_000],
  ])
})

test('date ranges can power weekly set and DJ rankings', () => {
  const stats = emptyStats()
  const sunday = new Date(2026, 8, 6, 12, 0, 0).getTime()
  const monday = new Date(2026, 8, 7, 12, 0, 0).getTime()
  const secondSet = set({
    sourceUrl: 'https://www.youtube.com/watch?v=def456',
    title: 'Longer set',
    djNames: ['DJ Beta'],
  })

  recordListening(stats, set(), sunday, sunday + 90_000)
  recordListening(stats, set(), monday, monday + 30_000)
  recordListening(stats, secondSet, monday, monday + 60_000)

  const week = aggregateRange(stats, '2026-09-07', '2026-09-13')
  assert.equal(week.listenedMs, 90_000)
  assert.deepEqual(week.sets.map(item => [item.title, item.listenedMs]), [
    ['Longer set', 60_000],
    ['A great set', 30_000],
  ])
  assert.deepEqual(week.djs.map(item => [item.name, item.listenedMs]), [
    ['DJ Beta', 60_000],
    ['DJ Alpha', 30_000],
  ])
})

test('DJ identifiers normalize Unicode, case, and whitespace', () => {
  assert.equal(djIdForName('  DJ   Alpha  '), 'dj alpha')
  assert.equal(djIdForName('ＤＪ Alpha'), 'dj alpha')
})

test('malformed v2 records and dangling daily set references are discarded', () => {
  const stats = migrateStats({
    schemaVersion: 2,
    legacy: { listenedMs: -1, tracksListened: 'nope' },
    djs: { alpha: { name: 'Alpha' } },
    sets: {
      valid: { sourceId: 'youtube', sourceUrl: 'https://example.com/set', title: 'Set', djIds: ['alpha', 'missing'] },
      invalid: { title: 'No URL' },
    },
    days: {
      '2026-09-07': {
        sets: {
          valid: { listenedMs: 1000, tracksListened: 2 },
          missing: { listenedMs: 5000 },
        },
      },
      nope: { sets: { valid: { listenedMs: 5000 } } },
    },
  })

  assert.deepEqual(stats.sets.valid.djIds, ['alpha'])
  assert.deepEqual(stats.days, {
    '2026-09-07': { sets: { valid: { listenedMs: 1000, tracksListened: 2 } } },
  })
  assert.equal(totals(stats).totalListenedSeconds, 1)
})
