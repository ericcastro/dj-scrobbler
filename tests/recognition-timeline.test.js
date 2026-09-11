const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildRecognitionTimeline,
  segmentAtTime,
  upsertRecognitionObservation,
} = require('../lib/recognition-timeline')

const match = (playbackTimestamp, artist, title, shazamTrackId) => ({
  playbackTimestamp,
  recognition: { matched: true, artist, title, shazamTrackId },
})
const miss = playbackTimestamp => ({ playbackTimestamp, recognition: { matched: false } })

test('successive recognition of the same track extends one timeline row across misses', () => {
  const timeline = buildRecognitionTimeline([
    match(30, 'Cloudy', 'Pulse', '1'),
    miss(60),
    match(90, 'Cloudy', 'Pulse', '1'),
  ], { sessionStartSeconds: 15 })

  assert.equal(timeline.length, 1)
  assert.equal(timeline[0].autoRecognized, true)
  assert.equal(timeline[0].cueSeconds, 15)
  assert.equal(timeline[0].estimatedEndSeconds, 105)
  assert.equal(timeline[0].recognitionSource, 'shazam')
})

test('a trailing recognition miss stays a provisional ID row', () => {
  const timeline = buildRecognitionTimeline([
    match(30, 'DJ A', 'Track A', 'a'),
    miss(60),
    miss(90),
    miss(120),
  ], { sessionStartSeconds: 15 })

  assert.equal(timeline.length, 2)
  assert.equal(timeline[1].title, 'ID — ID')
  assert.equal(timeline[1].finalized, false)
  assert.equal(timeline[1].isLongRecognitionGap, false)
})

test('a later different match turns a long unresolved run into a distinctive gap', () => {
  const timeline = buildRecognitionTimeline([
    match(30, 'DJ A', 'Track A', 'a'),
    miss(60), miss(90), miss(120), miss(150),
    match(180, 'DJ B', 'Track B', 'b'),
  ], { sessionStartSeconds: 15, longGapSeconds: 90 })

  assert.deepEqual(timeline.map(item => item.title), ['Track A', 'Unidentified gap', 'Track B'])
  assert.equal(timeline[1].finalized, true)
  assert.equal(timeline[1].estimatedEndSeconds - timeline[1].cueSeconds, 120)
  assert.equal(segmentAtTime(timeline, 100), timeline[1])
})

test('a short bounded miss stays an ID row and adjacent tracks share a boundary', () => {
  const withMiss = buildRecognitionTimeline([
    match(30, 'DJ A', 'Track A', 'a'),
    miss(60),
    match(90, 'DJ B', 'Track B', 'b'),
  ], { sessionStartSeconds: 15 })
  assert.deepEqual(withMiss.map(item => item.title), ['Track A', 'ID — ID', 'Track B'])
  assert.equal(withMiss[1].estimatedEndSeconds - withMiss[1].cueSeconds, 30)

  const adjacent = buildRecognitionTimeline([
    match(30, 'DJ A', 'Track A', 'a'),
    match(60, 'DJ B', 'Track B', 'b'),
  ], { sessionStartSeconds: 15 })
  assert.equal(adjacent[0].estimatedEndSeconds, 45)
  assert.equal(adjacent[1].cueSeconds, 45)
})

test('seek observations replace a nearby sample instead of producing duplicates', () => {
  const observations = [miss(90)]
  assert.equal(upsertRecognitionObservation(observations, match(92, 'DJ', 'Found', 'x')), true)
  assert.equal(observations.length, 1)
  assert.equal(observations[0].recognition.title, 'Found')
})
