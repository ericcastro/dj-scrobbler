'use strict'

const DEFAULT_SAMPLE_INTERVAL_SECONDS = 13
const DEFAULT_LONG_GAP_SECONDS = 90

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

function randomSampleIntervalSeconds(random = Math.random, { minSeconds = 11, maxSeconds = 15 } = {}) {
  const min = Math.max(1, Math.floor(Number(minSeconds) || 11))
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

function inferAutomaticMashups(segments, maxCandidates = 2, maxReturnGapSeconds = 60) {
  const removed = new Set()
  for (let parentIndex = 0; parentIndex < segments.length; parentIndex++) {
    const parent = segments[parentIndex]
    if (parent.type !== 'track' || removed.has(parentIndex) || parent.isAutoMashupCandidate) continue
    let anchorIndex = parentIndex

    while (true) {
      const candidateIndexes = []
      let repeatedIndex = -1
      for (let index = anchorIndex + 1; index < segments.length; index++) {
        const segment = segments[index]
        if (removed.has(index) || segment.type !== 'track') continue
        if (segment.key === parent.key) {
          repeatedIndex = candidateIndexes.length >= 1 && candidateIndexes.length <= maxCandidates ? index : -1
          break
        }
        candidateIndexes.push(index)
        if (candidateIndexes.length > maxCandidates) break
      }
      if (repeatedIndex < 0) break

      const repeated = segments[repeatedIndex]
      if (repeated.observedStartSeconds - parent.observedEndSeconds > maxReturnGapSeconds) break
      parent.estimatedEndSeconds = Math.max(parent.estimatedEndSeconds, repeated.estimatedEndSeconds)
      parent.observedEndSeconds = Math.max(parent.observedEndSeconds, repeated.observedEndSeconds)
      parent.isAutoMashupParent = true
      for (const index of candidateIndexes) {
        segments[index].isWWith = true
        segments[index].isAutoMashupCandidate = true
        segments[index].mashupParentKey = parent.key
      }
      for (let index = anchorIndex + 1; index < repeatedIndex; index++) {
        if (segments[index].type === 'gap') removed.add(index)
      }
      removed.add(repeatedIndex)
      anchorIndex = repeatedIndex
    }
  }
  return segments.filter((_segment, index) => !removed.has(index))
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
  let hardBreakSinceLastMatch = false
  for (const observation of normalized) {
    if (!observation.key) {
      if (observation.recognition?.userDeleted) hardBreakSinceLastMatch = true
      continue
    }
    const previous = groups[groups.length - 1]
    if (previous?.key === observation.key && !hardBreakSinceLastMatch) {
      previous.lastTime = observation.playbackTimestamp
      previous.lastRecognition = observation.recognition
      previous.userConfirmed = previous.userConfirmed || !!observation.recognition.userConfirmed
      continue
    }
    groups.push({
      key: observation.key,
      firstTime: observation.playbackTimestamp,
      lastTime: observation.playbackTimestamp,
      firstRecognition: observation.recognition,
      lastRecognition: observation.recognition,
      userConfirmed: !!observation.recognition.userConfirmed,
    })
    hardBreakSinceLastMatch = false
  }

  const segments = []
  const addGap = (start, end, finalized) => {
    const cueSeconds = Math.max(0, start)
    const estimatedEndSeconds = Math.max(cueSeconds, end)
    if (estimatedEndSeconds - cueSeconds < 1) return
    const durationSeconds = estimatedEndSeconds - cueSeconds
    const userDeleted = normalized.some(item => (
      item.recognition?.userDeleted &&
      item.playbackTimestamp >= cueSeconds &&
      item.playbackTimestamp <= estimatedEndSeconds
    ))
    const isLongRecognitionGap = !!finalized && !userDeleted && durationSeconds >= longGapSeconds
    segments.push({
      type: 'gap',
      cueSeconds,
      estimatedEndSeconds,
      finalized: !!finalized,
      isLongRecognitionGap,
      userDeleted,
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
        userConfirmed: group.userConfirmed,
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

  let trackNum = 0
  return inferAutomaticMashups(segments)
    .sort((left, right) => left.cueSeconds - right.cueSeconds)
    .map(segment => {
      if (!segment.isWWith) trackNum++
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
        trackNum: segment.isWWith ? null : trackNum,
        trackNumText: segment.isWWith ? 'w/' : String(trackNum),
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
  applyRecognitionDecision,
  formatCue,
  carryForwardRecognitionDecision,
  inferAutomaticMashups,
  randomSampleIntervalSeconds,
  recognitionKey,
  segmentAtTime,
  upsertRecognitionObservation,
}
