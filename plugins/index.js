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

// Jaccard word-overlap similarity — returns 0–100 integer
function titleSimilarity(a, b) {
  const words = s => new Set(
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  )
  const wa = words(a), wb = words(b)
  const intersection = [...wa].filter(w => wb.has(w)).length
  const union = new Set([...wa, ...wb]).size
  return union === 0 ? 0 : Math.round((intersection / union) * 100)
}

module.exports = { SOURCES, TRACKLISTS, ROUTING, sourceForUrl, tracklistForUrl, tracklistForSource, titleSimilarity }
