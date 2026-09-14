const assert = require('node:assert/strict')
const test = require('node:test')
const { buildBackgroundRecognitionQueue, targetedSamplePoints } = require('../lib/background-recognition-plan')

test('background recognition covers the full set independently of playback', () => {
  assert.deepEqual(buildBackgroundRecognitionQueue(76, [], { now: 1000 }).map(item => item.seconds), [5, 25, 45, 65])
})

test('fresh samples resume from cache while expired samples are retried', () => {
  const now = Date.parse('2026-09-14T12:00:00Z')
  const observations = [
    { playbackTimestamp: 10, capturedAt: '2026-09-14T11:59:00Z' },
    { playbackTimestamp: 30, capturedAt: '2026-09-12T11:59:00Z' },
  ]
  assert.deepEqual(buildBackgroundRecognitionQueue(56, observations, { now }).map(item => item.seconds), [25, 45])
})

test('targeted retries collect up to three confirmations inside a segment', () => {
  assert.deepEqual(targetedSamplePoints(100, 170), [102, 122, 142])
  assert.deepEqual(targetedSamplePoints(100, 108), [])
})
