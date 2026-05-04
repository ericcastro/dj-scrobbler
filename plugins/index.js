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

const youtube    = require('./sources/youtube')
const soundcloud = require('./sources/soundcloud')
const tl1001     = require('./tracklists/1001tracklists')
const set79      = require('./tracklists/set79')

const SOURCES    = [youtube, soundcloud]
const TRACKLISTS = [tl1001, set79]

// Default routing: source ID → tracklist plugin ID.
// Future: make this user-configurable per source.
const ROUTING = {
  youtube:    '1001tracklists',
  soundcloud: 'set79',
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

// Words that carry no identifying weight in DJ set titles
const GENERIC_TITLE_WORDS = new Set([
  'dj', 'set', 'live', 'mix', 'official', 'full', 'video', 'the', 'a', 'an',
  'at', 'in', 'of', 'and', 'with', 'presents', 'ft', 'feat', 'featuring',
  'music', 'session', 'radio', 'show', 'podcast', 'episode', 'best',
])

// Normalise a string for word-level matching:
// 1. NFD decomposition strips combining diacritics (ë→e, ö→o, etc.) so that
//    "Tiësto" and the URL slug "tiesto" tokenise to the same word.
// 2. Remaining non-alphanumeric chars are removed (not replaced with a space)
//    so they never create spurious word boundaries.
function normaliseForMatching(s) {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9\s]/g, '')                       // remove other specials
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

module.exports = { SOURCES, TRACKLISTS, ROUTING, sourceForUrl, tracklistForUrl, tracklistForSource, titleSimilarity }
