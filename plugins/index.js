/**
 * Plugin registry.
 *
 * Adding a new source (e.g. Mixcloud):
 *   1. Create plugins/sources/mixcloud.js implementing the source interface
 *   2. Add it to SOURCES below
 *   3. Add a ROUTING entry pointing to a tracklist plugin
 *
 * Adding a new tracklist provider (e.g. Tunefind):
 *   1. Create plugins/tracklists/tunefind.js implementing the tracklist interface
 *   2. Add it to TRACKLISTS below
 *   3. Wire it in ROUTING
 */

const youtube          = require('./sources/youtube')
const soundcloudDormant = require('./sources/soundcloud')
const tl1001           = require('./tracklists/1001tracklists')
const set79            = require('./tracklists/set79')
const events           = require('./events')

const SOURCES    = [youtube]
const TRACKLISTS = [tl1001, set79]
const EVENTS     = events.EVENTS

// Parked for the v0.5 player refactor: the SoundCloud *source* still needs the
// app-owned player work before it can participate in playback. Its tracklist
// provider is already live — set79 serves YouTube as an automatic fallback, and
// handles a SoundCloud permalink without a search when that source wakes up.
const DORMANT_INTEGRATIONS = {
  sources: [soundcloudDormant],
  routing: {
    soundcloud: 'set79',
  },
}

// Default routing: source ID → tracklist plugin ID.
// Future: make this user-configurable per source.
const ROUTING = {
  youtube: '1001tracklists',
}

// Providers a user can try by hand when the routed provider comes up empty.
const ALTERNATE_ROUTING = {
  youtube: ['set79'],
}

// Best-effort providers started beside the primary lookup. Primary results
// always win; these are only eligible to supply a tracklist when it has none.
const AUTOMATIC_FALLBACK_ROUTING = {
  youtube: ['set79'],
}

function sourceForUrl(url) {
  return SOURCES.find(s => s.matchUrl(url)) || null
}

function tracklistForUrl(url) {
  return TRACKLISTS.find(p => p.matchUrl(url)) || null
}

function tracklistForSource(sourceId) {
  const id = ROUTING[sourceId]
  return TRACKLISTS.find(p => p.id === id) || null
}

function tracklistById(providerId) {
  return TRACKLISTS.find(p => p.id === providerId) || null
}

// Alternate providers for a source, in offer order, minus any already tried.
function alternateTracklistsForSource(sourceId, { exclude = [] } = {}) {
  const excluded = new Set(exclude)
  return (ALTERNATE_ROUTING[sourceId] || [])
    .filter(id => !excluded.has(id))
    .map(tracklistById)
    .filter(Boolean)
}

function automaticFallbackTracklistsForSource(sourceId) {
  return (AUTOMATIC_FALLBACK_ROUTING[sourceId] || [])
    .map(tracklistById)
    .filter(Boolean)
}

// Words that carry no identifying weight in DJ set titles
const GENERIC_TITLE_WORDS = new Set([
  'dj', 'set', 'live', 'mix', 'official', 'full', 'video', 'the', 'a', 'an',
  'at', 'in', 'of', 'and', 'with', 'presents', 'ft', 'feat', 'featuring',
  'music', 'session', 'radio', 'show', 'podcast', 'episode', 'best',
])

// Normalise a string for word-level matching:
// 1. NFD decomposition strips combining diacritics (ë→e, ö→o, etc.) so that
//    "Tiësto" and the URL slug "tiesto" tokenise to the same word.
// 2. Remaining non-alphanumeric chars become spaces (not deleted) so they
//    act as word separators — e.g. "KI/KI" → "ki ki" not "kiki", which then
//    matches the URL-slug form "ki-ki" → "ki ki" after dash→space conversion.
function normaliseForMatching(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9\s]/g, ' ')                      // separators → space
    .replace(/\s+/g, ' ').trim()
}

// Extract the artist portion from a title like "Artist - Title" / "Artist @ Venue"
function extractArtistWords(title) {
  if (!title) return []
  const match = title.match(/^(.+?)(?:\s[-–|@×]\s|\s-\s|\s\|\s|\s@\s)/)
  if (!match) return []
  return normaliseForMatching(match[1])
    .split(' ')
    .filter(w => w.length > 1 && !GENERIC_TITLE_WORDS.has(w))
}

// Jaccard word-overlap similarity — returns 0–100 integer.
// Accepts either two plain strings (legacy) or (meta, resultTitle) where
// meta = { title, channel? }. In the latter form, artist words extracted
// from the title must appear in the result — prevents matching on generic
// phrases like "All Night Long" when the artist names differ entirely.
function titleSimilarity(metaOrString, resultTitle) {
  const aTitle = typeof metaOrString === 'string'
    ? metaOrString
    : (metaOrString?.title || '')

  const words = s => new Set(normaliseForMatching(s).split(' ').filter(Boolean))
  const wa = words(aTitle)
  const wb = words(resultTitle)
  const intersection = [...wa].filter(w => wb.has(w)).length
  const union        = new Set([...wa, ...wb]).size
  const score        = union === 0 ? 0 : Math.round((intersection / union) * 100)

  // Artist anchor check — only when called with a meta object
  if (typeof metaOrString !== 'string') {
    const artistWords = extractArtistWords(aTitle)
    if (artistWords.length > 0 && !artistWords.some(w => wb.has(w))) {
      return 0  // no artist-name overlap → not a match
    }
  }

  return score
}

// Duration is unusually strong evidence for long-form DJ sets. Treat matches
// within 1% (capped at one minute) as corroborating, but make a known duration
// outside that small window actively count against the candidate.
function durationSimilarity(sourceSeconds, candidateSeconds) {
  const source = Number(sourceSeconds)
  const candidate = Number(candidateSeconds)
  if (!Number.isFinite(source) || source <= 0 || !Number.isFinite(candidate) || candidate <= 0) return null

  const delta = Math.abs(source - candidate)
  if (delta <= 2) return 100
  const tolerance = Math.max(15, Math.min(60, source * 0.01))
  if (delta > tolerance) return 0
  return Math.round(100 - ((delta - 2) / (tolerance - 2)) * 25)
}

// Keep title resemblance as a safety gate: equal-duration uploads with wholly
// different artist/title words must not match. Once that gate passes, duration
// carries most of the score so harmless missing edition markers do not sink an
// otherwise exact cross-platform match.
function tracklistMatchScore(meta, candidate) {
  const titleScore = titleSimilarity(meta, candidate?.title || '')
  if (titleScore === 0) return { score: 0, titleScore, durationScore: null }

  const durationScore = durationSimilarity(meta?.durationSeconds, candidate?.durationSeconds)
  const weightedScore = durationScore === null
    ? titleScore
    : Math.round((titleScore * 0.35) + (durationScore * 0.65))

  // An unmistakable normalized title (typically the same artists, event and
  // year) is sufficient evidence by itself. Cross-platform uploads can include
  // different intro/outro edits, so duration may boost this confidence but
  // must not veto it. Partial titles still rely on the duration-heavy score.
  const score = titleScore >= 85
    ? Math.max(titleScore, weightedScore)
    : weightedScore
  return { score, titleScore, durationScore }
}

module.exports = {
  SOURCES,
  TRACKLISTS,
  EVENTS,
  ROUTING,
  ALTERNATE_ROUTING,
  AUTOMATIC_FALLBACK_ROUTING,
  DORMANT_INTEGRATIONS,
  sourceForUrl,
  tracklistForUrl,
  tracklistForSource,
  tracklistById,
  alternateTracklistsForSource,
  automaticFallbackTracklistsForSource,
  durationSimilarity,
  tracklistMatchScore,
  titleSimilarity,
  lookupNextEvents: events.lookupNextEvents,
  resolveEventLocation: events.resolveLocation,
}
