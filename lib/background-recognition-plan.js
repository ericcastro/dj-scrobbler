const DEFAULT_SPACING_SECONDS = 20
const DEFAULT_RETRY_AFTER_MS = 24 * 60 * 60 * 1000

function freshObservationNear(observations, seconds, options = {}) {
  const toleranceSeconds = Math.max(0, Number(options.toleranceSeconds) || 4)
  const retryAfterMs = Math.max(0, Number(options.retryAfterMs) || DEFAULT_RETRY_AFTER_MS)
  const now = Number(options.now) || Date.now()
  return observations.some(observation => {
    if (Math.abs(Number(observation?.playbackTimestamp) - seconds) > toleranceSeconds) return false
    const capturedAt = Date.parse(observation?.capturedAt || observation?.recognition?.recognizedAt || '')
    return Number.isFinite(capturedAt) && now - capturedAt < retryAfterMs
  })
}

function buildBackgroundRecognitionQueue(durationSeconds, observations = [], options = {}) {
  const duration = Math.max(0, Number(durationSeconds) || 0)
  const clipSeconds = Math.max(1, Number(options.clipSeconds) || 10)
  const spacingSeconds = Math.max(clipSeconds, Number(options.spacingSeconds) || DEFAULT_SPACING_SECONDS)
  const startSeconds = Math.max(0, Number(options.startSeconds) || 5)
  const queue = []
  for (let seconds = startSeconds; seconds + clipSeconds <= duration; seconds += spacingSeconds) {
    if (!freshObservationNear(observations, seconds + clipSeconds / 2, options)) {
      queue.push({ seconds, attempts: 0, reason: 'timeline' })
    }
  }
  return queue
}

function targetedSamplePoints(startSeconds, endSeconds, options = {}) {
  const start = Math.max(0, Number(startSeconds) || 0)
  const end = endSeconds !== null && endSeconds !== undefined && Number.isFinite(Number(endSeconds))
    ? Number(endSeconds)
    : start + 60
  const clipSeconds = Math.max(1, Number(options.clipSeconds) || 10)
  const spacingSeconds = Math.max(clipSeconds, Number(options.spacingSeconds) || DEFAULT_SPACING_SECONDS)
  const points = []
  for (let seconds = start + 2; seconds + clipSeconds <= end && points.length < 3; seconds += spacingSeconds) {
    points.push(seconds)
  }
  if (!points.length && end - start >= clipSeconds) points.push(start)
  return points
}

module.exports = { buildBackgroundRecognitionQueue, freshObservationNear, targetedSamplePoints }
