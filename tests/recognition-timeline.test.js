const test = require('node:test')
const assert = require('node:assert/strict')

const {
  applyRecognitionDecision,
  buildRecognitionTimeline,
  carryForwardRecognitionDecision,
  randomSampleIntervalSeconds,
  recognitionRecoveryPoints,
  segmentAtTime,
  upsertRecognitionObservation,
} = require('../lib/recognition-timeline')

const match = (playbackTimestamp, artist, title, shazamTrackId, extra = {}) => ({
  playbackTimestamp,
  recognition: { matched: true, artist, title, shazamTrackId, ...extra },
})
const miss = playbackTimestamp => ({ playbackTimestamp, recognition: { matched: false } })
const committedTracks = timeline => timeline.filter(track => !track.isRecognitionCandidate)

test('the first Shazam result becomes a muted analysis candidate', () => {
  const one = buildRecognitionTimeline([
    match(10, 'Cloudy', 'Pulse', '1'),
  ], { sessionStartSeconds: 0 })
  assert.equal(one.length, 1)
  assert.equal(one[0].isRecognitionCandidate, true)
  assert.equal(one[0].recognitionCandidateCount, 1)

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

test('a no-match can clear the visible candidate without discarding confidence evidence', () => {
  const observations = [
    match(10, 'Nic Johnston & Acina', "Don't Call My Phone", '1'),
    miss(30),
  ]
  const hidden = buildRecognitionTimeline(observations, {
    sessionStartSeconds: 0,
    displayCandidate: false,
  })
  assert.deepEqual(hidden, [])

  const resumed = buildRecognitionTimeline([
    ...observations,
    match(45, 'Nic Johnston & Acina', "Don't Call My Phone", '1'),
  ], { sessionStartSeconds: 0 })
  assert.equal(resumed[0].isRecognitionCandidate, true)
  assert.equal(resumed[0].recognitionCandidateCount, 2)
})

test('one Shazam response stays provisional regardless of internal match count', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'Noise', 'Maybe', 'x', { matchCount: 4 }),
  ], { sessionStartSeconds: 0 })

  assert.equal(committedTracks(timeline).length, 0)
  assert.equal(timeline[0].recognitionCandidateCount, 1)
})

test('cached observations retain audio-capture diagnostics', () => {
  const observations = []
  upsertRecognitionObservation(observations, {
    ...miss(10),
    capture: { rms: 0.12, peak: 0.8, pcmDigest: 'abc123' },
  })

  assert.deepEqual(observations[0].capture, {
    rms: 0.12,
    peak: 0.8,
    pcmDigest: 'abc123',
  })
})

test('recovery points cover playback spans that were never sampled', () => {
  const points = recognitionRecoveryPoints([
    miss(10),
    miss(25),
    miss(310),
  ], 325, {
    maximumObservedGapSeconds: 45,
    sampleSpacingSeconds: 90,
    edgePaddingSeconds: 15,
    staleAfterMs: 0,
  })

  assert.deepEqual(points, [40, 130, 220])
})

test('old no-match observations are retried while confirmed regions are left alone', () => {
  const capturedAt = '2026-01-01T00:00:00.000Z'
  const observations = [
    { ...miss(10), capturedAt },
    { ...match(100, 'Cloudy', 'Pulse', '1'), capturedAt },
    { ...match(110, 'Cloudy', 'Pulse', '1'), capturedAt },
    { ...match(120, 'Cloudy', 'Pulse', '1'), capturedAt },
    { ...miss(400), capturedAt },
  ]
  const points = recognitionRecoveryPoints(observations, 410, {
    maximumObservedGapSeconds: 500,
    sampleSpacingSeconds: 60,
    staleAfterMs: 24 * 60 * 60 * 1000,
    now: Date.parse('2026-01-03T00:00:00.000Z'),
  })

  assert.deepEqual(points, [10, 400])
})

test('two equal Shazam results expire instead of graduating when their window closes', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'Cloudy', 'Pulse', '1'),
    match(24, 'Cloudy', 'Pulse', '1'),
    miss(100),
  ], { sessionStartSeconds: 0 })

  assert.deepEqual(timeline, [])
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
  assert.equal(timeline[0].recognitionConfirmationCount, 3)
  assert.equal(timeline[0].isRecognitionCandidate, undefined)
})

test('clustered confirmations do not substitute for evidence across time', () => {
  const clustered = buildRecognitionTimeline([
    match(830, 'Enrique Iglesias', 'Hero', 'hero'),
    match(840, 'Enrique Iglesias', 'Hero', 'hero'),
    match(850, 'Enrique Iglesias', 'Hero', 'hero'),
    miss(870),
  ], {
    sessionStartSeconds: 0,
    minimumConfirmationSpanSeconds: 30,
  })
  assert.equal(clustered.some(track => !track.isRecognitionCandidate && track.title === 'Hero'), false)
  assert.equal(clustered[0].isRecognitionCandidate, true)
  assert.equal(clustered[0].recognitionCandidateCount, 3)
  assert.equal(clustered[0].recognitionRequiredCount, 3)

  const sustained = buildRecognitionTimeline([
    match(830, 'DJ A', 'Real Track', 'real'),
    match(850, 'DJ A', 'Real Track', 'real'),
    match(870, 'DJ A', 'Real Track', 'real'),
  ], {
    sessionStartSeconds: 0,
    minimumConfirmationSpanSeconds: 30,
  })
  assert.deepEqual(sustained.map(track => track.title), ['Real Track'])
})

test('equal results outside the confidence window never commit', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'DJ A', 'Track A', 'a'),
    match(72, 'DJ A', 'Track A', 'a'),
    match(135, 'DJ A', 'Track A', 'a'),
  ], { sessionStartSeconds: 0 })

  assert.equal(committedTracks(timeline).length, 0)
})

test('two early matches cannot wait indefinitely for a much later third result', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'DJ A', 'Track A', 'a'),
    match(30, 'DJ A', 'Track A', 'a'),
    miss(90),
    match(150, 'DJ A', 'Track A', 'a'),
  ], { sessionStartSeconds: 0 })

  assert.equal(committedTracks(timeline).length, 0)
})

test('two separated pairs of the same result never combine into confidence', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'DJ A', 'Track A', 'a'),
    match(30, 'DJ A', 'Track A', 'a'),
    miss(110),
    match(190, 'DJ A', 'Track A', 'a'),
    match(210, 'DJ A', 'Track A', 'a'),
    miss(290),
  ], { sessionStartSeconds: 0 })

  assert.deepEqual(timeline, [])
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

  const committed = committedTracks(timeline)
  assert.equal(committed.length, 1)
  assert.equal(committed[0].observedEndSeconds, 34)
})

test('the same confirmed track on both sides of a restart seam merges automatically', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'DJ A', 'Main', 'a'),
    match(22, 'DJ A', 'Main', 'a'),
    match(34, 'DJ A', 'Main', 'a'),
    match(114, 'DJ A', 'Main', 'a'),
    match(126, 'DJ A', 'Main', 'a'),
    match(138, 'DJ A', 'Main', 'a'),
  ], { sessionStartSeconds: 0, sampleIntervalSeconds: 12 })

  assert.deepEqual(timeline.map(track => track.title), ['Main'])
  assert.equal(timeline[0].observedEndSeconds, 138)
  assert.equal(timeline[0].recognitionConfirmationCount, 6)
})

test('an earlier episode discovered after its matching next episode still merges chronologically', () => {
  const timeline = buildRecognitionTimeline([
    // The later region was acquired first because playback had resume priority.
    match(210, 'DJ A', 'Main', 'a'),
    match(230, 'DJ A', 'Main', 'a'),
    match(250, 'DJ A', 'Main', 'a'),
    // The background sweep subsequently worked backward into the same track.
    match(90, 'DJ A', 'Main', 'a'),
    match(110, 'DJ A', 'Main', 'a'),
    match(130, 'DJ A', 'Main', 'a'),
  ], { sessionStartSeconds: 0, sampleIntervalSeconds: 20 })

  assert.deepEqual(timeline.map(track => track.title), ['Main'])
  assert.equal(timeline[0].observedStartSeconds, 90)
  assert.equal(timeline[0].observedEndSeconds, 250)
})

test('resume-priority coverage renders an analysis-pending span instead of moving the track to zero', () => {
  const timeline = buildRecognitionTimeline([
    match(830, 'DJ A', 'Current Track', 'current'),
    match(850, 'DJ A', 'Current Track', 'current'),
    match(870, 'DJ A', 'Current Track', 'current'),
  ], {
    sessionStartSeconds: 0,
    sampleIntervalSeconds: 20,
    pendingSampleTimes: [10, 30, 50, 70, 90, 110, 130, 150, 170, 190, 210, 230, 250, 270, 290, 310, 330, 350, 370, 390, 410, 430, 450, 470, 490, 510, 530, 550, 570, 590, 610, 630, 650, 670, 690, 710, 730, 750, 770, 790, 810],
  })

  assert.deepEqual(timeline.map(track => track.title), ['', 'Current Track'])
  assert.equal(timeline[0].isRecognitionAnalysisPending, true)
  assert.equal(timeline[0].cueSeconds, 0)
  assert.equal(timeline[1].cueSeconds, 820)
})

test('a live candidate is placed before the pending span it is currently analysing', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'Opening Track', 'Intro', 'opening'),
    match(25, 'Opening Track', 'Intro', 'opening'),
    match(45, 'Opening Track', 'Intro', 'opening'),
    miss(250),
    match(3320, 'Current Track', 'Now', 'current'),
    match(3340, 'Current Track', 'Now', 'current'),
    match(3360, 'Current Track', 'Now', 'current'),
  ], {
    sessionStartSeconds: 0,
    pendingSampleTimes: [270, 300, 600, 1200, 2400],
    displayCandidate: false,
  })

  const placeholder = {
    type: 'candidate',
    isRecognitionCandidate: true,
    isRecognitionPlaceholder: true,
  }
  const { insertRecognitionCandidate } = require('../lib/recognition-timeline')
  insertRecognitionCandidate(timeline, placeholder, 250)
  const pendingIndex = timeline.findIndex(track => track.isRecognitionAnalysisPending)
  assert.equal(timeline[pendingIndex - 1], placeholder)
})

test('a repeated confirmed track collapses automatic detections sandwiched inside it', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'DJ A', 'Main', 'a'),
    match(30, 'DJ A', 'Main', 'a'),
    match(50, 'DJ A', 'Main', 'a'),
    match(90, 'Noise B', 'Sample B', 'b'),
    match(110, 'Noise B', 'Sample B', 'b'),
    match(130, 'Noise B', 'Sample B', 'b'),
    match(170, 'Noise C', 'Sample C', 'c'),
    match(190, 'Noise C', 'Sample C', 'c'),
    match(210, 'Noise C', 'Sample C', 'c'),
    match(250, 'DJ A', 'Main', 'a'),
    match(270, 'DJ A', 'Main', 'a'),
    match(290, 'DJ A', 'Main', 'a'),
  ], { sessionStartSeconds: 0, sampleIntervalSeconds: 20 })

  assert.deepEqual(timeline.map(track => track.title), ['Main'])
  assert.equal(timeline[0].observedEndSeconds, 290)
})

test('a user-confirmed track survives between two appearances of another track', () => {
  const timeline = buildRecognitionTimeline([
    match(10, 'DJ A', 'Main', 'a'),
    match(30, 'DJ A', 'Main', 'a'),
    match(50, 'DJ A', 'Main', 'a'),
    match(90, 'DJ B', 'Deliberate', 'b', { userConfirmed: true }),
    match(250, 'DJ A', 'Main', 'a'),
    match(270, 'DJ A', 'Main', 'a'),
    match(290, 'DJ A', 'Main', 'a'),
  ], { sessionStartSeconds: 0, sampleIntervalSeconds: 20 })

  assert.deepEqual(timeline.map(track => track.title), ['Main', 'Deliberate', 'Main'])
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
    setEndSeconds: 280,
  })
  assert.deepEqual(long.map(track => track.title), ['Track A', 'ID — ID'])
})

test('four minutes is the lower boundary for a standalone unknown segment', () => {
  const short = buildRecognitionTimeline([
    match(10, 'DJ A', 'Track A', 'a'),
    match(22, 'DJ A', 'Track A', 'a'),
    match(34, 'DJ A', 'Track A', 'a'),
    match(280, 'DJ B', 'Track B', 'b'),
    match(292, 'DJ B', 'Track B', 'b'),
    match(304, 'DJ B', 'Track B', 'b'),
  ], { sessionStartSeconds: 0, sampleIntervalSeconds: 12 })
  assert.deepEqual(short.map(track => track.title), ['Track A', 'Track B'])

  const atThreshold = buildRecognitionTimeline([
    match(10, 'DJ A', 'Track A', 'a'),
    match(22, 'DJ A', 'Track A', 'a'),
    match(34, 'DJ A', 'Track A', 'a'),
    match(286, 'DJ B', 'Track B', 'b'),
    match(298, 'DJ B', 'Track B', 'b'),
    match(310, 'DJ B', 'Track B', 'b'),
  ], { sessionStartSeconds: 0, sampleIntervalSeconds: 12 })
  assert.deepEqual(atThreshold.map(track => track.title), ['Track A', 'ID — ID', 'Track B'])
})

test('only an eight-minute unresolved span is treated as potentially multiple tracks', () => {
  const timelineForNextTrack = firstSample => buildRecognitionTimeline([
    match(10, 'DJ A', 'Track A', 'a'),
    match(22, 'DJ A', 'Track A', 'a'),
    match(34, 'DJ A', 'Track A', 'a'),
    match(firstSample, 'DJ B', 'Track B', 'b'),
    match(firstSample + 12, 'DJ B', 'Track B', 'b'),
    match(firstSample + 24, 'DJ B', 'Track B', 'b'),
  ], { sessionStartSeconds: 0, sampleIntervalSeconds: 12 })

  const ordinaryTrackLength = timelineForNextTrack(326)
  assert.equal(ordinaryTrackLength[1].title, 'ID — ID')
  assert.equal(ordinaryTrackLength[1].isLongRecognitionGap, false)

  const credibleMultiTrackSpan = timelineForNextTrack(526)
  assert.equal(credibleMultiTrackSpan[1].title, 'ID — ID')
  assert.equal(credibleMultiTrackSpan[1].isLongRecognitionGap, true)
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
