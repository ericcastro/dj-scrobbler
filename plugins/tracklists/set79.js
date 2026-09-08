/**
 * set79 tracklist plugin.
 *
 * set79 analyses the *SoundCloud* upload of a DJ set, so it indexes sets by
 * their SoundCloud permalink. Two ways in:
 *
 *   1. SoundCloud source → the tracklist URL is a pure string construction
 *      from the track path (no network needed).
 *   2. Any other source (today: YouTube) → search set79's own index by set
 *      title. Results carry `url_identity` (the SoundCloud path), which is
 *      exactly what the tracklist URL is built from.
 *
 * Path 2 lets set79 run as a best-effort fallback beside 1001Tracklists. The
 * manual provider action remains available to callers that explicitly retry.
 *
 * The search endpoint is CSRF-protected, so it rides on a short-lived session
 * bootstrapped from a normal page load. Extraction needs no session at all —
 * tracklist pages are public and server-rendered.
 */
const https = require('https')

const HOST = 'set79.com'
const SESSION_PATH = '/status'          // small page that still sets the session
const SESSION_TTL_MS = 20 * 60 * 1000   // server cookie lasts 24 h; refresh sooner
const REQUEST_TIMEOUT_MS = 10_000

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:150.0) Gecko/20100101 Firefox/150.0',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
}

function providerError(code, message) {
  const err = new Error(message)
  err.code = code
  err.providerId = 'set79'
  return err
}

function networkError(message) {
  return providerError(
    'network_unavailable',
    message || 'Network connection is unavailable. Check your connection and try again.'
  )
}

// ── Transport ─────────────────────────────────────────────────────────────────

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: HOST, ...options }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString(),
      }))
    })
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy()
      reject(networkError('Network timed out while checking set79.'))
    })
    req.on('error', () => reject(networkError('Could not reach set79. Check your connection and try again.')))
    if (body) req.write(body)
    req.end()
  })
}

// The CSRF token is rendered into every page as a hidden input, and is also
// carried inside the Flask session cookie itself. Read the markup first and
// fall back to the cookie so a markup change alone doesn't break the lookup.
function csrfTokenFromHtml(html) {
  const m = (html || '').match(/name="csrf_token"[^>]*\svalue="([^"]+)"/)
  return m ? m[1] : null
}

function csrfTokenFromCookie(cookie) {
  try {
    const payload = cookie.split('=').slice(1).join('=').split('.')[0]
    return JSON.parse(Buffer.from(payload, 'base64').toString()).csrf_token || null
  } catch {
    return null
  }
}

let cachedSession = null   // { cookie, csrfToken, fetchedAt }

async function getSession(forceRefresh = false) {
  const fresh = cachedSession && (Date.now() - cachedSession.fetchedAt) < SESSION_TTL_MS
  if (fresh && !forceRefresh) return cachedSession

  const res = await request({
    path: SESSION_PATH,
    method: 'GET',
    headers: { ...COMMON_HEADERS, Referer: `https://${HOST}/` },
  })

  const setCookie = (res.headers['set-cookie'] || []).find(c => c.startsWith('set79_session='))
  const cookie = setCookie ? setCookie.split(';')[0] : null
  const csrfToken = csrfTokenFromHtml(res.body) || (cookie && csrfTokenFromCookie(cookie))

  if (!cookie || !csrfToken) {
    throw providerError('provider_unavailable', 'set79 did not return a usable session. Try again later.')
  }

  cachedSession = { cookie, csrfToken, fetchedAt: Date.now() }
  return cachedSession
}

// POST a JSON body to a CSRF-protected endpoint. A 403 means the session went
// stale (or was never valid) — rebuild it once and retry before giving up.
async function postJson(path, payload, { retry = true } = {}) {
  const session = await getSession()
  const data = JSON.stringify(payload)

  const res = await request({
    path,
    method: 'POST',
    headers: {
      ...COMMON_HEADERS,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'X-CSRF-Token': session.csrfToken,
      'X-Requested-With': 'XMLHttpRequest',
      Origin: `https://${HOST}`,
      Referer: `https://${HOST}/`,
      Cookie: session.cookie,
    },
  }, data)

  if (res.status === 403 && retry) {
    cachedSession = null
    return postJson(path, payload, { retry: false })
  }
  if (res.status !== 200) {
    throw providerError('provider_unavailable', `set79 returned HTTP ${res.status}.`)
  }

  try {
    return JSON.parse(res.body)
  } catch {
    throw providerError('provider_unavailable', 'set79 returned an unreadable response.')
  }
}

// ── Search ────────────────────────────────────────────────────────────────────

// set79 indexes sets by their SoundCloud permalink, stored as `url_identity`
// ("soundcloud.com/<artist>/<track>"). Normalise away any scheme/leading slash
// so the tracklist URL is built the same way as the SoundCloud-source path.
function normaliseIdentity(identity) {
  if (!identity) return null
  const trimmed = String(identity).trim().replace(/^https?:\/\//, '').replace(/^\/+/, '')
  if (!trimmed.startsWith('soundcloud.com/')) return null
  const parts = trimmed.split('/').filter(Boolean)
  return parts.length === 3 ? parts.join('/') : null
}

function tracklistUrlForIdentity(identity) {
  return `https://${HOST}/tracklist/${identity}`
}

function soundcloudUrlForTracklistUrl(tracklistUrl) {
  try {
    const url = new URL(tracklistUrl)
    if (url.hostname !== HOST && url.hostname !== `www.${HOST}`) return null
    const prefix = '/tracklist/'
    if (!url.pathname.startsWith(prefix)) return null
    const identity = normaliseIdentity(decodeURIComponent(url.pathname.slice(prefix.length)))
    return identity ? `https://${identity}` : null
  } catch {
    return null
  }
}

// A SoundCloud permalink already *is* a set79 identity — no search needed.
function soundcloudIdentity(url) {
  try {
    const u = new URL(url)
    if (!/(^|\.)soundcloud\.com$/.test(u.hostname)) return null
    return normaliseIdentity('soundcloud.com' + u.pathname)
  } catch {
    return null
  }
}

// Strip the noise YouTube uploaders bolt onto DJ set titles.
function simplifyTitle(title) {
  return String(title || '')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\((?:[^()]*\b(?:official|video|hd|4k|uhd|visuali[sz]er|lyrics|full\s+set|dj\s+set|live\s+set)\b[^()]*)\)/ig, ' ')
    .replace(/\b(?:official\s+)?(?:music\s+)?video\b/ig, ' ')
    .replace(/\b(?:4k|uhd|hd|hq)\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// set79's search is punctuation-sensitive in a way that silently costs you the
// result: a separator the indexed title happens not to share drops the match
// count to zero even when every real word lines up. "CLOUDY @ HIVE Festival
// 2026 | TECHNO CASTLE" finds nothing, while the same words without the pipe
// find the set. Flattening every separator to a space is the high-recall query.
function flattenTitle(title) {
  return String(title || '')
    .replace(/[|@/\\_–—·•~"'`´:;,!?&()[\]{}]+/g, ' ')
    .replace(/\s+-+\s+/g, ' ')          // standalone dashes, but not "Wu-Tang"
    .replace(/\s+/g, ' ')
    .trim()
}

// Cross-platform titles sometimes disagree only on a weekend/edition marker
// (for example YouTube "WE2" versus SoundCloud with no marker). This is a
// deliberately narrow relaxation, added as a later query rung rather than
// changing the original title used for scoring.
function dropEditionMarkers(title) {
  return String(title || '')
    .replace(/\b(?:we|w)\s*\d{1,2}\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Query ladder, most precise first. Every rung is searched and the hits merged
// rather than stopping at the first non-empty one: a rung can return a single
// wrong set, and stopping there would hide the right one further down. The
// caller ranks the merged list by title similarity, so extra candidates cost
// nothing but a round trip.
function searchQueries(meta) {
  const title = (meta?.title || '').trim()
  if (!title) return []
  const simplified = simplifyTitle(title)
  const flattened = flattenTitle(simplified)
  const queries = [title, simplified, flattened, dropEditionMarkers(flattened)]
  return [...new Set(queries.filter(q => q.length >= 3))]
}

async function searchSets(query) {
  const data = await postJson('/search', { query })
  const results = Array.isArray(data?.results) ? data.results : []
  return results.filter(r => r?.category_type === 'set')
}

// ── Extraction ────────────────────────────────────────────────────────────────

// set79 server-renders one <tr class="track-row"> per track, carrying the cue
// point in data-track-start (seconds) and the name in data-track-name. Names
// read "Title - Artist" — the reverse of 1001Tracklists' "Artist - Title".
const TRACKLIST_EXTRACT_SCRIPT = `(() => {
  const pad = n => String(n).padStart(2, '0')
  const formatCue = (total) => {
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = Math.floor(total % 60)
    return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s)
  }
  return Array.from(document.querySelectorAll('tr.track-row')).map((row, index) => {
    const startAttr   = row.getAttribute('data-track-start')
    const parsedStart = startAttr === null || startAttr.trim() === '' ? NaN : parseInt(startAttr, 10)
    const hasTimestamp = Number.isFinite(parsedStart) && parsedStart >= 0
    const cueSeconds   = hasTimestamp ? parsedStart : null

    const numCell  = row.querySelector('td[aria-label^="Track number"]')
    const trackNum = numCell ? (parseInt(numCell.textContent.trim(), 10) || null) : (index + 1)

    let raw = (row.getAttribute('data-track-name') || '').trim()
    // set79 prefixes fuzzy identifications with "Unknown track of". Keep the
    // flag, drop the words — they would otherwise land in the scrobbled title.
    const isApproximate = /^unknown track of\\s+/i.test(raw)
    if (isApproximate) raw = raw.replace(/^unknown track of\\s+/i, '').trim()

    const dashIdx = raw.lastIndexOf(' - ')
    const title   = dashIdx > 0 ? raw.slice(0, dashIdx).trim() : raw
    const artist  = dashIdx > 0 ? raw.slice(dashIdx + 3).trim() : ''

    return {
      providerTrackId: 'set79-row-' + index,
      trackNum,
      artist,
      title,
      raw,
      isId: !raw || /^id$/i.test(raw),
      isApproximate,
      isWWith: false,
      isMashupComponent: false,
      hasTimestamp,
      cueSeconds,
      cueDisplay: hasTimestamp ? formatCue(cueSeconds) : '',
      noTimestamp: !hasTimestamp,
      artUrl: '',
    }
  }).filter(t => t.raw || t.hasTimestamp)
})()`

// set79 publishes these fields as explicit semantic links and a machine-readable
// date. Keep this separate from the track rows and deliberately avoid guessing
// values from the set title or descriptive prose.
const METADATA_EXTRACT_SCRIPT = `(() => {
  const related = document.querySelector('nav[aria-label="Related Content"]') || document
  const names = selector => Array.from(related.querySelectorAll(selector))
    .map(el => el.textContent.trim())
    .filter(Boolean)
  const firstName = selector => names(selector)[0] || null
  const date = document.querySelector('time[datetime]')?.getAttribute('datetime')?.trim() || null
  return {
    djNames: [...new Set(names('a[href^="/dj/"] [itemprop="name"]'))],
    venue: firstName('a[href^="/club/"] [itemprop="name"]'),
    event: firstName('a[href^="/festival/"] [itemprop="name"], a[href^="/host/"] [itemprop="name"]'),
    date,
  }
})()`

// The total is populated by set79's embedded SoundCloud player after load.
// It is used only to rank a small title-matched shortlist, not as metadata.
const CANDIDATE_INFO_EXTRACT_SCRIPT = `(() => {
  const text = document.querySelector('#cp-time-total')?.textContent?.trim()
  if (!text || text === '--:--') return null
  const parts = text.split(':').map(Number)
  if (parts.length < 2 || parts.length > 3 || parts.some(n => !Number.isFinite(n) || n < 0)) return null
  const durationSeconds = parts.reduce((total, part) => total * 60 + part, 0)
  return durationSeconds > 0 ? { durationSeconds } : null
})()`

module.exports = {
  id: 'set79',
  name: 'set79',
  supportedSources: ['youtube', 'soundcloud'],

  // Used only as a fallback rather than a primary provider: matching a YouTube
  // set to its SoundCloud upload by title is a guess, not an exact-ID lookup.
  experimental: true,

  // Only accept a search hit that genuinely resembles the set being played —
  // set79's search happily returns loosely-related sets by the same DJ.
  minMatchScore: 40,

  // Only open a few plausible set79 pages to read the SoundCloud player's
  // duration. Playback is already running while this best-effort work occurs.
  durationCandidateLimit: 3,
  minDurationCandidateTitleScore: 25,
  candidateInfoExtractScript: CANDIDATE_INFO_EXTRACT_SCRIPT,

  matchUrl(url) {
    return url.includes('set79.com/tracklist/')
  },

  sourceUrlForTracklistUrl: soundcloudUrlForTracklistUrl,

  async findTracklists(meta) {
    const direct = soundcloudIdentity(meta.url)
    if (direct) return [{ url: tracklistUrlForIdentity(direct), title: meta.title || '' }]

    const seen = new Set()
    const results = []
    for (const query of searchQueries(meta)) {
      for (const hit of await searchSets(query)) {
        const id = normaliseIdentity(hit.url_identity)
        if (!id || seen.has(id)) continue
        seen.add(id)
        results.push({ url: tracklistUrlForIdentity(id), title: hit.category_name || '' })
      }
    }
    return results
  },

  tracklistExtractScript: TRACKLIST_EXTRACT_SCRIPT,
  metadataExtractScript: METADATA_EXTRACT_SCRIPT,

  // Copy for the "no tracklist found" UI when this provider is offered as a
  // second try after the source's primary provider came up empty.
  alternateInfo: {
    prompt: 'You can also try fetching a tracklist from set79.com',
    label:  'Try set79.com instead (experimental)',
    note:   'set79 analyses the SoundCloud upload of a set — the match is made by title, so double-check it looks right.',
  },

  footerLabel: 'view on set79 ↗',

  // Registrable domain the app is allowed to open in the user's browser
  externalHost: 'set79.com',

  _test: {
    csrfTokenFromCookie,
    csrfTokenFromHtml,
    normaliseIdentity,
    providerError,
    flattenTitle,
    dropEditionMarkers,
    searchQueries,
    simplifyTitle,
    soundcloudUrlForTracklistUrl,
    soundcloudIdentity,
    TRACKLIST_EXTRACT_SCRIPT,
    METADATA_EXTRACT_SCRIPT,
    CANDIDATE_INFO_EXTRACT_SCRIPT,
  },
}
