const crypto = require('node:crypto')

const SCHEMA_VERSION = 2
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function emptyStats() {
  return {
    schemaVersion: SCHEMA_VERSION,
    legacy: {
      listenedMs: 0,
      tracksListened: 0,
      listenDays: [],
      firstListenDate: null,
    },
    days: {},
    sets: {},
    djs: {},
  }
}

function nonNegativeInteger(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0
}

function validDay(value) {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? value
    : null
}

function cleanText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizedDjName(value) {
  const name = cleanText(value)
  return name ? name.normalize('NFKC').replace(/\s+/g, ' ') : null
}

function djIdForName(value) {
  const name = normalizedDjName(value)
  return name ? name.toLowerCase() : null
}

function youtubeVideoId(sourceUrl) {
  try {
    const url = new URL(sourceUrl)
    if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null
    if (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com')) {
      return url.searchParams.get('v') || null
    }
  } catch {}
  return null
}

function setIdFor({ sourceId, sourceUrl }) {
  const source = cleanText(sourceId) || 'unknown'
  const url = cleanText(sourceUrl) || ''
  const videoId = source === 'youtube' ? youtubeVideoId(url) : null
  if (videoId) return `youtube:${videoId}`
  return `${source}:${crypto.createHash('sha1').update(url).digest('hex')}`
}

function localDayKey(timestampMs) {
  const date = new Date(timestampMs)
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function nextLocalMidnight(timestampMs) {
  const date = new Date(timestampMs)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
}

function migrateStats(value) {
  const raw = value && typeof value === 'object' ? value : {}
  if (raw.schemaVersion !== SCHEMA_VERSION) {
    const stats = emptyStats()
    const listenDays = Array.isArray(raw.listenDays)
      ? [...new Set(raw.listenDays.map(validDay).filter(Boolean))].sort()
      : []
    stats.legacy = {
      listenedMs: nonNegativeInteger(Number(raw.totalListenedSeconds) * 1000),
      tracksListened: nonNegativeInteger(raw.totalTracksListened),
      listenDays,
      firstListenDate: validDay(raw.firstListenDate) || listenDays[0] || null,
    }
    return stats
  }

  const stats = emptyStats()
  const legacyDays = Array.isArray(raw.legacy?.listenDays)
    ? [...new Set(raw.legacy.listenDays.map(validDay).filter(Boolean))].sort()
    : []
  stats.legacy = {
    listenedMs: nonNegativeInteger(raw.legacy?.listenedMs),
    tracksListened: nonNegativeInteger(raw.legacy?.tracksListened),
    listenDays: legacyDays,
    firstListenDate: validDay(raw.legacy?.firstListenDate) || legacyDays[0] || null,
  }

  for (const [id, dj] of Object.entries(raw.djs || {})) {
    const name = normalizedDjName(dj?.name)
    if (id && name) stats.djs[id] = { name }
  }

  for (const [id, set] of Object.entries(raw.sets || {})) {
    const sourceUrl = cleanText(set?.sourceUrl)
    if (!id || !sourceUrl) continue
    const djIds = Array.isArray(set.djIds)
      ? [...new Set(set.djIds.filter(djId => typeof djId === 'string' && stats.djs[djId]))]
      : []
    stats.sets[id] = {
      sourceId: cleanText(set.sourceId) || 'unknown',
      sourceUrl,
      title: cleanText(set.title) || sourceUrl,
      djIds,
    }
  }

  for (const [day, bucket] of Object.entries(raw.days || {})) {
    if (!validDay(day) || !bucket || typeof bucket !== 'object') continue
    const sets = {}
    for (const [setId, entry] of Object.entries(bucket.sets || {})) {
      if (!stats.sets[setId]) continue
      const listenedMs = nonNegativeInteger(entry?.listenedMs)
      const tracksListened = nonNegativeInteger(entry?.tracksListened)
      if (listenedMs || tracksListened) sets[setId] = { listenedMs, tracksListened }
    }
    if (Object.keys(sets).length) stats.days[day] = { sets }
  }

  return stats
}

function upsertSet(stats, descriptor) {
  const sourceUrl = cleanText(descriptor?.sourceUrl)
  if (!sourceUrl) return null
  const sourceId = cleanText(descriptor?.sourceId) || 'unknown'
  const setId = setIdFor({ sourceId, sourceUrl })
  const existing = stats.sets[setId]
  const title = cleanText(descriptor?.title) || existing?.title || sourceUrl

  const names = Array.isArray(descriptor?.djNames)
    ? descriptor.djNames.map(normalizedDjName).filter(Boolean)
    : []
  const djIds = []
  for (const name of names) {
    const djId = djIdForName(name)
    if (!djId || djIds.includes(djId)) continue
    djIds.push(djId)
    if (!stats.djs[djId]) stats.djs[djId] = { name }
  }

  stats.sets[setId] = {
    sourceId,
    sourceUrl,
    title,
    djIds: djIds.length ? djIds : (existing?.djIds || []),
  }
  return setId
}

function ensureDaySet(stats, day, setId) {
  if (!stats.days[day]) stats.days[day] = { sets: {} }
  if (!stats.days[day].sets[setId]) {
    stats.days[day].sets[setId] = { listenedMs: 0, tracksListened: 0 }
  }
  return stats.days[day].sets[setId]
}

function recordListening(stats, descriptor, startedAtMs, endedAtMs) {
  const start = Math.round(Number(startedAtMs))
  const end = Math.round(Number(endedAtMs))
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0
  const setId = upsertSet(stats, descriptor)
  if (!setId) return 0

  let cursor = start
  while (cursor < end) {
    const boundary = nextLocalMidnight(cursor)
    const chunkEnd = Math.min(end, boundary)
    ensureDaySet(stats, localDayKey(cursor), setId).listenedMs += chunkEnd - cursor
    cursor = chunkEnd
  }
  return end - start
}

function recordTrack(stats, descriptor, timestampMs = Date.now()) {
  const setId = upsertSet(stats, descriptor)
  if (!setId) return false
  ensureDaySet(stats, localDayKey(timestampMs), setId).tracksListened++
  return true
}

function samplePlayback(previous, poll, now, sourceUrl, { maxGapMs = 2000 } = {}) {
  const at = Number(now)
  const currentTime = Number(poll?.currentTime) || 0
  const current = sourceUrl && Number.isFinite(at)
    ? { at, currentTime, isPlaying: !!poll?.isPlaying, sourceUrl }
    : null
  let interval = null

  if (current && previous && previous.sourceUrl === sourceUrl &&
      previous.isPlaying && current.isPlaying) {
    const elapsedMs = at - previous.at
    const mediaDelta = currentTime - previous.currentTime
    if (elapsedMs > 0 && elapsedMs <= maxGapMs && mediaDelta > 0 && mediaDelta < 5) {
      interval = { startedAtMs: previous.at, endedAtMs: at }
    }
  }

  return { current, interval }
}

function totals(stats) {
  let listenedMs = stats.legacy.listenedMs
  let tracksListened = stats.legacy.tracksListened
  const listenDays = new Set(stats.legacy.listenDays)

  for (const [day, bucket] of Object.entries(stats.days)) {
    let dayListenedMs = 0
    for (const entry of Object.values(bucket.sets)) {
      listenedMs += entry.listenedMs
      dayListenedMs += entry.listenedMs
      tracksListened += entry.tracksListened
    }
    if (dayListenedMs > 0) listenDays.add(day)
  }

  const sortedDays = [...listenDays].sort()
  return {
    totalListenedSeconds: listenedMs / 1000,
    totalTracksListened: tracksListened,
    listenDays: sortedDays,
    firstListenDate: stats.legacy.firstListenDate || sortedDays[0] || null,
  }
}

function statsForRenderer(stats) {
  return { ...stats, ...totals(stats) }
}

function aggregateRange(stats, fromDay, toDay) {
  const sets = new Map()
  let listenedMs = 0
  let tracksListened = 0

  for (const [day, bucket] of Object.entries(stats.days)) {
    if ((fromDay && day < fromDay) || (toDay && day > toDay)) continue
    for (const [setId, entry] of Object.entries(bucket.sets)) {
      listenedMs += entry.listenedMs
      tracksListened += entry.tracksListened
      const current = sets.get(setId) || { listenedMs: 0, tracksListened: 0 }
      current.listenedMs += entry.listenedMs
      current.tracksListened += entry.tracksListened
      sets.set(setId, current)
    }
  }

  const djs = new Map()
  for (const [setId, entry] of sets) {
    for (const djId of stats.sets[setId]?.djIds || []) {
      const current = djs.get(djId) || { listenedMs: 0, tracksListened: 0 }
      current.listenedMs += entry.listenedMs
      current.tracksListened += entry.tracksListened
      djs.set(djId, current)
    }
  }

  const byListenedTime = (a, b) => {
    const labelA = a.name || a.title || a.id
    const labelB = b.name || b.title || b.id
    return b.listenedMs - a.listenedMs || labelA.localeCompare(labelB)
  }
  return {
    listenedMs,
    tracksListened,
    sets: [...sets].map(([id, entry]) => ({ id, ...stats.sets[id], ...entry }))
      .sort(byListenedTime),
    djs: [...djs].map(([id, entry]) => ({ id, name: stats.djs[id]?.name || id, ...entry }))
      .sort(byListenedTime),
  }
}

module.exports = {
  SCHEMA_VERSION,
  aggregateRange,
  djIdForName,
  emptyStats,
  localDayKey,
  migrateStats,
  recordListening,
  recordTrack,
  samplePlayback,
  setIdFor,
  statsForRenderer,
  totals,
  upsertSet,
}
