'use strict'

const DEFAULT_SAMPLE_INTERVAL_SECONDS = 13
const DEFAULT_MINIMUM_GAP_SECONDS = 1
const DEFAULT_LONG_GAP_SECONDS = 90
const DEFAULT_CONFIRMATION_MATCHES = 3
const DEFAULT_CONFIRMATION_WINDOW_SECONDS = 60

function cleanLabel(value) {
  return String(value || '').trim()
}

function recognitionKey(result) {
  if (!result?.matched) return null
  if (result.manualKey) return `manual:${result.manualKey}`
  if (result.shazamTrackId) return `shazam:${result.shazamTrackId}`
  const artist = cleanLabel(result.artist).toLocaleLowerCase()
  const title = cleanLabel(result.title).toLocaleLowerCase()
  return artist && title ? `label:${artist}\u0000${title}` : null
}

function randomSampleIntervalSeconds(random = Math.random, { minSeconds = 10, maxSeconds = 15 } = {}) {
  const min = Math.max(1, Math.floor(Number(minSeconds) || 10))
  const max = Math.max(min, Math.floor(Number(maxSeconds) || 15))
  const value = Math.max(0, Math.min(0.999999, Number(random()) || 0))
  return min + Math.floor(value * (max - min + 1))
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

function applyRecognitionDecision(observations, track, action, correction = null) {
  const start = Number(track?.observedStartSeconds)
  const end = Number(track?.observedEndSeconds)
  const key = track?.key || recognitionKey({
    matched: true,
    shazamTrackId: track?.recognition?.shazamTrackId,
    artist: track?.artist,
    title: track?.title,
  })
  if (!key || !Number.isFinite(start) || !Number.isFinite(end)) return 0

  const artist = cleanLabel(correction?.artist)
  const title = cleanLabel(correction?.title)
  if (action === 'wrong' && (!artist || !title)) return 0
  const manualKey = action === 'wrong'
    ? `${artist.toLocaleLowerCase()}\u0000${title.toLocaleLowerCase()}`
    : null
  let changed = 0
  for (const observation of observations) {
    const time = Number(observation?.playbackTimestamp)
    if (time < start || time > end || recognitionKey(observation?.recognition) !== key) continue
    if (action === 'confirm') {
      observation.recognition = { ...observation.recognition, userConfirmed: true }
    } else if (action === 'wrong') {
      observation.recognition = {
        ...observation.recognition,
        matched: true,
        artist,
        title,
        shazamTrackId: null,
        shazamUrl: null,
        artUrl: null,
        genre: null,
        manualKey,
        correctedFromKey: key,
        userConfirmed: true,
        userCorrected: true,
      }
    } else if (action === 'delete') {
      observation.recognition = {
        matched: false,
        userDeleted: true,
        deletedRecognition: observation.recognition,
        recognizedAt: observation.recognition?.recognizedAt || observation.capturedAt || null,
      }
    } else {
      return 0
    }
    observation.key = recognitionKey(observation.recognition)
    changed++
  }
  return changed
}

function carryForwardRecognitionDecision(observations, playbackTimestamp, recognition, {
  maxDistanceSeconds = 30,
  preserveDeleted = true,
} = {}) {
  const sourceKey = recognitionKey(recognition)
  const time = Number(playbackTimestamp)
  if (!sourceKey || !Number.isFinite(time)) return recognition
  const nearby = [...(Array.isArray(observations) ? observations : [])]
    .filter(item => Math.abs(Number(item?.playbackTimestamp) - time) <= maxDistanceSeconds)
    .sort((left, right) => (
      Math.abs(Number(left.playbackTimestamp) - time) - Math.abs(Number(right.playbackTimestamp) - time)
    ))
  for (const observation of nearby) {
    const decision = observation?.recognition
    if (decision?.userCorrected && decision.correctedFromKey === sourceKey) {
      return {
        ...recognition,
        artist: decision.artist,
        title: decision.title,
        shazamTrackId: null,
        shazamUrl: null,
        artUrl: null,
        genre: null,
        manualKey: decision.manualKey,
        correctedFromKey: sourceKey,
        userConfirmed: true,
        userCorrected: true,
      }
    }
    if (
      preserveDeleted &&
      decision?.userDeleted &&
      recognitionKey(decision.deletedRecognition) === sourceKey
    ) {
      return {
        matched: false,
        userDeleted: true,
        deletedRecognition: recognition,
        recognizedAt: recognition.recognizedAt || null,
      }
    }
  }
  return recognition
}

function analyzeRecognitionConfidence(normalized, {
  confirmationMatches = DEFAULT_CONFIRMATION_MATCHES,
  confirmationWindowSeconds = DEFAULT_CONFIRMATION_WINDOW_SECONDS,
  finalizeAtSeconds = null,
} = {}) {
  const requiredMatches = Math.max(1, Math.floor(Number(confirmationMatches) || DEFAULT_CONFIRMATION_MATCHES))
  const windowSeconds = Math.max(1, Number(confirmationWindowSeconds) || DEFAULT_CONFIRMATION_WINDOW_SECONDS)
  const episodes = []
  const candidates = new Map()
  let current = null

  const commitCandidate = (candidate, confirmedAt) => {
    const first = candidate.observations[0]
    const last = candidate.observations[candidate.observations.length - 1]
    current = {
      key: candidate.key,
      firstTime: first.playbackTimestamp,
      confirmedAt,
      lastTime: last.playbackTimestamp,
      firstRecognition: first.recognition,
      lastRecognition: last.recognition,
      userConfirmed: candidate.observations.some(item => !!item.recognition.userConfirmed),
    }
    episodes.push(current)
    candidates.clear()
  }

  // Three observations are immediate evidence. Two matching observations are
  // retained for one full window: if nothing contradicts them, they graduate
  // when that window closes rather than living as a muted row forever.
  const promoteMatureCandidate = (time) => {
    const mature = [...candidates.values()]
      .filter(candidate => (
        candidate.observations.length >= 2 &&
        time - candidate.observations[0].playbackTimestamp >= windowSeconds
      ))
      .sort((left, right) => (
        (left.observations[0].playbackTimestamp + windowSeconds) -
        (right.observations[0].playbackTimestamp + windowSeconds)
      ))[0]
    if (!mature) return false
    commitCandidate(mature, mature.observations[0].playbackTimestamp + windowSeconds)
    return true
  }

  const discardExpiredSingleCandidates = (time) => {
    for (const [key, candidate] of candidates) {
      const latest = candidate.observations[candidate.observations.length - 1]
      if (candidate.observations.length < 2 && time - latest.playbackTimestamp > windowSeconds) {
        candidates.delete(key)
      }
    }
  }

  for (const observation of normalized) {
    if (
      observation.key &&
      current?.key === observation.key &&
      observation.playbackTimestamp - current.lastTime <= windowSeconds
    ) {
      current.lastTime = observation.playbackTimestamp
      current.lastRecognition = observation.recognition
      current.userConfirmed = current.userConfirmed || !!observation.recognition.userConfirmed
      candidates.clear()
      continue
    }

    if (!observation.key) {
      if (observation.recognition?.userDeleted) {
        current = null
        candidates.clear()
      } else {
        promoteMatureCandidate(observation.playbackTimestamp)
        discardExpiredSingleCandidates(observation.playbackTimestamp)
      }
      continue
    }

    promoteMatureCandidate(observation.playbackTimestamp)
    if (
      current?.key === observation.key &&
      observation.playbackTimestamp - current.lastTime <= windowSeconds
    ) {
      current.lastTime = observation.playbackTimestamp
      current.lastRecognition = observation.recognition
      current.userConfirmed = current.userConfirmed || !!observation.recognition.userConfirmed
      candidates.clear()
      continue
    }
    discardExpiredSingleCandidates(observation.playbackTimestamp)

    const candidate = candidates.get(observation.key) || { key: observation.key, observations: [] }
    if (candidate.observations.length < 2) {
      candidate.observations = candidate.observations.filter(item => (
        observation.playbackTimestamp - item.playbackTimestamp <= windowSeconds
      ))
    }
    candidate.observations.push(observation)
    candidates.set(observation.key, candidate)
    const threshold = observation.recognition.userConfirmed ? 1 : requiredMatches
    if (candidate.observations.length < threshold) continue

    commitCandidate(candidate, observation.playbackTimestamp)
  }

  const lastTime = normalized[normalized.length - 1]?.playbackTimestamp ?? 0
  const finalizationTime = Number.isFinite(Number(finalizeAtSeconds))
    ? Math.max(lastTime, Number(finalizeAtSeconds))
    : lastTime
  promoteMatureCandidate(finalizationTime)
  discardExpiredSingleCandidates(finalizationTime)
  const candidate = [...candidates.values()]
    .filter(item => item.observations.length > 0)
    .sort((left, right) => (
      right.observations[right.observations.length - 1].playbackTimestamp -
      left.observations[left.observations.length - 1].playbackTimestamp
    ))[0] || null

  return { episodes, candidate, requiredMatches }
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
  minimumGapSeconds = DEFAULT_MINIMUM_GAP_SECONDS,
  longGapSeconds = DEFAULT_LONG_GAP_SECONDS,
  confirmationMatches = DEFAULT_CONFIRMATION_MATCHES,
  confirmationWindowSeconds = DEFAULT_CONFIRMATION_WINDOW_SECONDS,
  sessionStartSeconds = null,
  setEndSeconds = null,
} = {}) {
  const normalized = (Array.isArray(observations) ? observations : [])
    .map(normalizeObservation)
    .filter(Boolean)
    .sort((left, right) => left.playbackTimestamp - right.playbackTimestamp)
  if (!normalized.length) return []

  const halfInterval = Math.max(1, Number(sampleIntervalSeconds) || DEFAULT_SAMPLE_INTERVAL_SECONDS) / 2
  const firstObservedStart = Math.max(0, normalized[0].playbackTimestamp - halfInterval)
  const sessionStart = typeof sessionStartSeconds === 'number' && Number.isFinite(sessionStartSeconds)
    ? Math.max(0, Number(sessionStartSeconds))
    : firstObservedStart
  const hasSetEnd = typeof setEndSeconds === 'number' && Number.isFinite(setEndSeconds)

  const { episodes, candidate, requiredMatches } = analyzeRecognitionConfidence(normalized, {
    confirmationMatches,
    confirmationWindowSeconds,
    finalizeAtSeconds: hasSetEnd ? setEndSeconds : null,
  })

  const segments = []
  const addGap = (start, end) => {
    const cueSeconds = Math.max(0, start)
    const estimatedEndSeconds = Math.max(cueSeconds, end)
    if (estimatedEndSeconds - cueSeconds < minimumGapSeconds) return false
    const durationSeconds = estimatedEndSeconds - cueSeconds
    const userDeleted = normalized.some(item => (
      item.recognition?.userDeleted &&
      item.playbackTimestamp >= cueSeconds &&
      item.playbackTimestamp <= estimatedEndSeconds
    ))
    const isLongRecognitionGap = !userDeleted && durationSeconds >= longGapSeconds
    segments.push({
      type: 'gap',
      cueSeconds,
      estimatedEndSeconds,
      finalized: true,
      isLongRecognitionGap,
      userDeleted,
    })
    return true
  }

  if (!episodes.length) {
    if (hasSetEnd) addGap(sessionStart, setEndSeconds)
  } else {
    episodes.forEach((episode, index) => {
      const previous = episodes[index - 1]
      const next = episodes[index + 1]
      let start = index === 0 ? sessionStart : (previous.lastTime + episode.firstTime) / 2
      let end = next ? (episode.lastTime + next.firstTime) / 2 : null

      if (index === 0) {
        const leadingEnd = Math.max(sessionStart, episode.firstTime - halfInterval)
        const hasLeadingUncertainty = normalized.some(item => (
          item.playbackTimestamp < episode.firstTime && item.key !== episode.key
        ))
        if (hasLeadingUncertainty && addGap(sessionStart, leadingEnd)) start = leadingEnd
      } else {
        const gapStart = previous.lastTime + halfInterval
        const gapEnd = episode.firstTime - halfInterval
        if (addGap(gapStart, gapEnd)) start = gapEnd
      }

      if (next) {
        const gapStart = episode.lastTime + halfInterval
        const gapEnd = next.firstTime - halfInterval
        if (gapEnd - gapStart >= minimumGapSeconds) end = gapStart
      } else if (hasSetEnd) {
        const finalEnd = Math.max(episode.lastTime, setEndSeconds)
        const gapStart = episode.lastTime + halfInterval
        if (addGap(gapStart, finalEnd)) end = gapStart
        else end = finalEnd
      }

      segments.push({
        type: 'track',
        key: episode.key,
        cueSeconds: Math.max(0, start),
        estimatedEndSeconds: Number.isFinite(Number(end)) ? Math.max(start, end) : null,
        observedStartSeconds: episode.firstTime,
        observedEndSeconds: episode.lastTime,
        confirmationTimestamp: episode.confirmedAt,
        recognition: episode.lastRecognition,
        userConfirmed: episode.userConfirmed,
      })
    })
  }

  let trackNum = 0
  const timeline = segments
    .sort((left, right) => left.cueSeconds - right.cueSeconds)
    .map(segment => {
      trackNum++
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
        trackNumText: String(trackNum),
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
        autoRecognized: !segment.userConfirmed,
        wasAutoRecognized: true,
        userConfirmed: !!segment.userConfirmed,
        manualIdentified: !!recognition.manualKey || !!recognition.userCorrected,
        recognitionSource: 'shazam',
        recognition: {
          shazamTrackId: recognition.shazamTrackId || null,
          shazamUrl: recognition.shazamUrl || null,
          genre: recognition.genre || null,
          matchCount: recognition.matchCount ?? null,
          recognizedAt: recognition.recognizedAt || null,
        },
        artUrl: recognition.artUrl || '',
        artworkStatus: recognition.artUrl ? 'ready' : 'missing',
      }
    })

  if (candidate && !hasSetEnd) {
    const latest = candidate.observations[candidate.observations.length - 1]
    const recognition = latest.recognition
    timeline.push({
      type: 'candidate',
      key: candidate.key,
      trackNum: null,
      providerId: 'shazam',
      providerTrackId: `shazam-candidate:${candidate.key}`,
      artist: cleanLabel(recognition.artist),
      title: cleanLabel(recognition.title),
      raw: [cleanLabel(recognition.artist), cleanLabel(recognition.title)].filter(Boolean).join(' - '),
      cueSeconds: candidate.observations[0].playbackTimestamp,
      cueDisplay: null,
      estimatedEndSeconds: null,
      observedStartSeconds: candidate.observations[0].playbackTimestamp,
      observedEndSeconds: latest.playbackTimestamp,
      isId: false,
      isRecognitionCandidate: true,
      recognitionCandidateCount: candidate.observations.length,
      recognitionRequiredCount: requiredMatches,
      autoRecognized: false,
      recognitionSource: 'shazam',
      artUrl: recognition.artUrl || '',
      artworkStatus: recognition.artUrl ? 'ready' : 'missing',
    })
  }
  return timeline
}

function segmentAtTime(timeline, seconds) {
  const time = Number(seconds)
  if (!Number.isFinite(time)) return null
  return (Array.isArray(timeline) ? timeline : []).find(track => (
    !track.isRecognitionCandidate &&
    Number(track.cueSeconds) <= time &&
    (typeof track.estimatedEndSeconds !== 'number' || !Number.isFinite(track.estimatedEndSeconds) || track.estimatedEndSeconds > time)
  )) || null
}

module.exports = {
  DEFAULT_CONFIRMATION_MATCHES,
  DEFAULT_CONFIRMATION_WINDOW_SECONDS,
  DEFAULT_LONG_GAP_SECONDS,
  DEFAULT_MINIMUM_GAP_SECONDS,
  DEFAULT_SAMPLE_INTERVAL_SECONDS,
  analyzeRecognitionConfidence,
  buildRecognitionTimeline,
  applyRecognitionDecision,
  formatCue,
  carryForwardRecognitionDecision,
  randomSampleIntervalSeconds,
  recognitionKey,
  segmentAtTime,
  upsertRecognitionObservation,
}
