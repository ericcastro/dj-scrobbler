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

const match = (playbackTimestamp, artist, title, shazamTrackId, extra = {}) => ({
  playbackTimestamp,
  recognition: { matched: true, artist, title, shazamTrackId, ...extra },
})
const miss = playbackTimestamp => ({ playbackTimestamp, recognition: { matched: false } })

test('only two equal Shazam results become a muted analysis candidate', () => {
  const one = buildRecognitionTimeline([
    match(10, 'Cloudy', 'Pulse', '1'),
  ], { sessionStartSeconds: 0 })
  assert.equal(one.length, 0)

  const two = buildRecognitionTimeline([
    match(10, 'Cloudy', 'Pulse', '1'),
    miss(22),
    match(35, 'Cloudy', 'Pulse', '1'),
  ], { sessionStartSeconds: 0 })
  assert.equal(two.length, 1)
  assert.equal(two[0].isRecognitionCandidate, true)
  assert.equal(two[0].recognitionCandidateCount, 2)
  assert.equal(segmentAtTime(two, 35), null)
})

test('two equal Shazam results graduate when their sixty-second window closes', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'Cloudy', 'Pulse', '1'),
    match(24, 'Cloudy', 'Pulse', '1'),
    miss(71),
  ], { sessionStartSeconds: 0 })

  assert.equal(timeline.length, 1)
  assert.equal(timeline[0].title, 'Pulse')
  assert.equal(timeline[0].confirmationTimestamp, 70)
  assert.equal(timeline[0].autoRecognized, true)
})

test('the third equal result within sixty seconds commits one track', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'Cloudy', 'Pulse', '1'),
    miss(22),
    match(35, 'Cloudy', 'Pulse', '1'),
    match(58, 'Cloudy', 'Pulse', '1'),
  ], { sessionStartSeconds: 0 })

  assert.equal(timeline.length, 1)
  assert.equal(timeline[0].title, 'Pulse')
  assert.equal(timeline[0].autoRecognized, true)
  assert.equal(timeline[0].observedStartSeconds, 10)
  assert.equal(timeline[0].confirmationTimestamp, 58)
  assert.equal(timeline[0].isRecognitionCandidate, undefined)
})

test('equal results outside the confidence window never commit', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'DJ A', 'Track A', 'a'),
    match(72, 'DJ A', 'Track A', 'a'),
    match(135, 'DJ A', 'Track A', 'a'),
  ], { sessionStartSeconds: 0 })

  assert.equal(timeline.length, 0)
})

test('a return to the committed track clears short-lived pollution', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'DJ A', 'Main', 'a'),
    match(22, 'DJ A', 'Main', 'a'),
    match(34, 'DJ A', 'Main', 'a'),
    match(46, 'DJ B', 'Pollution', 'b'),
    match(58, 'DJ B', 'Pollution', 'b'),
    match(70, 'DJ A', 'Main', 'a'),
  ], { sessionStartSeconds: 0 })

  assert.deepEqual(timeline.map(track => track.title), ['Main'])
  assert.equal(timeline[0].observedEndSeconds, 70)
})

test('the same fingerprint returning after a long silence must earn confidence again', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'DJ A', 'Main', 'a'),
    match(22, 'DJ A', 'Main', 'a'),
    match(34, 'DJ A', 'Main', 'a'),
    miss(60), miss(90),
    match(110, 'DJ A', 'Main', 'a'),
  ], { sessionStartSeconds: 0 })

  assert.equal(timeline.length, 1)
  assert.equal(timeline[0].observedEndSeconds, 34)
})

test('the first matching sample after a bounded restart seam extends the cached track', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'DJ A', 'Main', 'a'),
    match(22, 'DJ A', 'Main', 'a'),
    match(34, 'DJ A', 'Main', 'a'),
    match(114, 'DJ A', 'Main', 'a', { continuesPreviousSession: true }),
    match(126, 'DJ A', 'Main', 'a'),
  ], { sessionStartSeconds: 0, sampleIntervalSeconds: 12 })

  assert.deepEqual(timeline.map(track => track.title), ['Main'])
  assert.equal(timeline[0].observedEndSeconds, 126)
})

test('wrong one-off matches do not pollute the committed tracklist', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'DJ A', 'Track A', 'a'),
    match(22, 'Noise', 'Wrong', 'x'),
    match(34, 'DJ A', 'Track A', 'a'),
    match(46, 'DJ A', 'Track A', 'a'),
  ], { sessionStartSeconds: 0 })

  assert.deepEqual(timeline.map(track => track.title), ['Track A'])
})

test('short unresolved time is absorbed into the preceding confirmed track', () => {
  const observations = [
    match(10, 'DJ A', 'Track A', 'a'),
    match(22, 'DJ A', 'Track A', 'a'),
    match(34, 'DJ A', 'Track A', 'a'),
    miss(46), miss(58), miss(70), miss(82),
  ]
  const beforeNextTrack = buildRecognitionTimeline(observations, {
    sessionStartSeconds: 0,
    sampleIntervalSeconds: 12,
  })
  assert.deepEqual(beforeNextTrack.map(track => track.title), ['Track A'])

  observations.push(
    match(94, 'DJ B', 'Track B', 'b'),
    match(106, 'DJ B', 'Track B', 'b'),
    match(118, 'DJ B', 'Track B', 'b'),
  )
  const finalized = buildRecognitionTimeline(observations, {
    sessionStartSeconds: 0,
    sampleIntervalSeconds: 12,
  })
  assert.deepEqual(finalized.map(track => track.title), ['Track A', 'Track B'])
  assert.equal(finalized[0].estimatedEndSeconds, 88)
  assert.equal(finalized[1].cueSeconds, 88)
})

test('adjacent confirmed tracks collapse into a shared boundary', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'DJ A', 'Track A', 'a'),
    match(22, 'DJ A', 'Track A', 'a'),
    match(34, 'DJ A', 'Track A', 'a'),
    match(46, 'DJ B', 'Track B', 'b'),
    match(58, 'DJ B', 'Track B', 'b'),
    match(70, 'DJ B', 'Track B', 'b'),
  ], { sessionStartSeconds: 0, sampleIntervalSeconds: 12 })

  assert.deepEqual(timeline.map(track => track.title), ['Track A', 'Track B'])
  assert.equal(timeline[0].estimatedEndSeconds, 40)
  assert.equal(timeline[1].cueSeconds, 40)
})

test('a brief failed sample stays with the preceding track after confirmation', () => {
  const observations = [
    match(10, 'DJ A', 'Track A', 'a'),
    match(22, 'DJ A', 'Track A', 'a'),
    match(34, 'DJ A', 'Track A', 'a'),
    miss(46),
    match(58, 'DJ B', 'Track B', 'b'),
    match(70, 'DJ B', 'Track B', 'b'),
  ]
  assert.deepEqual(buildRecognitionTimeline(observations, {
    sessionStartSeconds: 0,
    sampleIntervalSeconds: 12,
  }).map(track => track.title), ['Track A', 'Track B'])

  observations.push(match(82, 'DJ B', 'Track B', 'b'))
  const finalized = buildRecognitionTimeline(observations, {
    sessionStartSeconds: 0,
    sampleIntervalSeconds: 12,
  })
  assert.deepEqual(finalized.map(track => track.title), ['Track A', 'Track B'])
  assert.equal(finalized[0].estimatedEndSeconds, 52)
  assert.equal(finalized[1].cueSeconds, 52)
})

test('the end of the set absorbs short uncertainty and finalizes a long gap', () => {
  const observations = [
    match(10, 'DJ A', 'Track A', 'a'),
    match(22, 'DJ A', 'Track A', 'a'),
    match(34, 'DJ A', 'Track A', 'a'),
    miss(46), miss(58), miss(70),
  ]
  const short = buildRecognitionTimeline(observations, {
    sessionStartSeconds: 0,
    sampleIntervalSeconds: 12,
    setEndSeconds: 85,
  })
  assert.deepEqual(short.map(track => track.title), ['Track A'])
  assert.equal(short[0].estimatedEndSeconds, 85)

  const long = buildRecognitionTimeline(observations, {
    sessionStartSeconds: 0,
    sampleIntervalSeconds: 12,
    setEndSeconds: 260,
  })
  assert.deepEqual(long.map(track => track.title), ['Track A', 'ID — ID'])
})

test('two minutes is the lower boundary for a standalone unknown segment', () => {
  const short = buildRecognitionTimeline([
    match(10, 'DJ A', 'Track A', 'a'),
    match(22, 'DJ A', 'Track A', 'a'),
    match(34, 'DJ A', 'Track A', 'a'),
    match(160, 'DJ B', 'Track B', 'b'),
    match(172, 'DJ B', 'Track B', 'b'),
    match(184, 'DJ B', 'Track B', 'b'),
  ], { sessionStartSeconds: 0, sampleIntervalSeconds: 12 })
  assert.deepEqual(short.map(track => track.title), ['Track A', 'Track B'])

  const atThreshold = buildRecognitionTimeline([
    match(10, 'DJ A', 'Track A', 'a'),
    match(22, 'DJ A', 'Track A', 'a'),
    match(34, 'DJ A', 'Track A', 'a'),
    match(166, 'DJ B', 'Track B', 'b'),
    match(178, 'DJ B', 'Track B', 'b'),
    match(190, 'DJ B', 'Track B', 'b'),
  ], { sessionStartSeconds: 0, sampleIntervalSeconds: 12 })
  assert.deepEqual(atThreshold.map(track => track.title), ['Track A', 'ID — ID', 'Track B'])
})

test('a completed set with no confirmed match becomes one unresolved region', () => {
  const timeline = buildRecognitionTimeline([
    miss(10),
    match(22, 'Noise', 'Wrong', 'x'),
    miss(34),
  ], { sessionStartSeconds: 0, setEndSeconds: 75 })
  assert.deepEqual(timeline.map(track => track.title), ['ID — ID'])
  assert.equal(timeline[0].isRecognitionUnidentified, true)
})

test('seek observations replace a nearby sample instead of producing duplicates', () => {
  const observations = [miss(90)]
  assert.equal(upsertRecognitionObservation(observations, match(92, 'DJ', 'Found', 'x')), true)
  assert.equal(observations.length, 1)
  assert.equal(observations[0].recognition.title, 'Found')
})

test('automatic recognition decisions persist through observation data', () => {
  const observations = [
    match(30, 'DJ A', 'Wrong', 'a'),
    match(43, 'DJ A', 'Wrong', 'a'),
    match(56, 'DJ A', 'Wrong', 'a'),
  ]
  let track = buildRecognitionTimeline(observations, { sessionStartSeconds: 20 })[0]
  assert.equal(applyRecognitionDecision(observations, track, 'confirm'), 3)
  track = buildRecognitionTimeline(observations, { sessionStartSeconds: 20 })[0]
  assert.equal(track.autoRecognized, false)
  assert.equal(track.userConfirmed, true)

  assert.equal(applyRecognitionDecision(observations, track, 'wrong', { artist: 'Fixed DJ', title: 'Fixed Track' }), 3)
  track = buildRecognitionTimeline(observations, { sessionStartSeconds: 20 })[0]
  assert.equal(track.title, 'Fixed Track')

  assert.equal(applyRecognitionDecision(observations, track, 'delete'), 3)
  assert.deepEqual(buildRecognitionTimeline(observations, {
    sessionStartSeconds: 20,
    setEndSeconds: 100,
  }).map(item => item.title), ['ID — ID'])
})

test('a nearby repeated fingerprint keeps a manual correction', () => {
  const observations = [match(30, 'Wrong DJ', 'Wrong Track', 'wrong-id', { userConfirmed: true })]
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

test('recognition cadence is fuzzed inclusively between ten and fifteen seconds', () => {
  assert.equal(randomSampleIntervalSeconds(() => 0, { minSeconds: 10, maxSeconds: 15 }), 10)
  assert.equal(randomSampleIntervalSeconds(() => 0.5, { minSeconds: 10, maxSeconds: 15 }), 13)
  assert.equal(randomSampleIntervalSeconds(() => 0.999999, { minSeconds: 10, maxSeconds: 15 }), 15)
})
