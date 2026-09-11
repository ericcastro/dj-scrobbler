const test = require('node:test')
const assert = require('node:assert/strict')

const {
  applyRecognitionDecision,
  buildRecognitionTimeline,
  carryForwardRecognitionDecision,
  randomSampleIntervalSeconds,
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
  ], { sessionStartSeconds: 15, sampleIntervalSeconds: 30 })

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
  ], { sessionStartSeconds: 15, sampleIntervalSeconds: 30 })

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
  ], { sessionStartSeconds: 15, sampleIntervalSeconds: 30, longGapSeconds: 90 })

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
  ], { sessionStartSeconds: 15, sampleIntervalSeconds: 30 })
  assert.deepEqual(withMiss.map(item => item.title), ['Track A', 'ID — ID', 'Track B'])
  assert.equal(withMiss[1].estimatedEndSeconds - withMiss[1].cueSeconds, 30)

  const adjacent = buildRecognitionTimeline([
    match(30, 'DJ A', 'Track A', 'a'),
    match(60, 'DJ B', 'Track B', 'b'),
  ], { sessionStartSeconds: 15, sampleIntervalSeconds: 30 })
  assert.equal(adjacent[0].estimatedEndSeconds, 45)
  assert.equal(adjacent[1].cueSeconds, 45)
})

test('seek observations replace a nearby sample instead of producing duplicates', () => {
  const observations = [miss(90)]
  assert.equal(upsertRecognitionObservation(observations, match(92, 'DJ', 'Found', 'x')), true)
  assert.equal(observations.length, 1)
  assert.equal(observations[0].recognition.title, 'Found')
})

test('a track returning after one or two identifications becomes an automatic mashup', () => {
  const timeline = buildRecognitionTimeline([
    match(30, 'DJ A', 'Main Track', 'a'),
    match(45, 'DJ B', 'Overlay', 'b'),
    match(60, 'DJ A', 'Main Track', 'a'),
  ], { sessionStartSeconds: 15, sampleIntervalSeconds: 15 })

  assert.equal(timeline.length, 2)
  assert.equal(timeline[0].title, 'Main Track')
  assert.equal(timeline[0].isAutoMashupParent, true)
  assert.equal(timeline[0].observedEndSeconds, 60)
  assert.equal(timeline[1].title, 'Overlay')
  assert.equal(timeline[1].isWWith, true)
  assert.equal(timeline[1].isAutoMashupCandidate, true)
  assert.equal(timeline[1].cueDisplay, '0:37')
})

test('three intervening tracks remain peers instead of being guessed as a mashup', () => {
  const timeline = buildRecognitionTimeline([
    match(15, 'DJ A', 'Main', 'a'),
    match(30, 'DJ B', 'One', 'b'),
    match(45, 'DJ C', 'Two', 'c'),
    match(60, 'DJ D', 'Three', 'd'),
    match(75, 'DJ A', 'Main', 'a'),
  ], { sessionStartSeconds: 8, sampleIntervalSeconds: 15 })

  assert.equal(timeline.length, 5)
  assert.equal(timeline.some(track => track.isAutoMashupCandidate), false)
})

test('a track returning much later is not mistaken for an immediate mashup', () => {
  const timeline = buildRecognitionTimeline([
    match(15, 'DJ A', 'Main', 'a'),
    match(30, 'DJ B', 'Full Track', 'b'),
    match(90, 'DJ B', 'Full Track', 'b'),
    match(105, 'DJ A', 'Main', 'a'),
  ], { sessionStartSeconds: 8, sampleIntervalSeconds: 15 })

  assert.deepEqual(timeline.map(track => track.title), ['Main', 'Full Track', 'Main'])
  assert.equal(timeline.some(track => track.isAutoMashupCandidate), false)
})

test('automatic recognition decisions persist through observation data', () => {
  const observations = [match(30, 'DJ A', 'Wrong', 'a'), match(45, 'DJ A', 'Wrong', 'a')]
  let track = buildRecognitionTimeline(observations, { sessionStartSeconds: 20 })[0]
  assert.equal(applyRecognitionDecision(observations, track, 'confirm'), 2)
  track = buildRecognitionTimeline(observations, { sessionStartSeconds: 20 })[0]
  assert.equal(track.autoRecognized, false)
  assert.equal(track.userConfirmed, true)

  assert.equal(applyRecognitionDecision(observations, track, 'wrong', { artist: 'Fixed DJ', title: 'Fixed Track' }), 2)
  track = buildRecognitionTimeline(observations, { sessionStartSeconds: 20 })[0]
  assert.equal(track.artist, 'Fixed DJ')
  assert.equal(track.title, 'Fixed Track')
  assert.equal(track.autoRecognized, false)

  assert.equal(applyRecognitionDecision(observations, track, 'delete'), 2)
  const deleted = buildRecognitionTimeline(observations, { sessionStartSeconds: 20 })
  assert.equal(deleted.length, 1)
  assert.equal(deleted[0].title, 'ID — ID')
})

test('a nearby repeated fingerprint keeps a manual correction', () => {
  const observations = [match(30, 'Wrong DJ', 'Wrong Track', 'wrong-id')]
  const track = buildRecognitionTimeline(observations, { sessionStartSeconds: 20 })[0]
  applyRecognitionDecision(observations, track, 'wrong', { artist: 'Correct DJ', title: 'Correct Track' })
  const repeated = carryForwardRecognitionDecision(observations, 43, {
    matched: true,
    artist: 'Wrong DJ',
    title: 'Wrong Track',
    shazamTrackId: 'wrong-id',
  })

  assert.equal(repeated.artist, 'Correct DJ')
  assert.equal(repeated.title, 'Correct Track')
  assert.equal(repeated.userConfirmed, true)
})

test('a deleted mashup candidate becomes an explicit ID region', () => {
  const observations = [
    match(30, 'DJ A', 'Main', 'a'),
    match(45, 'DJ B', 'Wrong Overlay', 'b'),
    match(60, 'DJ A', 'Main', 'a'),
  ]
  const candidate = buildRecognitionTimeline(observations, {
    sessionStartSeconds: 20,
    sampleIntervalSeconds: 15,
  }).find(track => track.isAutoMashupCandidate)
  assert.equal(applyRecognitionDecision(observations, candidate, 'delete'), 1)
  const timeline = buildRecognitionTimeline(observations, {
    sessionStartSeconds: 20,
    sampleIntervalSeconds: 15,
  })
  assert.deepEqual(timeline.map(track => track.title), ['Main', 'ID — ID', 'Main'])

  const repeated = { matched: true, artist: 'DJ B', title: 'Wrong Overlay', shazamTrackId: 'b' }
  assert.equal(carryForwardRecognitionDecision(observations, 55, repeated).matched, false)
  assert.equal(carryForwardRecognitionDecision(observations, 55, repeated, { preserveDeleted: false }).matched, true)
})

test('deleting a long automatic match explicitly returns it to ID — ID', () => {
  const observations = [
    match(30, 'DJ A', 'Long Wrong Match', 'a'),
    match(90, 'DJ A', 'Long Wrong Match', 'a'),
    match(150, 'DJ A', 'Long Wrong Match', 'a'),
  ]
  const track = buildRecognitionTimeline(observations, {
    sessionStartSeconds: 15,
    sampleIntervalSeconds: 30,
  })[0]
  assert.equal(applyRecognitionDecision(observations, track, 'delete'), 3)
  const timeline = buildRecognitionTimeline(observations, {
    sessionStartSeconds: 15,
    sampleIntervalSeconds: 30,
    longGapSeconds: 90,
  })
  assert.equal(timeline[0].title, 'ID — ID')
  assert.equal(timeline[0].isLongRecognitionGap, false)
})

test('recognition cadence is fuzzed inclusively between eleven and fifteen seconds', () => {
  assert.equal(randomSampleIntervalSeconds(() => 0), 11)
  assert.equal(randomSampleIntervalSeconds(() => 0.5), 13)
  assert.equal(randomSampleIntervalSeconds(() => 0.999999), 15)
})
