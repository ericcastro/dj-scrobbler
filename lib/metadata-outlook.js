const DAY_MS = 24 * 60 * 60 * 1000

// Ten thousand plays is a meaningful signal for a recent underground DJ set,
// without pretending that mainstream-video numbers are the right benchmark.
const RECENT_DAYS = 180
const POPULAR_VIEW_THRESHOLD = 10_000
const OLD_DAYS = 365
const LOW_VIEW_THRESHOLD = 10_000

function finiteNonNegativeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

function classifyMetadataOutlook({ publishedAt, viewCount, now = new Date() } = {}) {
  const publishedTime = Date.parse(publishedAt)
  const nowTime = now instanceof Date ? now.getTime() : Date.parse(now)
  const views = finiteNonNegativeNumber(viewCount)
  const ageDays = Number.isFinite(publishedTime) && Number.isFinite(nowTime)
    ? Math.max(0, Math.floor((nowTime - publishedTime) / DAY_MS))
    : null

  let kind = 'unknown'
  if (ageDays != null && views != null) {
    if (ageDays <= RECENT_DAYS && views >= POPULAR_VIEW_THRESHOLD) kind = 'likely'
    else if (ageDays >= OLD_DAYS && views < LOW_VIEW_THRESHOLD) kind = 'unlikely'
  }

  return {
    kind,
    ageDays,
    viewCount: views,
    publishedAt: Number.isFinite(publishedTime) ? new Date(publishedTime).toISOString().slice(0, 10) : null,
  }
}

module.exports = {
  LOW_VIEW_THRESHOLD,
  OLD_DAYS,
  POPULAR_VIEW_THRESHOLD,
  RECENT_DAYS,
  classifyMetadataOutlook,
}
