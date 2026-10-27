'use strict'

const { analyzeRecognitionConfidence } = require('./recognition-timeline')

const DEFAULT_CAPTURE_SECONDS = 10
const DEFAULT_MINIMUM_CAPTURE_SECONDS = 8
const DEFAULT_SEGMENT_END_GUARD_SECONDS = 0.5
const DEFAULT_CONFIRMATION_WINDOW_SECONDS = 60
const MAX_RATE_LIMIT_BACKOFF_MS = 15 * 60_000
const INITIAL_RATE_LIMIT_BACKOFF_MS = 2 * 60_000

function recognitionRateLimitBackoffMs(statusCode, failureCount) {
  if (statusCode !== 403 && statusCode !== 429) return 0
  const failures = Math.max(1, Math.floor(Number(failureCount) || 1))
  return Math.min(
    MAX_RATE_LIMIT_BACKOFF_MS,
    INITIAL_RATE_LIMIT_BACKOFF_MS * (2 ** (failures - 1)),
  )
}

function captureDurationWithinSegment(currentSeconds, endSeconds, {
  desiredSeconds = DEFAULT_CAPTURE_SECONDS,
  minimumSeconds = DEFAULT_MINIMUM_CAPTURE_SECONDS,
  endGuardSeconds = DEFAULT_SEGMENT_END_GUARD_SECONDS,
} = {}) {
  const desired = Math.max(0, Number(desiredSeconds) || 0)
  const minimum = Math.max(0, Number(minimumSeconds) || 0)
  if (endSeconds == null || endSeconds === '' || !Number.isFinite(Number(endSeconds))) {
    return desired >= minimum ? desired : null
  }
  const available = Number(endSeconds) - Number(currentSeconds) - Math.max(0, Number(endGuardSeconds) || 0)
  if (!Number.isFinite(available) || available < minimum) return null
  return Math.min(desired, available)
}

function targetedRecognitionDecision(observations, playbackTimestamp, {
  confirmationWindowSeconds = DEFAULT_CONFIRMATION_WINDOW_SECONDS,
} = {}) {
  const confidence = analyzeRecognitionConfidence(
    Array.isArray(observations) ? observations : [],
    {
      confirmationWindowSeconds,
      finalizeAtSeconds: playbackTimestamp,
    },
  )
  const episode = confidence.episodes[confidence.episodes.length - 1] || null
  const candidate = confidence.candidate?.observations?.length >= 2
    ? confidence.candidate
    : null
  return {
    confirmed: episode
      ? {
          recognition: episode.lastRecognition,
          firstTime: episode.firstTime,
          confirmedAt: episode.confirmedAt,
        }
      : null,
    candidate: candidate
      ? {
          recognition: candidate.observations[candidate.observations.length - 1].recognition,
          count: candidate.observations.length,
          requiredCount: confidence.requiredMatches,
        }
      : null,
  }
}

function validatedRecognitionCorrection(value) {
  const artist = String(value?.artist || '').trim().slice(0, 300)
  const title = String(value?.title || '').trim().slice(0, 500)
  if (!artist || !title) throw new Error('Artist and title are required.')
  return { artist, title }
}

function manualIdentificationPatch(correction) {
  const { artist, title } = validatedRecognitionCorrection(correction)
  return {
    artist,
    title,
    raw: `${artist} - ${title}`,
    isId: false,
    isRecognitionUnidentified: false,
    isLongRecognitionGap: false,
    autoRecognized: false,
    wasAutoRecognized: false,
    manualIdentified: true,
    userConfirmed: true,
    userCorrected: true,
    recognitionSource: 'manual',
    recognition: null,
    // Persist an explicit override: omitted/undefined fields would allow a
    // cached free-form split to overwrite the user's correction on reload.
    commentAmbiguousSplits: null,
    artUrl: '',
    artworkStatus: 'missing',
  }
}

function publishedRecognitionEditPatch(action, correction = null) {
  if (action === 'wrong') {
    return {
      ...manualIdentificationPatch(correction),
      wasAutoRecognized: true,
    }
  }
  if (action === 'delete') {
    return {
      artist: '',
      title: 'ID — ID',
      raw: 'ID — ID',
      isId: true,
      isRecognitionUnidentified: false,
      isLongRecognitionGap: false,
      autoRecognized: false,
      wasAutoRecognized: false,
      manualIdentified: false,
      userConfirmed: false,
      recognitionSource: null,
      recognition: null,
      scrobbledOnConfirmation: false,
      artUrl: '',
      artworkStatus: 'missing',
    }
  }
  throw new Error('Unknown recognition action.')
}

function publishedRecognitionMatchPatch(result) {
  return {
    artist: result.artist,
    title: result.title,
    raw: `${result.artist} - ${result.title}`,
    isId: false,
    isRecognitionUnidentified: false,
    autoRecognized: true,
    wasAutoRecognized: true,
    userConfirmed: false,
    recognitionSource: 'shazam',
    recognition: {
      shazamTrackId: result.shazamTrackId || null,
      shazamUrl: result.shazamUrl || null,
      genre: result.genre || null,
      matchCount: result.matchCount ?? null,
      recognizedAt: result.recognizedAt || null,
    },
    scrobbledOnConfirmation: true,
    artUrl: result.artUrl || '',
    artworkStatus: result.artUrl ? 'ready' : 'missing',
  }
}

module.exports = {
  captureDurationWithinSegment,
  manualIdentificationPatch,
  publishedRecognitionEditPatch,
  publishedRecognitionMatchPatch,
  recognitionRateLimitBackoffMs,
  targetedRecognitionDecision,
  validatedRecognitionCorrection,
}
