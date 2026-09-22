const test = require('node:test')
const assert = require('node:assert/strict')

const {
  captureDurationWithinSegment,
  manualIdentificationPatch,
  publishedRecognitionEditPatch,
  publishedRecognitionMatchPatch,
  recognitionRateLimitBackoffMs,
  targetedRecognitionDecision,
} = require('../lib/recognition-session-policy')
const { upsertRecognitionObservation } = require('../lib/recognition-timeline')

function observation(playbackTimestamp, id = null) {
  return {
    playbackTimestamp,
    recognition: id
      ? { matched: true, artist: 'Artist', title: `Track ${id}`, shazamTrackId: id }
      : { matched: false },
  }
}

function normalized(...items) {
  const observations = []
  for (const item of items) upsertRecognitionObservation(observations, item)
  return observations
}

test('targeted recognition confirms a third equal result immediately', () => {
  const result = targetedRecognitionDecision(normalized(
    observation(10, 'a'),
    observation(24, 'a'),
    observation(36, 'a'),
  ), 36)
  assert.equal(result.confirmed.recognition.title, 'Track a')
  assert.equal(result.confirmed.confirmedAt, 36)
  assert.equal(result.candidate, null)
})

test('targeted recognition does not promote two stale equal results', () => {
  const result = targetedRecognitionDecision(normalized(
    observation(10, 'a'),
    observation(24, 'a'),
    observation(71),
  ), 71)
  assert.equal(result.confirmed, null)
  assert.equal(result.candidate, null)
})

test('targeted recognition exposes only repeated provisional matches', () => {
  assert.equal(targetedRecognitionDecision(normalized(observation(10, 'a')), 10).candidate, null)
  const result = targetedRecognitionDecision(normalized(
    observation(10, 'a'),
    observation(24, 'a'),
  ), 24)
  assert.equal(result.confirmed, null)
  assert.equal(result.candidate.count, 2)
})

test('segment capture never crosses the next published cue', () => {
  assert.equal(captureDurationWithinSegment(10, 30), 10)
  assert.equal(captureDurationWithinSegment(20, 30), 9.5)
  assert.equal(captureDurationWithinSegment(22, 30), null)
  assert.equal(captureDurationWithinSegment(10, null), 10)
})

test('recognition throttling backs off exponentially with a cap', () => {
  assert.equal(recognitionRateLimitBackoffMs(500, 1), 0)
  assert.equal(recognitionRateLimitBackoffMs(429, 1), 120_000)
  assert.equal(recognitionRateLimitBackoffMs(403, 2), 240_000)
  assert.equal(recognitionRateLimitBackoffMs(429, 10), 900_000)
})

test('published recognition patches keep correction, deletion, and match semantics distinct', () => {
  const corrected = publishedRecognitionEditPatch('wrong', { artist: 'Correct Artist', title: 'Correct Title' })
  assert.equal(corrected.raw, 'Correct Artist - Correct Title')
  assert.equal(corrected.manualIdentified, true)
  assert.equal(corrected.autoRecognized, false)

  const removed = publishedRecognitionEditPatch('delete')
  assert.equal(removed.title, 'ID — ID')
  assert.equal(removed.isId, true)
  assert.equal(removed.scrobbledOnConfirmation, false)

  const matched = publishedRecognitionMatchPatch({
    artist: 'Shazam Artist',
    title: 'Shazam Title',
    shazamTrackId: '123',
  })
  assert.equal(matched.recognition.shazamTrackId, '123')
  assert.equal(matched.autoRecognized, true)
  assert.equal(matched.scrobbledOnConfirmation, true)
})

test('manual identification validates and normalizes user labels', () => {
  const patch = manualIdentificationPatch({ artist: '  Artist  ', title: '  Title  ' })
  assert.equal(patch.raw, 'Artist - Title')
  assert.throws(() => manualIdentificationPatch({ artist: '', title: 'Title' }), /required/)
})
