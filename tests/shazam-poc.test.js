const test = require('node:test')
const assert = require('node:assert/strict')

const {
  appendRecognitionTimeline,
  buildFrameAudioCaptureScript,
  chooseSamplePoints,
  fingerprintFloat32,
  normalizeRecognitionResponse,
  recognitionPayload,
  recognizeFloat32,
} = require('../lib/shazam-poc')

test('sample points avoid the intro and outro while covering the set', () => {
  assert.deepEqual(chooseSamplePoints(5_400), [972, 2124, 3276, 4428])
  assert.deepEqual(chooseSamplePoints(8), [])
  assert.deepEqual(chooseSamplePoints(120, { count: 1 }), [60])
})

test('PCM fingerprinting stays in memory and releases the WASM signature', () => {
  const samples = new Float32Array(16_000)
  for (let index = 0; index < samples.length; index++) samples[index] = Math.sin(index / 12) * 0.2
  const fingerprint = fingerprintFloat32(samples, 16_000)
  assert.match(fingerprint.uri, /^data:audio\/vnd\.shazam\.sig;base64,/)
  assert.ok(fingerprint.samplems > 900)
  assert.ok(fingerprint.numberSamples > 15_000)
})

test('recognition requests contain the signature but no captured audio bytes', () => {
  const payload = recognitionPayload({ uri: 'data:signature', samplems: 9_950 }, {
    timezone: 'Europe/Paris',
    timestamp: 123,
  })
  assert.deepEqual(payload, {
    timezone: 'Europe/Paris',
    signature: { uri: 'data:signature', samplems: 9_950 },
    timestamp: 123,
    context: {},
    geolocation: {},
  })
})

test('recognition normalization preserves useful Shazam metadata', () => {
  const result = normalizeRecognitionResponse({
    matches: [{ offset: 42.25 }, { offset: 42.5 }],
    track: {
      key: '12345',
      title: 'Track Title',
      subtitle: 'Track Artist',
      url: 'https://www.shazam.com/track/12345',
      genres: { primary: 'Electronic' },
    },
  }, { recognizedAt: '2026-09-11T10:00:00.000Z', samplems: 9_950 })

  assert.deepEqual(result, {
    matched: true,
    recognizedAt: '2026-09-11T10:00:00.000Z',
    artist: 'Track Artist',
    title: 'Track Title',
    shazamTrackId: '12345',
    shazamUrl: 'https://www.shazam.com/track/12345',
    genre: 'Electronic',
    matchCount: 2,
    matchOffsetSeconds: 42.25,
    samplems: 9_950,
  })
  assert.equal(normalizeRecognitionResponse({ matches: [] }).matched, false)
})

test('only successful, non-consecutive duplicate recognitions enter the timeline', () => {
  const timeline = []
  const first = { playbackTimestamp: 100, recognition: { matched: true, artist: 'Cloudy', title: 'Pulse' } }
  const duplicate = { playbackTimestamp: 130, recognition: { matched: true, artist: 'CLOUDY', title: 'PULSE' } }
  const miss = { playbackTimestamp: 160, recognition: { matched: false } }

  assert.deepEqual(appendRecognitionTimeline(timeline, first), { added: true, duplicateOf: null })
  assert.deepEqual(appendRecognitionTimeline(timeline, duplicate), { added: false, duplicateOf: 100 })
  assert.deepEqual(appendRecognitionTimeline(timeline, miss), { added: false, duplicateOf: null })
  assert.equal(timeline.length, 1)
})

test('recognizeFloat32 normalizes a mocked service response', async () => {
  const samples = new Float32Array(16_000)
  for (let index = 0; index < samples.length; index++) samples[index] = Math.sin(index / 15) * 0.1
  let request = null
  const output = await recognizeFloat32(samples, 16_000, {
    fetchImpl: async (_url, options) => {
      request = options
      return {
        ok: true,
        json: async () => ({
          matches: [{ offset: 1.5 }],
          track: { key: '9', title: 'POC', subtitle: 'DJ' },
        }),
      }
    },
  })
  assert.equal(request.method, 'POST')
  assert.equal(JSON.parse(request.body).signature.uri.startsWith('data:audio/vnd.shazam.sig;base64,'), true)
  assert.equal(output.result.matched, true)
  assert.equal(output.result.artist, 'DJ')
})

test('capture script requests frame display audio and never microphone input', () => {
  const script = buildFrameAudioCaptureScript({ clipSeconds: 9 })
  assert.match(script, /getDisplayMedia\(\{ video: true, audio: true \}\)/)
  assert.match(script, /OfflineAudioContext/)
  assert.doesNotMatch(script, /getUserMedia/)
  assert.match(script, /9000, 16000/)
})
