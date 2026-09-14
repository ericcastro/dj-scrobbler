const crypto = require('node:crypto')
const { DecodedSignature } = require('shazamio-core')

// Request shape and endpoint are compatible with the MIT-licensed ShazamIO
// implementation. This is an unofficial, reverse-engineered service surface.
const SHAZAM_ENDPOINT = 'https://amp.shazam.com/discovery/v5'
const SHAZAM_QUERY = 'sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3'

function chooseSamplePoints(durationSeconds, { count = 4, clipSeconds = 10 } = {}) {
  const duration = Number(durationSeconds)
  if (!Number.isFinite(duration) || duration <= clipSeconds) return []

  // Avoid intros/outros, then spread captures across the body of the set. Four
  // samples keeps a typical run below a minute while avoiding a single unlucky
  // transition or an unrecognisable unreleased track.
  const ratios = count === 1
    ? [0.5]
    : Array.from({ length: count }, (_unused, index) => 0.18 + (0.64 * index / (count - 1)))
  const latestStart = Math.max(0, duration - clipSeconds - 5)
  return [...new Set(ratios.map(ratio => Math.round(Math.min(latestStart, duration * ratio))))]
}

function normalizeComparisonText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/\b(feat|featuring|ft)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function comparisonTokens(value) {
  return new Set(normalizeComparisonText(value).split(/\s+/).filter(token => token.length > 1))
}

function tokenSimilarity(left, right) {
  const a = comparisonTokens(left)
  const b = comparisonTokens(right)
  if (!a.size || !b.size) return 0
  let shared = 0
  for (const token of a) if (b.has(token)) shared++
  return shared / Math.max(a.size, b.size)
}

function labelSimilarity(left, right) {
  const a = normalizeComparisonText(left)
  const b = normalizeComparisonText(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length)
  return tokenSimilarity(a, b)
}

function compareRecognition(expected, recognition) {
  if (!recognition?.matched) {
    return { classification: 'no-match', artistSimilarity: 0, titleSimilarity: 0 }
  }
  const artistSimilarity = labelSimilarity(expected?.artist, recognition.artist)
  const titleSimilarity = labelSimilarity(expected?.title, recognition.title)
  const exact = normalizeComparisonText(expected?.artist) === normalizeComparisonText(recognition.artist) &&
    normalizeComparisonText(expected?.title) === normalizeComparisonText(recognition.title)
  let classification = 'different'
  if (exact) classification = 'exact'
  else if (artistSimilarity >= 0.34 && titleSimilarity >= 0.5) classification = 'near'
  else if (artistSimilarity >= 0.5 || titleSimilarity >= 0.7) classification = 'related'
  return { classification, artistSimilarity, titleSimilarity }
}

function isIdentifiedTimelineTrack(track) {
  const title = normalizeComparisonText(track?.title)
  return !!(
    track &&
    Number.isFinite(Number(track.cueSeconds)) &&
    Number(track.cueSeconds) >= 0 &&
    String(track.artist || '').trim() &&
    String(track.title || '').trim() &&
    title !== 'id' &&
    !track.isId &&
    !track.isWWith &&
    !track.isMashupComponent &&
    !track.noTimestamp
  )
}

function chooseTracklistMoments(tracks, durationSeconds, { count = 5, clipSeconds = 10 } = {}) {
  const duration = Number(durationSeconds)
  if (!Number.isFinite(duration) || duration <= clipSeconds) return []
  const timeline = (Array.isArray(tracks) ? tracks : [])
    .filter(track => Number.isFinite(Number(track?.cueSeconds)) && Number(track.cueSeconds) >= 0)
    .sort((left, right) => Number(left.cueSeconds) - Number(right.cueSeconds))
  const candidates = timeline.flatMap((track, index) => {
    if (!isIdentifiedTimelineTrack(track)) return []
    const cueSeconds = Number(track.cueSeconds)
    const next = timeline.slice(index + 1).find(item => Number(item.cueSeconds) > cueSeconds)
    const nextCueSeconds = Math.min(duration, next ? Number(next.cueSeconds) : duration)
    const availableSeconds = nextCueSeconds - cueSeconds
    if (availableSeconds < clipSeconds + 12 || cueSeconds < 20 || nextCueSeconds > duration + 1) return []
    const offset = Math.min(20, Math.max(6, (availableSeconds - clipSeconds) / 2))
    const playbackTimestamp = cueSeconds + offset
    if (playbackTimestamp + clipSeconds + 3 > nextCueSeconds) return []
    return [{
      playbackTimestamp,
      cueSeconds,
      nextCueSeconds,
      expected: {
        trackNum: track.trackNum ?? null,
        artist: String(track.artist).trim(),
        title: String(track.title).trim(),
      },
    }]
  })
  if (candidates.length <= count) return candidates

  const selected = []
  for (let index = 0; index < count; index++) {
    const ratio = count === 1 ? 0.5 : index / (count - 1)
    const candidate = candidates[Math.round(ratio * (candidates.length - 1))]
    if (candidate && !selected.includes(candidate)) selected.push(candidate)
  }
  return selected
}

function fingerprintFloat32(samples, sampleRate, channelCount = 1) {
  if (!(samples instanceof Float32Array) || !samples.length) {
    throw new TypeError('A non-empty Float32Array is required for fingerprinting.')
  }
  const rate = Math.round(Number(sampleRate))
  if (!Number.isFinite(rate) || rate <= 0) throw new TypeError('A valid sample rate is required.')

  const signature = DecodedSignature.new(samples, rate, channelCount)
  try {
    return {
      uri: signature.uri,
      samplems: signature.samplems,
      numberSamples: signature.number_samples,
    }
  } finally {
    signature.free()
  }
}

function recognitionUrl({ language = 'en-US', endpointCountry = 'GB', device = 'iphone' } = {}) {
  const country = /^[A-Z]{2}$/.test(endpointCountry) ? endpointCountry : 'GB'
  const safeLanguage = /^[a-z]{2}-[A-Z]{2}$/.test(language) ? language : 'en-US'
  const safeDevice = ['iphone', 'android', 'web'].includes(device) ? device : 'iphone'
  const firstId = crypto.randomUUID().toUpperCase()
  const secondId = crypto.randomUUID().toUpperCase()
  return `${SHAZAM_ENDPOINT}/${safeLanguage}/${country}/${safeDevice}/-/tag/${firstId}/${secondId}?${SHAZAM_QUERY}`
}

function recognitionPayload(fingerprint, { timezone, timestamp = Date.now() } = {}) {
  return {
    timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'Etc/UTC',
    signature: {
      uri: fingerprint.uri,
      samplems: fingerprint.samplems,
    },
    timestamp,
    context: {},
    geolocation: {},
  }
}

function normalizeRecognitionResponse(response, details = {}) {
  const matches = Array.isArray(response?.matches) ? response.matches : []
  const track = response?.track
  const recognizedAt = details.recognizedAt || new Date().toISOString()
  if (!track || matches.length === 0) {
    return {
      matched: false,
      recognizedAt,
      matchCount: matches.length,
      samplems: details.samplems || null,
    }
  }

  const firstMatch = matches[0] || {}
  let artUrl = null
  try {
    const candidate = new URL(track.images?.coverarthq || track.images?.coverart || '')
    if (candidate.protocol === 'https:') artUrl = candidate.href
  } catch {}
  return {
    matched: true,
    recognizedAt,
    artist: String(track.subtitle || '').trim(),
    title: String(track.title || '').trim(),
    shazamTrackId: track.key ? String(track.key) : null,
    shazamUrl: track.url || null,
    genre: track.genres?.primary || null,
    artUrl,
    matchCount: matches.length,
    matchOffsetSeconds: Number.isFinite(Number(firstMatch.offset)) ? Number(firstMatch.offset) : null,
    samplems: details.samplems || null,
  }
}

async function recognizeFloat32(samples, sampleRate, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
  endpointCountry = 'GB',
  timezone,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Recognition requires fetch support.')
  const fingerprint = fingerprintFloat32(samples, sampleRate, 1)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const recognizedAt = new Date().toISOString()

  try {
    const response = await fetchImpl(recognitionUrl({ endpointCountry }), {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Accept: '*/*',
        'Accept-Language': 'en-US',
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
        'X-Shazam-AppVersion': '14.1.0',
        'X-Shazam-Platform': 'IPHONE',
      },
      body: JSON.stringify(recognitionPayload(fingerprint, { timezone })),
    })
    if (!response.ok) {
      const error = new Error(`Shazam request failed with HTTP ${response.status}.`)
      error.statusCode = response.status
      throw error
    }
    const payload = await response.json()
    return {
      fingerprint,
      response: payload,
      result: normalizeRecognitionResponse(payload, {
        recognizedAt,
        samplems: fingerprint.samplems,
      }),
    }
  } finally {
    clearTimeout(timeout)
  }
}

function recognitionKey(result) {
  if (!result?.matched) return null
  return `${result.artist || ''}\u0000${result.title || ''}`.trim().toLocaleLowerCase()
}

function appendRecognitionTimeline(timeline, entry) {
  const key = recognitionKey(entry?.recognition)
  if (!key) return { added: false, duplicateOf: null }
  const previous = timeline[timeline.length - 1]
  if (key && key === recognitionKey(previous?.recognition)) {
    return { added: false, duplicateOf: previous.playbackTimestamp }
  }
  timeline.push(entry)
  return { added: true, duplicateOf: null }
}

// Executed in the app-owned YouTube wrapper webview with userGesture=true.
// The main process grants that same WebFrameMain as the display-media source.
async function captureFrameAudio(clipMilliseconds, outputSampleRate, drivePlayback = false) {
  let stream = null
  let context = null
  let source = null
  let processor = null
  let sink = null

  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    stream.getVideoTracks().forEach(track => track.stop())
    const audioTracks = stream.getAudioTracks()
    if (!audioTracks.length) throw new Error('Electron returned a display stream without audio.')

    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    context = new AudioContextClass()
    await context.resume()
    const inputSampleRate = context.sampleRate
    const chunks = []
    let frameCount = 0
    let inputChannels = 0

    source = context.createMediaStreamSource(new MediaStream(audioTracks))
    processor = context.createScriptProcessor(4096, 2, 1)
    sink = context.createGain()
    sink.gain.value = 0
    processor.onaudioprocess = event => {
      const input = event.inputBuffer
      inputChannels = Math.max(inputChannels, input.numberOfChannels)
      const mono = new Float32Array(input.length)
      for (let channel = 0; channel < input.numberOfChannels; channel++) {
        const channelData = input.getChannelData(channel)
        for (let index = 0; index < mono.length; index++) mono[index] += channelData[index] / input.numberOfChannels
      }
      chunks.push(mono)
      frameCount += mono.length
    }
    source.connect(processor)
    processor.connect(sink)
    sink.connect(context.destination)

    if (drivePlayback && typeof window.ytPlayer?.playVideo === 'function') {
      window.ytPlayer.playVideo()
    }
    const playbackStartedAt = typeof window.ytPlayer?.getCurrentTime === 'function'
      ? window.ytPlayer.getCurrentTime()
      : null
    await new Promise(resolve => setTimeout(resolve, clipMilliseconds))
    const playbackEndedAt = typeof window.ytPlayer?.getCurrentTime === 'function'
      ? window.ytPlayer.getCurrentTime()
      : null

    if (!frameCount) throw new Error('The captured audio stream produced no PCM frames.')
    const mono = new Float32Array(frameCount)
    let writeOffset = 0
    for (const chunk of chunks) {
      mono.set(chunk, writeOffset)
      writeOffset += chunk.length
    }

    // Shazam fingerprints use mono 16 kHz input. OfflineAudioContext makes the
    // downsampling explicit and keeps the capture completely in memory.
    const outputFrames = Math.max(1, Math.round(mono.length * outputSampleRate / inputSampleRate))
    const offline = new OfflineAudioContext(1, outputFrames, outputSampleRate)
    const inputBuffer = offline.createBuffer(1, mono.length, inputSampleRate)
    inputBuffer.copyToChannel(mono, 0)
    const offlineSource = offline.createBufferSource()
    offlineSource.buffer = inputBuffer
    offlineSource.connect(offline.destination)
    offlineSource.start()
    const rendered = await offline.startRendering()
    const samples = new Float32Array(rendered.getChannelData(0))

    let peak = 0
    let energy = 0
    for (const value of samples) {
      peak = Math.max(peak, Math.abs(value))
      energy += value * value
    }
    const bytes = new Uint8Array(samples.buffer)
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    }

    return {
      samplesBase64: btoa(binary),
      sampleRate: outputSampleRate,
      inputSampleRate,
      inputChannels,
      frameCount: samples.length,
      peak,
      rms: Math.sqrt(energy / samples.length),
      playbackStartedAt,
      playbackEndedAt,
      audioTrackLabel: audioTracks[0].label || null,
      audioTrackSettings: audioTracks[0].getSettings?.() || null,
    }
  } finally {
    if (drivePlayback && typeof window.ytPlayer?.pauseVideo === 'function') {
      window.ytPlayer.pauseVideo()
    }
    if (processor) processor.onaudioprocess = null
    try { source?.disconnect() } catch {}
    try { processor?.disconnect() } catch {}
    try { sink?.disconnect() } catch {}
    stream?.getTracks().forEach(track => track.stop())
    if (context && context.state !== 'closed') await context.close().catch(() => {})
  }
}

function buildFrameAudioCaptureScript({ clipSeconds = 10, sampleRate = 16_000, drivePlayback = false } = {}) {
  const safeClipMs = Math.round(Math.max(1, Math.min(15, Number(clipSeconds) || 10)) * 1000)
  const safeRate = Math.round(Math.max(8_000, Math.min(48_000, Number(sampleRate) || 16_000)))
  return `(${captureFrameAudio.toString()})(${safeClipMs}, ${safeRate}, ${!!drivePlayback})`
}

module.exports = {
  appendRecognitionTimeline,
  buildFrameAudioCaptureScript,
  chooseSamplePoints,
  chooseTracklistMoments,
  compareRecognition,
  fingerprintFloat32,
  normalizeRecognitionResponse,
  recognitionKey,
  recognitionPayload,
  recognitionUrl,
  recognizeFloat32,
}
