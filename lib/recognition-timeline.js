'use strict'

const DEFAULT_SAMPLE_INTERVAL_SECONDS = 30
const DEFAULT_LONG_GAP_SECONDS = 90

function cleanLabel(value) {
  return String(value || '').trim()
}

function recognitionKey(result) {
  if (!result?.matched) return null
  if (result.shazamTrackId) return `shazam:${result.shazamTrackId}`
  const artist = cleanLabel(result.artist).toLocaleLowerCase()
  const title = cleanLabel(result.title).toLocaleLowerCase()
  return artist && title ? `label:${artist}\u0000${title}` : null
}

function normalizeObservation(observation) {
  const playbackTimestamp = Number(observation?.playbackTimestamp)
  if (!Number.isFinite(playbackTimestamp) || playbackTimestamp < 0) return null
  const recognition = observation?.recognition || { matched: false }
  const key = recognitionKey(recognition)
  return {
    playbackTimestamp,
    capturedAt: observation.capturedAt || recognition.recognizedAt || null,
    recognition: key ? { ...recognition, matched: true } : { ...recognition, matched: false },
    key,
  }
}

function upsertRecognitionObservation(observations, observation, { replaceWithinSeconds = 4 } = {}) {
  const normalized = normalizeObservation(observation)
  if (!normalized) return false
  const existingIndex = observations.findIndex(item => (
    Math.abs(Number(item?.playbackTimestamp) - normalized.playbackTimestamp) <= replaceWithinSeconds
  ))
  if (existingIndex >= 0) observations.splice(existingIndex, 1, normalized)
  else observations.push(normalized)
  observations.sort((left, right) => left.playbackTimestamp - right.playbackTimestamp)
  return true
}

function formatCue(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`
}

function buildRecognitionTimeline(observations, {
  sampleIntervalSeconds = DEFAULT_SAMPLE_INTERVAL_SECONDS,
  longGapSeconds = DEFAULT_LONG_GAP_SECONDS,
  sessionStartSeconds = null,
} = {}) {
  const normalized = (Array.isArray(observations) ? observations : [])
    .map(normalizeObservation)
    .filter(Boolean)
    .sort((left, right) => left.playbackTimestamp - right.playbackTimestamp)
  if (!normalized.length) return []

  const halfInterval = Math.max(1, Number(sampleIntervalSeconds) || DEFAULT_SAMPLE_INTERVAL_SECONDS) / 2
  const firstObservedStart = Math.max(0, normalized[0].playbackTimestamp - halfInterval)
  const sessionStart = Number.isFinite(Number(sessionStartSeconds))
    ? Math.max(0, Number(sessionStartSeconds))
    : firstObservedStart

  const groups = []
  for (const observation of normalized) {
    if (!observation.key) continue
    const previous = groups[groups.length - 1]
    if (previous?.key === observation.key) {
      previous.lastTime = observation.playbackTimestamp
      previous.lastRecognition = observation.recognition
      continue
    }
    groups.push({
      key: observation.key,
      firstTime: observation.playbackTimestamp,
      lastTime: observation.playbackTimestamp,
      firstRecognition: observation.recognition,
      lastRecognition: observation.recognition,
    })
  }

  const segments = []
  const addGap = (start, end, finalized) => {
    const cueSeconds = Math.max(0, start)
    const estimatedEndSeconds = Math.max(cueSeconds, end)
    if (estimatedEndSeconds - cueSeconds < 1) return
    const durationSeconds = estimatedEndSeconds - cueSeconds
    const isLongRecognitionGap = !!finalized && durationSeconds >= longGapSeconds
    segments.push({
      type: 'gap',
      cueSeconds,
      estimatedEndSeconds,
      finalized: !!finalized,
      isLongRecognitionGap,
    })
  }

  if (!groups.length) {
    addGap(sessionStart, normalized[normalized.length - 1].playbackTimestamp + halfInterval, false)
  } else {
    const firstGroup = groups[0]
    const leadingMisses = normalized.some(item => !item.key && item.playbackTimestamp < firstGroup.firstTime)
    const firstStart = Math.max(sessionStart, firstGroup.firstTime - halfInterval)
    if (leadingMisses) addGap(sessionStart, firstStart, true)

    groups.forEach((group, index) => {
      let start = index === 0 ? firstStart : group.firstTime - halfInterval
      let end = group.lastTime + halfInterval
      const previous = groups[index - 1]
      const next = groups[index + 1]

      if (previous) {
        const misses = normalized.some(item => (
          !item.key && item.playbackTimestamp > previous.lastTime && item.playbackTimestamp < group.firstTime
        ))
        if (!misses) start = (previous.lastTime + group.firstTime) / 2
      }

      if (next) {
        const misses = normalized.some(item => (
          !item.key && item.playbackTimestamp > group.lastTime && item.playbackTimestamp < next.firstTime
        ))
        if (!misses) end = (group.lastTime + next.firstTime) / 2
      }

      segments.push({
        type: 'track',
        key: group.key,
        cueSeconds: Math.max(0, start),
        estimatedEndSeconds: Math.max(start, end),
        observedStartSeconds: group.firstTime,
        observedEndSeconds: group.lastTime,
        recognition: group.lastRecognition,
      })

      if (!next) return
      const misses = normalized.some(item => (
        !item.key && item.playbackTimestamp > group.lastTime && item.playbackTimestamp < next.firstTime
      ))
      if (misses) addGap(group.lastTime + halfInterval, next.firstTime - halfInterval, true)
    })

    const lastGroup = groups[groups.length - 1]
    const lastObservation = normalized[normalized.length - 1]
    if (!lastObservation.key && lastObservation.playbackTimestamp > lastGroup.lastTime) {
      addGap(lastGroup.lastTime + halfInterval, lastObservation.playbackTimestamp + halfInterval, false)
    }
  }

  return segments
    .sort((left, right) => left.cueSeconds - right.cueSeconds)
    .map((segment, index) => {
      const trackNum = index + 1
      if (segment.type === 'gap') {
        const title = segment.isLongRecognitionGap ? 'Unidentified gap' : 'ID — ID'
        return {
          ...segment,
          trackNum,
          providerId: 'shazam',
          providerTrackId: `shazam-gap:${Math.round(segment.cueSeconds)}`,
          artist: '',
          title,
          raw: title,
          cueDisplay: formatCue(segment.cueSeconds),
          hasTimestamp: true,
          noTimestamp: false,
          isId: true,
          isRecognitionUnidentified: true,
          autoRecognized: false,
          artworkStatus: 'missing',
        }
      }

      const recognition = segment.recognition
      return {
        ...segment,
        trackNum,
        providerId: 'shazam',
        providerTrackId: `${segment.key}:${Math.round(segment.observedStartSeconds)}`,
        artist: cleanLabel(recognition.artist),
        title: cleanLabel(recognition.title),
        raw: [cleanLabel(recognition.artist), cleanLabel(recognition.title)].filter(Boolean).join(' - '),
        cueDisplay: formatCue(segment.cueSeconds),
        hasTimestamp: true,
        noTimestamp: false,
        isId: false,
        isRecognitionUnidentified: false,
        isLongRecognitionGap: false,
        autoRecognized: true,
        recognitionSource: 'shazam',
        recognition: {
          shazamTrackId: recognition.shazamTrackId || null,
          shazamUrl: recognition.shazamUrl || null,
          genre: recognition.genre || null,
          matchCount: recognition.matchCount ?? null,
          recognizedAt: recognition.recognizedAt || null,
        },
        artworkStatus: 'missing',
      }
    })
}

function segmentAtTime(timeline, seconds) {
  const time = Number(seconds)
  if (!Number.isFinite(time)) return null
  return (Array.isArray(timeline) ? timeline : []).find(track => (
    Number(track.cueSeconds) <= time &&
    (!Number.isFinite(Number(track.estimatedEndSeconds)) || Number(track.estimatedEndSeconds) > time)
  )) || null
}

module.exports = {
  DEFAULT_LONG_GAP_SECONDS,
  DEFAULT_SAMPLE_INTERVAL_SECONDS,
  buildRecognitionTimeline,
  formatCue,
  recognitionKey,
  segmentAtTime,
  upsertRecognitionObservation,
}
