const { app, BrowserWindow, ipcMain, shell, Menu, nativeImage, nativeTheme, screen } = require('electron')
const { autoUpdater } = require('electron-updater')
const path   = require('path')
const https  = require('https')
const crypto = require('crypto')
const fs     = require('fs')
const os     = require('os')
const plugins  = require('./plugins')
const {
  cleanVersion,
  compareVersions,
  releaseFromGitHub: releaseFromGitHubPayload,
  releaseFromUpdateInfo: releaseFromUpdateInfoPayload,
  mergeUpdateStatus,
} = require('./lib/update-utils')
const macUpdater = require('./lib/mac-updater')
const { wireYouTubePlayerUi, isYouTubePlayerUrl } = require('./lib/youtube-player-ui')
const { startPrimaryWithFallback } = require('./lib/parallel-tracklist-lookup')
const {
  hasSetMetadata,
  isMetadataValueIgnored,
  normalizeSetMetadata,
} = require('./lib/set-metadata')
const { classifyMetadataOutlook } = require('./lib/metadata-outlook')
const { writeJsonAtomic } = require('./lib/atomic-json')
const {
  migrateStats,
  recordListening,
  recordTrack,
  samplePlayback,
  statsForRenderer,
  upsertSet,
} = require('./lib/listening-stats')
const {
  artworkLookupKey,
  isArtworkLookupCandidate,
  lookupDeezerArtwork,
} = require('./lib/deezer-artwork')

// Must be set before app is ready — controls menu bar name and dock tooltip
app.name = 'DJ Scrobbler'
if (process.platform === 'win32' && app.isPackaged) app.setAppUserModelId('com.djscrobbler.app')

// Force dark color scheme for all webviews — YouTube and other sources will
// respect prefers-color-scheme: dark and render in their native dark mode.
nativeTheme.themeSource = 'dark'

// Hands-free update run for scripts/install-test-build.sh: check on launch,
// then download and install the update without any clicks.
const AUTO_UPDATE_TEST = process.argv.includes('--auto-update-test')

// ── Verbose logging ───────────────────────────────────────────────────────────
// Enable with:  DJ_VERBOSE=1 npm start
const VERBOSE = !!process.env.DJ_VERBOSE || AUTO_UPDATE_TEST || !app.isPackaged
const DEBUG_LOG_PATH = (process.env.DJ_VERBOSE || AUTO_UPDATE_TEST) ? path.join(os.tmpdir(), 'djscrobbler-debug.log') : null
const recentLogs = []
function formatLogArg(arg) {
  if (typeof arg === 'string') return arg
  try { return JSON.stringify(arg) } catch { return String(arg) }
}
function appendLog(args) {
  const line = `[${new Date().toISOString()}] ${args.map(formatLogArg).join(' ')}`
  recentLogs.push(line)
  if (recentLogs.length > 200) recentLogs.shift()
  if (DEBUG_LOG_PATH) {
    try { fs.appendFileSync(DEBUG_LOG_PATH, `${line}\n`) } catch {}
  }
}
function log(...args) {
  appendLog(args)
  if (VERBOSE) console.log(...args)
}
const DEVELOPER_MODE = process.argv.includes('--developer')
const TRACKLIST_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MIN_AUTOMATIC_SET_DURATION_SECONDS = 10 * 60
const EVENT_LOOKUP_CACHE_VERSION = 1
const MAX_EVENT_LOOKUP_CACHE_ENTRIES = 300
const ARTWORK_CACHE_VERSION = 1
const ARTWORK_CACHE_HIT_TTL_MS = 365 * 24 * 60 * 60 * 1000
const ARTWORK_CACHE_MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_ARTWORK_CACHE_ENTRIES = 6000
const ARTWORK_LOOKUP_CONCURRENCY = 2
const ARTWORK_LOOKUP_GAP_MS = 250
const TITLE_BAR_HEIGHT = 52
const WINDOWS_TITLE_BAR_OVERLAY_HEIGHT = TITLE_BAR_HEIGHT - 1
const THEME_TITLE_BAR = {
  'neon-night': { color: '#0f1a30', symbolColor: '#e7f7ff' },
  'signal-teal': { color: '#071f25', symbolColor: '#f0fffc' },
  'sunset-deck': { color: '#190c1e', symbolColor: '#fff3ea' },
}
const MAX_TRACKLIST_CACHE_ENTRIES = 200
const UPDATE_OWNER = 'ericcastro'
const UPDATE_REPO = 'dj-scrobbler'
const UPDATE_RELEASES_URL = `https://github.com/${UPDATE_OWNER}/${UPDATE_REPO}/releases`
const UPDATE_RELEASES_API_URL = `https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/releases?per_page=10`
// macOS builds are ad-hoc signed, and Squirrel.Mac refuses to install updates
// without a valid Apple signature — so macOS self-updates via lib/mac-updater.
const MAC_SELF_UPDATE = process.platform === 'darwin'

let mainWindow
let currentWvContents = null
let playerWvContents = null
let browserWvContents = null
let pendingSourceUrl = null
const attachedWebviews = new Map()
let displayFullscreenBounds = null
let windowDragStart = null
let isQuitting = false   // distinguishes Cmd+Q from red-button close
let saveBoundsTimer = null
let updateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  latestVersion: null,
  releaseUrl: UPDATE_RELEASES_URL,
  changelog: '',
  canInstall: false,
  isChecking: false,
  error: null,
}
let updateCheckWasManual = false
let installAfterDownload = false
let macStagedAppPath = null

autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false
autoUpdater.allowPrerelease = true

// ── Persistence ───────────────────────────────────────────────────────────────

function getStorePath() {
  return path.join(app.getPath('userData'), 'dj-scrobbler.json')
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(getStorePath(), 'utf8'))
  } catch {
    return { favorites: [], history: [], searchQueries: [], settings: {} }
  }
}

function writeStore(data) {
  writeJsonAtomic(getStorePath(), data)
}

function backfillSavedMetadataFromCache(store) {
  const cachedMetadataBySource = new Map()
  Object.values(store.tracklistCache || {}).forEach(entry => {
    if (!entry?.sourceUrl) return
    const metadata = normalizeSetMetadata(entry.metadata)
    const existing = cachedMetadataBySource.get(entry.sourceUrl) || normalizeSetMetadata(null)
    cachedMetadataBySource.set(entry.sourceUrl, {
      djNames: metadata.djNames.length ? metadata.djNames : existing.djNames,
      venue: metadata.venue || existing.venue,
      event: metadata.event || existing.event,
      date: metadata.date || existing.date,
    })
  })

  let changed = false
  ;['favorites', 'history'].forEach(key => {
    if (!Array.isArray(store[key])) return
    store[key] = store[key].map(item => {
      const metadata = cachedMetadataBySource.get(item.url)
      if (!metadata) return item
      const availableDjNames = metadata.djNames.filter(name => (
        !isMetadataValueIgnored(item.metadataIgnoredValues, 'djNames', name)
      ))
      const patch = {
        ...(!Array.isArray(item.djNames) || !item.djNames.length ? { djNames: availableDjNames } : {}),
        ...(!item.venue && metadata.venue && !isMetadataValueIgnored(item.metadataIgnoredValues, 'venue', metadata.venue) ? { venue: metadata.venue } : {}),
        ...(!item.event && metadata.event && !isMetadataValueIgnored(item.metadataIgnoredValues, 'event', metadata.event) ? { event: metadata.event } : {}),
        ...(!item.date && metadata.date && !isMetadataValueIgnored(item.metadataIgnoredValues, 'date', metadata.date) ? { date: metadata.date } : {}),
      }
      if (!patch.djNames?.length) delete patch.djNames
      if (!Object.keys(patch).length) return item
      changed = true
      return { ...item, ...patch }
    })
  })
  return changed
}

function readStoreForRenderer() {
  const store = readStore()
  if (backfillSavedMetadataFromCache(store)) writeStore(store)
  const rendererStore = { ...store }
  delete rendererStore.tracklistCache
  delete rendererStore.tracklistPreferences
  delete rendererStore.artworkCache
  delete rendererStore.eventLookupCache
  return rendererStore
}

// ── Stats persistence (separate file — personal data, never seed/commit) ──────

function getStatsPath() {
  return path.join(app.getPath('userData'), 'dj-scrobbler-stats.json')
}

const STATS_WRITE_DEBOUNCE_MS = 5000
let listeningStats = null
let listeningStatsDirty = false
let listeningStatsWriteTimer = null

function loadStats() {
  if (listeningStats) return listeningStats
  try {
    const stored = JSON.parse(fs.readFileSync(getStatsPath(), 'utf8'))
    listeningStats = migrateStats(stored)
    if (stored?.schemaVersion !== listeningStats.schemaVersion) markStatsDirty()
  } catch {
    listeningStats = migrateStats(null)
  }
  return listeningStats
}

function readStats() {
  return statsForRenderer(loadStats())
}

let statsRendererUpdateTimer = null
function scheduleStatsRendererUpdate() {
  if (statsRendererUpdateTimer) return
  statsRendererUpdateTimer = setTimeout(() => {
    statsRendererUpdateTimer = null
    if (!mainWindow?.isDestroyed()) mainWindow.webContents.send('stats-updated', readStats())
  }, 1000)
}

function persistStatsNow() {
  if (listeningStatsWriteTimer) {
    clearTimeout(listeningStatsWriteTimer)
    listeningStatsWriteTimer = null
  }
  if (!listeningStatsDirty || !listeningStats) return
  const statsPath = getStatsPath()
  try {
    writeJsonAtomic(statsPath, listeningStats)
    listeningStatsDirty = false
  } catch (error) {
    log(`[stats] persist failed: ${error?.message || error}`)
  }
}

function markStatsDirty({ immediate = false } = {}) {
  listeningStatsDirty = true
  if (immediate) {
    persistStatsNow()
    return
  }
  if (!listeningStatsWriteTimer) {
    listeningStatsWriteTimer = setTimeout(persistStatsNow, STATS_WRITE_DEBOUNCE_MS)
  }
}

function tracklistCacheKey(providerId, sourceUrl) {
  return crypto.createHash('sha1').update(`${providerId}:${sourceUrl}`).digest('hex')
}

function isUsableCachedTracklist(entry, now = Date.now()) {
  return entry &&
    entry.version >= 2 &&       // v1 had incorrect hasTimestamp detection — force re-fetch
    entry.expiresAt > now &&
    typeof entry.sourceUrl === 'string' &&
    typeof entry.providerId === 'string' &&
    typeof entry.tracklistUrl === 'string' &&
    Array.isArray(entry.tracks) &&
    entry.tracks.length > 0
}

function pruneTracklistCache(cache, now = Date.now()) {
  for (const [key, entry] of Object.entries(cache)) {
    if (!entry || entry.expiresAt <= now) delete cache[key]
  }

  const entries = Object.entries(cache)
  if (entries.length <= MAX_TRACKLIST_CACHE_ENTRIES) return

  entries
    .sort(([, a], [, b]) => (b.cachedAt || 0) - (a.cachedAt || 0))
    .slice(MAX_TRACKLIST_CACHE_ENTRIES)
    .forEach(([key]) => delete cache[key])
}

function getCachedTracklist(providerId, sourceUrl) {
  if (!providerId || !sourceUrl) return null
  const store = readStore()
  const cache = store.tracklistCache || {}
  const key = tracklistCacheKey(providerId, sourceUrl)
  const entry = cache[key]
  const now = Date.now()

  if (isUsableCachedTracklist(entry, now)) return entry

  if (entry) {
    delete cache[key]
    store.tracklistCache = cache
    pruneTracklistCache(cache, now)
    writeStore(store)
    log(`[cache] expired tracklist provider=${providerId} source=${sourceUrl}`)
  }
  return null
}

function writeCachedTracklist({ sourceUrl, providerId, tracklistUrl, title, thumbnailUrl, tracks, metadata }) {
  if (!sourceUrl || !providerId || !tracklistUrl || !Array.isArray(tracks) || tracks.length === 0) return

  const store = readStore()
  if (!store.tracklistCache || typeof store.tracklistCache !== 'object') store.tracklistCache = {}

  const now = Date.now()
  const key = tracklistCacheKey(providerId, sourceUrl)
  store.tracklistCache[key] = {
    version: 2,
    sourceUrl,
    providerId,
    tracklistUrl,
    title: title || null,
    thumbnailUrl: thumbnailUrl || null,
    tracks,
    metadata: metadata || null,
    cachedAt: now,
    expiresAt: now + TRACKLIST_CACHE_TTL_MS,
  }
  pruneTracklistCache(store.tracklistCache, now)
  writeStore(store)
  log(`[cache] stored tracklist tracks=${tracks.length} provider=${providerId} source=${sourceUrl}`)
}

function eventLookupCacheKey(location, djNames) {
  const city = String(location?.city || '').trim().toLowerCase()
  const countryCode = String(location?.countryCode || '').trim().toUpperCase()
  const names = [...new Set((djNames || [])
    .map(name => String(name).trim().toLowerCase())
    .filter(Boolean))]
    .sort()
  return crypto.createHash('sha1').update(`${city}:${countryCode}:${names.join('|')}`).digest('hex')
}

function nextLocalDayStart(now = Date.now()) {
  const date = new Date(now)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime()
}

function isUsableCachedEventLookup(entry, now = Date.now()) {
  return entry &&
    entry.version === EVENT_LOOKUP_CACHE_VERSION &&
    entry.expiresAt > now &&
    Array.isArray(entry.results)
}

function pruneEventLookupCache(cache, now = Date.now()) {
  for (const [key, entry] of Object.entries(cache)) {
    if (!isUsableCachedEventLookup(entry, now)) delete cache[key]
  }
  const entries = Object.entries(cache)
  if (entries.length <= MAX_EVENT_LOOKUP_CACHE_ENTRIES) return
  entries
    .sort(([, left], [, right]) => (right.cachedAt || 0) - (left.cachedAt || 0))
    .slice(MAX_EVENT_LOOKUP_CACHE_ENTRIES)
    .forEach(([key]) => delete cache[key])
}

function getCachedEventLookup(location, djNames) {
  const store = readStore()
  const cache = store.eventLookupCache || {}
  const key = eventLookupCacheKey(location, djNames)
  const now = Date.now()
  const entry = cache[key]
  if (isUsableCachedEventLookup(entry, now)) return entry.results

  if (entry) {
    delete cache[key]
    store.eventLookupCache = cache
    pruneEventLookupCache(cache, now)
    writeStore(store)
    log(`[cache] expired event lookup city=${location.city}`)
  }
  return null
}

function writeCachedEventLookup(location, djNames, results) {
  if (!Array.isArray(results)) return
  const store = readStore()
  if (!store.eventLookupCache || typeof store.eventLookupCache !== 'object') store.eventLookupCache = {}

  const now = Date.now()
  store.eventLookupCache[eventLookupCacheKey(location, djNames)] = {
    version: EVENT_LOOKUP_CACHE_VERSION,
    cachedAt: now,
    expiresAt: nextLocalDayStart(now),
    results,
  }
  pruneEventLookupCache(store.eventLookupCache, now)
  writeStore(store)
  log(`[cache] stored event lookup city=${location.city} artists=${djNames.length}`)
}

function artworkCacheKey(track) {
  return crypto.createHash('sha1').update(`deezer:${artworkLookupKey(track)}`).digest('hex')
}

function isUsableCachedArtwork(entry, now = Date.now()) {
  return entry &&
    entry.version === ARTWORK_CACHE_VERSION &&
    entry.expiresAt > now &&
    (entry.artUrl === null || typeof entry.artUrl === 'string')
}

function pruneArtworkCache(cache, now = Date.now()) {
  for (const [key, entry] of Object.entries(cache)) {
    if (!isUsableCachedArtwork(entry, now)) delete cache[key]
  }

  const entries = Object.entries(cache)
  if (entries.length <= MAX_ARTWORK_CACHE_ENTRIES) return
  entries
    .sort(([, a], [, b]) => (b.checkedAt || 0) - (a.checkedAt || 0))
    .slice(MAX_ARTWORK_CACHE_ENTRIES)
    .forEach(([key]) => delete cache[key])
}

// Artwork cache entries are tiny JSON records containing only Deezer's 250px
// URL (or a negative result). Chromium owns its normal HTTP image cache; the app
// never downloads or stores full-size cover files itself.
function prepareTracksForArtwork(tracks) {
  const cache = readStore().artworkCache || {}
  const now = Date.now()
  return tracks.map(track => {
    if (!isArtworkLookupCandidate(track)) return track
    const cached = cache[artworkCacheKey(track)]
    if (!isUsableCachedArtwork(cached, now)) {
      return { ...track, artworkStatus: 'loading' }
    }
    return {
      ...track,
      artUrl: cached.artUrl || '',
      artworkStatus: cached.artUrl ? 'ready' : 'missing',
    }
  })
}

function writeArtworkCacheUpdates(updates) {
  if (!updates.size) return
  const store = readStore()
  const cache = store.artworkCache && typeof store.artworkCache === 'object'
    ? store.artworkCache
    : {}
  for (const [key, entry] of updates) cache[key] = entry
  pruneArtworkCache(cache)
  store.artworkCache = cache
  writeStore(store)
}

function getTracklistPreference(sourceUrl) {
  if (!sourceUrl) return null
  const providerId = readStore().tracklistPreferences?.[sourceUrl]
  return plugins.tracklistById(providerId) ? providerId : null
}

function writeTracklistPreference(sourceUrl, providerId) {
  if (!sourceUrl || !plugins.tracklistById(providerId)) return false
  const store = readStore()
  if (!store.tracklistPreferences || typeof store.tracklistPreferences !== 'object') {
    store.tracklistPreferences = {}
  }
  store.tracklistPreferences[sourceUrl] = providerId
  writeStore(store)
  log(`[cache] preferred tracklist provider=${providerId} source=${sourceUrl}`)
  return true
}

// ── Consent popup dismissal ───────────────────────────────────────────────────

const CONSENT_SCRIPT = `
(function() {
  function dismiss() {
    const labels = [
      /^accept all$/i, /^accept$/i, /^agree$/i, /^i agree$/i,
      /^got it$/i,    /^ok$/i,     /^consent$/i, /^continue$/i,
      /^reject all$/i, /^refuse all$/i, /^decline all$/i,
    ]
    const btns = Array.from(document.querySelectorAll('button, [role="button"], a.btn, input[type="button"]'))
    for (const btn of btns) {
      const text = (btn.textContent || btn.value || btn.getAttribute('aria-label') || '').trim()
      if (labels.some(r => r.test(text))) { btn.click(); return true }
    }
    const ytConsent = document.querySelector('ytd-consent-bump-v2-lightbox, tp-yt-paper-dialog')
    if (ytConsent) {
      const rejectBtn = ytConsent.querySelector('button[aria-label*="Reject"], yt-button-shape button')
      if (rejectBtn) { rejectBtn.click(); return true }
    }
    const scBanner = document.querySelector('.cookieBanner__buttons, [data-testid="cookie-policy-dialog"]')
    if (scBanner) {
      const ok = scBanner.querySelector('button')
      if (ok) { ok.click(); return true }
    }
    return false
  }
  if (!dismiss()) setTimeout(dismiss, 2000)
})()
`

// ── Last.fm ───────────────────────────────────────────────────────────────────

const LFM_KEY    = 'f3f24407f4bd2142b31d27fb47461e05'
const LFM_SECRET = '5c9447b7b09a1514c64aab54002645db'

let lfmSession = null   // { key, name } once authenticated
let lfmStatus  = 'unconfigured'  // 'unconfigured' | 'ok' | 'error'

function setLfmStatus(status) {
  lfmStatus = status
  if (mainWindow) mainWindow.webContents.send('lfm-status', status)
}

function lfmSign(params) {
  const str = Object.keys(params)
    .filter(k => k !== 'format')
    .sort()
    .map(k => k + params[k])
    .join('') + LFM_SECRET
  return crypto.createHash('md5').update(str, 'utf8').digest('hex')
}

function lfmPost(params) {
  return new Promise((resolve, reject) => {
    const p = { ...params, api_key: LFM_KEY, format: 'json' }
    p.api_sig = lfmSign(p)
    const body = new URLSearchParams(p).toString()
    const req = https.request({
      hostname: 'ws.audioscrobbler.com',
      path: '/2.0/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'dj-scrobbler/0.1',
      },
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

async function lfmConnect() {
  const tokenRes = await lfmPost({ method: 'auth.getToken' })
  if (!tokenRes.token) throw new Error('Could not get auth token from Last.fm')
  const token = tokenRes.token

  shell.openExternal(`https://www.last.fm/api/auth/?api_key=${LFM_KEY}&token=${token}`)

  return new Promise((resolve, reject) => {
    let attempts = 0
    const iv = setInterval(async () => {
      attempts++
      if (attempts > 45) {
        clearInterval(iv)
        reject(new Error('Timed out waiting for Last.fm authorisation'))
        return
      }
      try {
        const res = await lfmPost({ method: 'auth.getSession', token })
        if (res.session) {
          clearInterval(iv)
          lfmSession = { key: res.session.key, name: res.session.name }
          const store = readStore()
          store.settings.lfmSession = lfmSession
          writeStore(store)
          setLfmStatus('ok')
          resolve(lfmSession)
        }
      } catch {}
    }, 2000)
  })
}

function lfmDisconnect() {
  lfmSession = null
  setLfmStatus('unconfigured')
  const store = readStore()
  delete store.settings.lfmSession
  writeStore(store)
}

function lfmUpdateNowPlaying(artist, title) {
  if (!lfmSession?.key) return
  lfmPost({ method: 'track.updateNowPlaying', artist, track: title, sk: lfmSession.key })
    .then(res => setLfmStatus(res.error ? 'error' : 'ok'))
    .catch(() => setLfmStatus('error'))
}

function lfmScrobble(artist, title, startedAt, album) {
  if (!lfmSession?.key || !artist || !title) return
  const params = {
    method: 'track.scrobble',
    'artist[0]': artist,
    'track[0]': title,
    'timestamp[0]': String(Math.floor(startedAt / 1000)),
    sk: lfmSession.key,
  }
  if (album) params['album[0]'] = album
  lfmPost(params)
    .then(res => setLfmStatus(res.error ? 'error' : 'ok'))
    .catch(() => setLfmStatus('error'))
}

// ── App-owned playback + timeline tracking ───────────────────────────────────

let monitorInterval      = null
let monitorGeneration    = 0
let lastNowPlaying       = null
let lastTrackData        = null
let trackStartedAt       = null
let currentSetTitle      = null   // DJ set title used as album in Last.fm scrobbles
let currentThumbnailUrl  = null   // YouTube thumbnail for history/favorites
let currentSourceUrl     = null   // Canonical source URL for history/favorites
let currentTracklistUrl  = null
let currentTracklistProvider = null
let currentTracklistOptions = new Map()
let currentTracks        = []
let currentSourceId      = null   // Source plugin ID the current set came from
let currentSourceMeta    = null   // getMeta() result, replayed by manual retries
let triedProviders       = new Set()   // Providers already searched for this set
let isYouTubePlayerMode  = false
let isTracklistLookupPending = false
let lastPlayerPlaying    = null
let currentTrackPlayedMs = 0
let activeTrackKey       = null
let statsPlaybackSample  = null
let statsSetReady        = false
let currentStatsDjNames  = []
let lastStatsTrackNum    = null
let currentLookupToken   = 0
let currentArtworkToken  = 0
let artworkCacheGeneration = 0

function extractVideoId(url) {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
    if (u.hostname === 'youtu.be')          return u.pathname.slice(1).split('?')[0]
  } catch {}
  return null
}

function youtubePlayerUrl(videoId) {
  return `https://www.djscrobbler.com/embed/youtube?id=${encodeURIComponent(videoId)}`
}

function thumbnailForSourceUrl(sourceUrl) {
  const videoId = extractVideoId(sourceUrl)
  return videoId ? `https://img.youtube.com/vi/${videoId}/mqdefault.jpg` : null
}

function resetTimelineState() {
  lastNowPlaying       = null
  lastTrackData        = null
  trackStartedAt       = null
  lastPlayerPlaying    = null
  currentTrackPlayedMs = 0
  activeTrackKey       = null
}

function currentStatsSet() {
  if (!statsSetReady || !currentSourceUrl) return null
  return {
    sourceId: currentSourceId,
    sourceUrl: currentSourceUrl,
    title: currentSetTitle,
    djNames: currentStatsDjNames,
  }
}

function storedDjNamesForStats(store, sourceUrl) {
  for (const key of ['history', 'favorites']) {
    const saved = Array.isArray(store?.[key])
      ? store[key].find(item => item?.url === sourceUrl && item.djNames?.length)
      : null
    const names = normalizeSetMetadata(saved).djNames
    if (names.length) return names
  }
  return []
}

function syncCurrentStatsMetadataFromStore(store) {
  const names = storedDjNamesForStats(store, currentSourceUrl)
  if (!statsSetReady || !names.length) return
  currentStatsDjNames = names
  registerCurrentStatsSet()
}

function registerCurrentStatsSet() {
  const descriptor = currentStatsSet()
  if (!descriptor) return null
  const setId = upsertSet(loadStats(), descriptor)
  markStatsDirty()
  return setId
}

function resetStatsPlayback({ flush = false } = {}) {
  statsPlaybackSample = null
  if (flush) persistStatsNow()
}

function updateListeningStats(poll, now) {
  const descriptor = currentStatsSet()
  const previous = statsPlaybackSample
  // Adjacent 500 ms polls should move together. The sampler rejects seeks,
  // stalled playheads, and long gaps caused by suspend or an unresponsive webview.
  const sampled = samplePlayback(previous, poll, now, descriptor?.sourceUrl)
  let listenedMs = 0
  if (descriptor && sampled.interval) {
    listenedMs = sampled.interval.endedAtMs - sampled.interval.startedAtMs
    recordListening(
      loadStats(),
      descriptor,
      sampled.interval.startedAtMs,
      sampled.interval.endedAtMs
    )
    markStatsDirty()
    scheduleStatsRendererUpdate()
  }
  statsPlaybackSample = sampled.current

  if (previous?.isPlaying && !poll.isPlaying) persistStatsNow()
  return listenedMs
}

function recordStatsTrackTransition(track, now) {
  const trackNum = Number(track?.trackNum)
  if (!Number.isFinite(trackNum)) return
  if (lastStatsTrackNum !== null && trackNum === lastStatsTrackNum + 1) {
    const descriptor = currentStatsSet()
    if (descriptor && recordTrack(loadStats(), descriptor, now)) {
      markStatsDirty()
      scheduleStatsRendererUpdate()
    }
  }
  lastStatsTrackNum = trackNum
}

function scrobbleLastTrackIfReady() {
  if (!lastTrackData || lastTrackData.isId || !trackStartedAt) return
  if (currentTrackPlayedMs < 30000) return
  lfmScrobble(lastTrackData.artist, lastTrackData.title, trackStartedAt, currentSetTitle)
}

function stopMonitoring({ finalize = true } = {}) {
  monitorGeneration++
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null }
  if (finalize) scrobbleLastTrackIfReady()
  resetStatsPlayback({ flush: true })
  resetTimelineState()
}

function normalizeTrack(track, index, providerId) {
  const cueSeconds = Number(track.cueSeconds)
  const hasTimestamp = !!track.hasTimestamp ||
    (!track.noTimestamp && Number.isFinite(cueSeconds) && cueSeconds >= 0)
  const raw = track.raw || [track.artist, track.title].filter(Boolean).join(' - ')
  return {
    ...track,
    providerId,
    providerTrackId: track.providerTrackId || `${providerId}:${track.trackNum || index + 1}:${cueSeconds || 0}:${raw}`,
    raw,
    cueSeconds: Number.isFinite(cueSeconds) && cueSeconds >= 0 ? cueSeconds : null,
    hasTimestamp,
    noTimestamp: !!track.noTimestamp || !hasTimestamp,
  }
}

function normalizeTracks(tracks, providerId) {
  const provider = plugins.tracklistById(providerId)
  const prepared = provider?.normalizeTracklist
    ? provider.normalizeTracklist(tracks)
    : tracks
  return prepared.map((track, index) => normalizeTrack(track, index, providerId))
}

function isArtworkJobCurrent(job) {
  return job.artworkToken === currentArtworkToken &&
    job.lookupToken === currentLookupToken &&
    job.sourceUrl === currentSourceUrl &&
    job.providerId === currentTracklistProvider &&
    job.tracklistUrl === currentTracklistUrl
}

function emitTrackArtwork(job, providerTrackIds, artUrl, artworkStatus) {
  if (!isArtworkJobCurrent(job)) return
  const ids = new Set(providerTrackIds)
  currentTracks = currentTracks.map(track => ids.has(track.providerTrackId)
    ? { ...track, artUrl: artUrl || '', artworkStatus }
    : track
  )
  if (ids.has(lastTrackData?.providerTrackId)) {
    lastTrackData = { ...lastTrackData, artUrl: artUrl || '', artworkStatus }
  }
  mainWindow.webContents.send('track-artwork', {
    sourceUrl: job.sourceUrl,
    providerId: job.providerId,
    tracklistUrl: job.tracklistUrl,
    providerTrackIds,
    artUrl: artUrl || null,
    artworkStatus,
  })
}

async function enrichArtworkInBackground(tracks, job) {
  const grouped = new Map()
  tracks.filter(track => track.artworkStatus === 'loading').forEach(track => {
    const key = artworkCacheKey(track)
    if (!grouped.has(key)) grouped.set(key, { key, track, providerTrackIds: [] })
    grouped.get(key).providerTrackIds.push(track.providerTrackId)
  })
  const groups = [...grouped.values()]
  if (!groups.length) return

  log(`[artwork] background start tracks=${tracks.length} uniqueLookups=${groups.length}`)
  const updates = new Map()
  const attempted = new Set()
  let nextIndex = 0
  let stop = false
  let hits = 0
  let misses = 0

  async function worker() {
    while (!stop && nextIndex < groups.length) {
      if (!isArtworkJobCurrent(job)) return
      const group = groups[nextIndex++]
      attempted.add(group.key)
      try {
        const match = await lookupDeezerArtwork(group.track, {
          userAgent: `DJ-Scrobbler/${app.getVersion()}`,
        })
        const checkedAt = Date.now()
        const artUrl = match?.artUrl || null
        updates.set(group.key, {
          version: ARTWORK_CACHE_VERSION,
          source: 'deezer',
          artUrl,
          deezerTrackId: match?.deezerTrackId || null,
          checkedAt,
          expiresAt: checkedAt + (artUrl ? ARTWORK_CACHE_HIT_TTL_MS : ARTWORK_CACHE_MISS_TTL_MS),
        })
        if (artUrl) hits++
        else misses++
        emitTrackArtwork(job, group.providerTrackIds, artUrl, artUrl ? 'ready' : 'missing')
      } catch (error) {
        // A provider/network failure is not a negative lookup and is never
        // cached. Stop this set's queue so a temporary outage cannot cause a
        // burst of doomed requests; the next load will try again.
        stop = true
        log(`[artwork] Deezer paused: ${error?.message || error}`)
        emitTrackArtwork(job, group.providerTrackIds, null, 'error')
      }
      if (!stop) await delay(ARTWORK_LOOKUP_GAP_MS)
    }
  }

  await Promise.all(Array.from({ length: ARTWORK_LOOKUP_CONCURRENCY }, () => worker()))

  if (stop && isArtworkJobCurrent(job)) {
    groups
      .filter(group => !attempted.has(group.key))
      .forEach(group => emitTrackArtwork(job, group.providerTrackIds, null, 'error'))
  }
  // One synchronous store write per completed set, rather than one write per
  // cover, keeps the cache durable without needlessly churning the user's disk.
  if (job.cacheGeneration === artworkCacheGeneration) writeArtworkCacheUpdates(updates)
  log(`[artwork] background done hits=${hits} misses=${misses} cached=${updates.size}${stop ? ' paused=true' : ''}`)
}

function isTimelineTrack(track) {
  return track &&
    !track.isWWith &&
    !track.isMashupComponent &&
    !track.noTimestamp &&
    typeof track.cueSeconds === 'number' &&
    Number.isFinite(track.cueSeconds)
}

function activeTrackForTime(seconds) {
  let active = null
  for (const track of currentTracks) {
    if (!isTimelineTrack(track)) continue
    if (track.cueSeconds <= seconds + 0.75) active = track
    else break
  }
  return active
}

function keyForTrack(track) {
  return track?.providerTrackId || track?.raw || String(track?.trackNum || '')
}

function emitPlayerStateOnly(poll) {
  if (poll.isPlaying === lastPlayerPlaying) return
  lastPlayerPlaying = poll.isPlaying
  mainWindow.webContents.send('now-playing', {
    artist: '',
    title: '',
    raw: '__youtube_player__',
    trackNum: null,
    isPlaying: poll.isPlaying,
    currentTime: poll.currentTime,
    duration: poll.duration,
    source: 'youtube-player',
  })
}

function emitTimelineTrack(track, poll, now = Date.now()) {
  const key = keyForTrack(track)
  const raw = track.raw || [track.artist, track.title].filter(Boolean).join(' - ') || key
  const data = {
    artist: track.artist || '',
    title: track.title || raw,
    raw,
    trackNum: track.trackNum || null,
    isPlaying: poll.isPlaying,
    isId: !!track.isId,
    source: currentTracklistProvider || 'timeline',
    providerId: currentTracklistProvider,
    providerTrackId: track.providerTrackId || null,
    artUrl: track.artUrl || '',
    artworkStatus: track.artworkStatus || (track.artUrl ? 'ready' : 'missing'),
    cueSeconds: track.cueSeconds,
    currentTime: poll.currentTime,
    duration: poll.duration,
  }

  const trackChanged = key !== activeTrackKey
  const playChanged = poll.isPlaying !== lastPlayerPlaying

  if (!trackChanged && !playChanged && data.raw === lastNowPlaying) return

  if (trackChanged) {
    scrobbleLastTrackIfReady()
    recordStatsTrackTransition(track, now)
    activeTrackKey = key
    lastNowPlaying = data.raw
    lastTrackData  = data
    trackStartedAt = Date.now()
    currentTrackPlayedMs = 0
    if (!data.isId) lfmUpdateNowPlaying(data.artist, data.title)
  } else if (lastTrackData) {
    lastTrackData = { ...lastTrackData, isPlaying: poll.isPlaying, currentTime: poll.currentTime, duration: poll.duration }
  }

  lastPlayerPlaying = poll.isPlaying
  mainWindow.webContents.send('now-playing', trackChanged ? data : lastTrackData)
}

function handlePlaybackPoll(poll) {
  const now = Date.now()
  const listenedMs = updateListeningStats(poll, now)
  if (lastTrackData) currentTrackPlayedMs += listenedMs

  if (poll.duration > 0) {
    // Keep the source duration on the lookup metadata as soon as the app-owned
    // player exposes it. Best-effort providers can use it without ever gating
    // playback startup.
    if (currentSourceMeta) currentSourceMeta.durationSeconds = Number(poll.duration)
    mainWindow.webContents.send('playback-progress', {
      currentTime: poll.currentTime,
      duration: poll.duration,
    })
  }

  const activeTrack = activeTrackForTime(poll.currentTime)
  if (!activeTrack) {
    emitPlayerStateOnly(poll)
    return
  }

  emitTimelineTrack(activeTrack, poll, now)
}

// window.ytPlayer is exposed by the HTTPS-hosted djscrobbler.com embed page
// through the YouTube IFrame API.
const YT_STATE_SCRIPT = `
  (() => {
    const p = window.ytPlayer
    if (!p || typeof p.getPlayerState !== 'function') return null
    return p.getPlayerState() === 1
  })()
`

const YT_PLAY_SCRIPT = `
  (() => {
    const p = window.ytPlayer
    if (p && typeof p.playVideo === 'function') p.playVideo()
  })()
`

const YT_PAUSE_SCRIPT = `
  (() => {
    const p = window.ytPlayer
    if (p && typeof p.pauseVideo === 'function') p.pauseVideo()
  })()
`

const YT_VOLUME_STATE_SCRIPT = `
  (() => {
    const p = window.ytPlayer
    if (!p || typeof p.getVolume !== 'function') return null
    return {
      volume: p.getVolume(),
      muted: typeof p.isMuted === 'function' ? p.isMuted() : false,
    }
  })()
`

const YT_POLL_SCRIPT = `
  (() => {
    const p = window.ytPlayer
    if (!p || typeof p.getPlayerState !== 'function') return null
    const state = p.getPlayerState()
    if (state === -1) return null
    return {
      isPlaying: state === 1,
      currentTime: typeof p.getCurrentTime === 'function' ? (p.getCurrentTime() || 0) : 0,
      duration: typeof p.getDuration === 'function' ? (p.getDuration() || 0) : 0,
    }
  })()
`

function startYouTubePlayerMonitoring(wvContents) {
  stopMonitoring({ finalize: false })
  const generation = monitorGeneration
  setTimeout(() => {
    if (generation !== monitorGeneration || wvContents.isDestroyed()) return
    wvContents.executeJavaScript(YT_PLAY_SCRIPT).catch(() => {})
    const settings = readStore().settings || {}
    const volume = Math.max(0, Math.min(100, Math.round(Number(settings.playerVolume ?? 80) || 0)))
    wvContents.executeJavaScript(`
      (() => {
        const p = window.ytPlayer
        if (!p || typeof p.setVolume !== 'function') return
        p.setVolume(${volume})
        if (${volume} === 0 && typeof p.mute === 'function') p.mute()
        if (${volume} > 0 && typeof p.unMute === 'function') p.unMute()
      })()
    `).catch(() => {})
  }, 1000)
  let pollPending = false
  monitorInterval = setInterval(async () => {
    if (pollPending) return
    pollPending = true
    try {
      const poll = await wvContents.executeJavaScript(YT_POLL_SCRIPT)
      if (generation === monitorGeneration && poll) handlePlaybackPoll(poll)
    } catch {
      // Navigation and shutdown routinely invalidate an in-flight poll.
    } finally {
      pollPending = false
    }
  }, 500)
}

function playerSeek(seconds) {
  if (!currentWvContents) return
  const s = Number(seconds)
  if (!isFinite(s) || s < 0) return
  log('[player-seek] seeking to', s)
  currentWvContents.executeJavaScript(`
    (() => {
      const p = window.ytPlayer
      if (p && typeof p.seekTo === 'function') {
        p.seekTo(${s}, true)
        if (typeof p.playVideo === 'function') p.playVideo()
        return 'ok'
      }
      return 'not-ready'
    })()
  `).catch(() => {})
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function executeTracklistExtraction(wc, script) {
  for (let i = 0; i < 12; i++) {
    const tracks = await wc.executeJavaScript(script).catch(() => null)
    if (Array.isArray(tracks) && tracks.length) return tracks
    await delay(500)
  }
  return []
}

async function executeCandidateInfoExtraction(wc, script) {
  for (let i = 0; i < 24; i++) {
    const info = await wc.executeJavaScript(script).catch(() => null)
    if (info && typeof info === 'object') return info
    await delay(250)
  }
  return null
}

// Candidate pages are loaded only for a small, title-plausible shortlist. A
// failed page/widget is deliberately reduced to null so it cannot cancel the
// provider search, the primary provider, or playback.
function extractCandidateInfoInBackground(tlPlugin, url) {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      show: false,
      width: 960,
      height: 700,
      icon: appIcon(),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    })
    const wc = win.webContents
    let settled = false

    const finish = (value) => {
      if (settled) return
      settled = true
      if (!win.isDestroyed()) win.destroy()
      resolve(value)
    }

    const timeout = setTimeout(() => finish(null), 10_000)
    wc.on('did-finish-load', async () => {
      const info = await executeCandidateInfoExtraction(wc, tlPlugin.candidateInfoExtractScript)
      clearTimeout(timeout)
      finish(info)
    })
    wc.on('did-fail-load', (_event, _code, _desc, _failedUrl, isMainFrame) => {
      if (!isMainFrame) return
      clearTimeout(timeout)
      finish(null)
    })
    wc.on('render-process-gone', () => {
      clearTimeout(timeout)
      finish(null)
    })
    win.loadURL(url)
  })
}

async function waitForSourceDuration(meta, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (!(Number(meta?.durationSeconds) > 0) && Date.now() < deadline) await delay(250)
  return Number(meta?.durationSeconds) > 0 ? Number(meta.durationSeconds) : null
}

function isTooShortForAutomaticSetLookups(meta) {
  const duration = Number(meta?.durationSeconds)
  return Number.isFinite(duration) && duration > 0 && duration < MIN_AUTOMATIC_SET_DURATION_SECONDS
}

function automaticLookupServices(sourceUrl, status = 'checking') {
  return {
    youtube: { status: 'available', url: sourceUrl },
    soundcloud: { status, url: null },
    '1001tracklists': { status, url: null },
    set79: { status, url: null },
  }
}

function extractTracklistInBackground(tlPlugin, url) {
  return new Promise((resolve) => {
    log(`[extract] background load ${url}`)
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      icon: appIcon(),
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    })
    const wc = win.webContents
    let settled = false

    const finish = (value) => {
      if (settled) return
      settled = true
      if (!win.isDestroyed()) win.destroy()
      resolve(value)
    }

    const timeout = setTimeout(() => {
      log('[extract] timed out')
      finish({ title: null, tracks: [], metadata: null })
    }, 20000)

    wc.on('did-finish-load', async () => {
      try {
        log(`[extract] did-finish-load ${wc.getURL()}`)
        wc.executeJavaScript(CONSENT_SCRIPT).catch(() => {})
        const title = await wc.executeJavaScript(
          `(() => {
            const h1 = document.querySelector('h1')?.textContent?.trim()
            if (h1 && !/please wait, you will be forwarded/i.test(h1)) return h1
            return document.querySelector('meta[property="og:title"]')?.content?.trim() || document.title
          })()`
        ).catch(() => null)
        const tracks = tlPlugin.tracklistExtractScript
          ? await executeTracklistExtraction(wc, tlPlugin.tracklistExtractScript)
          : []
        const metadata = tlPlugin.metadataExtractScript
          ? await wc.executeJavaScript(tlPlugin.metadataExtractScript).catch(() => null)
          : null
        log(`[extract] tracks=${tracks.length} title="${title || ''}"`)
        clearTimeout(timeout)
        finish({ title, tracks, metadata })
      } catch (err) {
        log('[extract] failed', err?.message || err)
        clearTimeout(timeout)
        finish({ title: null, tracks: [], metadata: null })
      }
    })

    wc.on('did-fail-load', (_event, code, desc, failedUrl, isMainFrame) => {
      if (isMainFrame) {
        log(`[extract] did-fail-load code=${code} desc="${desc}" url=${failedUrl}`)
        clearTimeout(timeout)
        finish({ title: null, tracks: [], metadata: null })
      }
    })

    wc.on('render-process-gone', (_event, details) => {
      log(`[extract] render-process-gone reason=${details.reason}`)
      clearTimeout(timeout)
      finish({ title: null, tracks: [], metadata: null })
    })

    win.loadURL(url)
  })
}

async function findBestTracklist(tlPlugin, meta) {
  const results = await tlPlugin.findTracklists(meta)
  log(`[lookup] results=${results.length}`, results.map(r => r.title))

  if (results.length === 0) return null

  if (results[0].confirmed) {
    log(`[lookup] → confirmed match: ${results[0].url}`)
    return results[0]
  }

  let candidates = results
  if (tlPlugin.candidateInfoExtractScript && await waitForSourceDuration(meta)) {
    const limit = tlPlugin.durationCandidateLimit || 3
    const minTitleScore = tlPlugin.minDurationCandidateTitleScore || 1
    const shortlist = results
      .map(r => ({ result: r, titleScore: plugins.titleSimilarity(meta, r.title) }))
      .filter(entry => entry.titleScore >= minTitleScore)
      .sort((a, b) => b.titleScore - a.titleScore)
      .slice(0, limit)

    const infoByUrl = new Map(await Promise.all(shortlist.map(async ({ result }) => {
      const info = await extractCandidateInfoInBackground(tlPlugin, result.url).catch(() => null)
      return [result.url, info]
    })))
    candidates = results.map(result => ({ ...result, ...(infoByUrl.get(result.url) || {}) }))
  }

  const scored = candidates
    .map(r => ({ ...r, ...plugins.tracklistMatchScore(meta, r) }))
    .sort((a, b) => b.score - a.score)

  log(`[${tlPlugin.id}] ${scored.length} results for: "${meta.title}"`)
  scored.forEach((r, i) => log(`  [${i + 1}] ${r.score}% title=${r.titleScore}% duration=${r.durationScore ?? 'n/a'}%  ${r.title}  →  ${r.url}`))

  // Providers that match on weak signals (title search rather than an exact
  // media-ID match) raise the bar via minMatchScore.
  const minScore = tlPlugin.minMatchScore || 1
  const top = scored[0]
  if (!top || top.score < minScore) {
    if (top) log(`[${tlPlugin.id}] best score ${top.score}% below minimum ${minScore}% — treating as no match`)
    return null
  }
  return top
}

function tracklistLookupErrorPayload(err, tlPlugin) {
  if (!err) return null
  return {
    code: err.code || 'tracklist_lookup_failed',
    message: err.message || 'Tracklist lookup failed.',
    providerId: err.providerId || tlPlugin?.id || null,
  }
}

// Fields every tracklist-loaded payload carries, whatever the outcome.
function tracklistLoadedBase(tlPlugin) {
  return {
    url: currentSourceUrl,
    sourceUrl: currentSourceUrl,
    title: currentSetTitle,
    thumbnailUrl: currentThumbnailUrl,
    providerId: tlPlugin?.id || null,
    providerName: tlPlugin?.name || null,
    providerFooterLabel: tlPlugin?.footerLabel || null,
    sourcePublishedAt: currentSourceMeta?.publishedAt || null,
    sourceViewCount: currentSourceMeta?.viewCount ?? null,
    metadataOutlook: classifyMetadataOutlook({
      publishedAt: currentSourceMeta?.publishedAt,
      viewCount: currentSourceMeta?.viewCount,
    }),
  }
}

// Extra fields for the "nothing found" panel: how to contribute a tracklist to
// the source's primary provider, plus any alternate provider not yet tried.
function tracklistFallbackExtras() {
  const primary = plugins.tracklistForSource(currentSourceId)
  const contributeInfo = primary?.contributeInfo
  const alternates = plugins
    .alternateTracklistsForSource(currentSourceId, { exclude: [...triedProviders] })
    .map(p => ({
      id: p.id,
      name: p.name,
      prompt: p.alternateInfo?.prompt || null,
      label: p.alternateInfo?.label || `Try ${p.name} instead`,
      note: p.alternateInfo?.note || null,
    }))

  return {
    contributeLabel: contributeInfo?.label || null,
    contributeNote:  contributeInfo?.note  || null,
    contributeUrl:   contributeInfo?.url?.(currentSourceUrl) || null,
    alternateProviders: alternates,
  }
}

function emitSetMetadata(tlPlugin, metadata, sourceUrl, lookupToken) {
  if (lookupToken !== currentLookupToken || sourceUrl !== currentSourceUrl || !hasSetMetadata(metadata)) return
  if (!currentStatsDjNames.length) currentStatsDjNames = metadata.djNames || []
  registerCurrentStatsSet()
  mainWindow.webContents.send('set-metadata', {
    sourceUrl,
    providerId: tlPlugin.id,
    ...metadata,
  })
}

function sourceLinksForTracklist(tlPlugin, tracklistUrl) {
  const soundcloud = tlPlugin.sourceUrlForTracklistUrl?.(tracklistUrl) || null
  return soundcloud ? { soundcloud } : {}
}

function providerAvailability(outcome) {
  if (!outcome) return 'unavailable'
  if (outcome.error) return 'error'
  return outcome.result?.usable ? 'available' : 'unavailable'
}

function emitSetAvailability(services, sourceUrl, lookupToken) {
  if (lookupToken !== currentLookupToken || sourceUrl !== currentSourceUrl) return
  mainWindow.webContents.send('set-availability', { sourceUrl, services })
}

function emitSourceStatsWhenReady(meta, sourceUrl, lookupToken) {
  if (!meta?.publicStatsPromise) return
  Promise.resolve(meta.publicStatsPromise).then(stats => {
    if (lookupToken !== currentLookupToken || sourceUrl !== currentSourceUrl) return
    meta.viewCount = stats?.viewCount ?? null
    meta.publishedAt = stats?.publishedAt || null
    mainWindow.webContents.send('source-metadata', {
      sourceUrl,
      sourcePublishedAt: meta.publishedAt,
      sourceViewCount: meta.viewCount,
      metadataOutlook: classifyMetadataOutlook({
        publishedAt: meta.publishedAt,
        viewCount: meta.viewCount,
      }),
    })
  }).catch(error => log(`[source] public metadata failed: ${error?.message || error}`))
}

/** Search and extract without changing the active tracklist or UI. */
async function probeTracklistProvider(tlPlugin, meta, lookupToken, { bypassCache = false } = {}) {
  triedProviders.add(tlPlugin.id)
  const sourceUrl = meta.url || currentSourceUrl

  if (!bypassCache) {
    log(`[lookup] checking tracklist cache for provider=${tlPlugin.id} source=${sourceUrl}`)
    const cached = getCachedTracklist(tlPlugin.id, sourceUrl)
    if (cached) {
      log(`[cache] hit provider=${cached.providerId} source=${sourceUrl} tracks=${cached.tracks.length}`)
      return {
        usable: true,
        sourceUrl,
        title: cached.title || meta.title || sourceUrl,
        tracklistUrl: cached.tracklistUrl,
        tracks: normalizeTracks(cached.tracks, cached.providerId),
        metadata: normalizeSetMetadata(cached.metadata),
        sourceLinks: sourceLinksForTracklist(tlPlugin, cached.tracklistUrl),
        fromCache: true,
      }
    }
  } else {
    log(`[cache] bypassed provider=${tlPlugin.id} source=${sourceUrl}`)
  }

  log(`[lookup] cache miss — starting network search via ${tlPlugin.id} for "${meta.title || ''}"`)
  const searchStart = Date.now()
  log(`[lookup] findBestTracklist start provider=${tlPlugin.id}`)
  const best = await findBestTracklist(tlPlugin, meta)
  log(`[lookup] findBestTracklist done in ${Date.now() - searchStart}ms result=${best ? best.url : '(none)'}`)
  if (lookupToken !== currentLookupToken) {
    log(`[lookup] token mismatch after findBestTracklist (got ${currentLookupToken}, expected ${lookupToken}) — aborting`)
    return { usable: false, stale: true, sourceUrl }
  }

  if (!best) {
    log(`[lookup] → no tracklist found via ${tlPlugin.id}`)
    return { usable: false, sourceUrl, metadata: normalizeSetMetadata(null), sourceLinks: {} }
  }

  log(`[lookup] → best match: "${best.title}" url=${best.url}`)
  log(`[lookup] → extracting tracklist from ${best.url}`)
  const extractStart = Date.now()
  const extracted = await extractTracklistInBackground(tlPlugin, best.url)
  log(`[lookup] extractTracklistInBackground done in ${Date.now() - extractStart}ms tracks=${extracted.tracks.length}`)
  if (lookupToken !== currentLookupToken) {
    log(`[lookup] token mismatch after extract (got ${currentLookupToken}, expected ${lookupToken}) — aborting`)
    return { usable: false, stale: true, sourceUrl }
  }

  const metadata = normalizeSetMetadata(extracted.metadata)
  const sourceLinks = sourceLinksForTracklist(tlPlugin, best.url)
  if (extracted.tracks.length === 0) {
    log(`[lookup] extract came back empty for ${best.url} — treating as no tracklist`)
    return { usable: false, sourceUrl, tracklistUrl: best.url, metadata, sourceLinks }
  }

  const title = meta.title || extracted.title || best.title || sourceUrl
  const tracks = normalizeTracks(extracted.tracks, tlPlugin.id)
  log(`[lookup] writing cache: provider=${tlPlugin.id} tracks=${tracks.length} title="${title}"`)
  writeCachedTracklist({
    sourceUrl,
    providerId: tlPlugin.id,
    tracklistUrl: best.url,
    title,
    thumbnailUrl: currentThumbnailUrl,
    tracks,
    metadata,
  })

  return { usable: true, sourceUrl, title, tracklistUrl: best.url, tracks, metadata, sourceLinks, fromCache: false }
}

function tracklistOptionPayload() {
  const providerOrder = new Map(plugins.TRACKLISTS.map((provider, index) => [provider.id, index]))
  return [...currentTracklistOptions.values()]
    .sort((a, b) => (providerOrder.get(a.provider.id) ?? 99) - (providerOrder.get(b.provider.id) ?? 99))
    .map(({ provider, result }) => ({
      id: provider.id,
      name: provider.name,
      tracklistUrl: result.tracklistUrl,
    }))
}

function emitTracklistOptions() {
  if (!currentSourceUrl || !currentTracklistProvider) return
  mainWindow.webContents.send('tracklist-options', {
    sourceUrl: currentSourceUrl,
    selectedProviderId: currentTracklistProvider,
    options: tracklistOptionPayload(),
  })
}

function registerTracklistOption(provider, result, lookupToken = currentLookupToken) {
  if (
    lookupToken !== currentLookupToken ||
    !result?.usable ||
    result.sourceUrl !== currentSourceUrl
  ) return false
  currentTracklistOptions.set(provider.id, { provider, result })
  emitTracklistOptions()
  return true
}

function applyTracklistResult(tlPlugin, result, { persistPreference = false } = {}) {
  isTracklistLookupPending = false
  currentTracklistUrl = result.tracklistUrl
  currentTracklistProvider = tlPlugin.id
  currentSetTitle = result.title
  registerCurrentStatsSet()
  const artworkToken = ++currentArtworkToken
  currentTracks = prepareTracksForArtwork(result.tracks)
  registerTracklistOption(tlPlugin, result)
  if (persistPreference) writeTracklistPreference(currentSourceUrl, tlPlugin.id)

  mainWindow.webContents.send('tracklist-loaded', {
    ...tracklistLoadedBase(tlPlugin),
    title: result.title,
    tracklistUrl: result.tracklistUrl,
    isFallback: false,
    fromCache: result.fromCache,
  })
  log(`[lookup] DONE sent tracklist-loaded tracks=${currentTracks.length}`)

  mainWindow.webContents.send('tracklist-data', {
    providerId: tlPlugin.id,
    url: result.tracklistUrl,
    tracks: currentTracks,
    fromCache: result.fromCache,
  })
  emitTracklistOptions()
  mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })

  // Artwork is deliberately outside the awaited tracklist path. Rows are
  // already visible (with loading placeholders) before the first request starts.
  const artworkJob = {
    artworkToken,
    cacheGeneration: artworkCacheGeneration,
    lookupToken: currentLookupToken,
    sourceUrl: currentSourceUrl,
    providerId: tlPlugin.id,
    tracklistUrl: result.tracklistUrl,
  }
  const artworkTracks = currentTracks.map(track => ({ ...track }))
  setImmediate(() => enrichArtworkInBackground(artworkTracks, artworkJob)
    .catch(error => log(`[artwork] background failed: ${error?.message || error}`)))
}

function sendTracklistFallback(tlPlugin, error = null) {
  isTracklistLookupPending = false
  currentTracklistUrl = null
  currentTracklistProvider = null
  currentTracks = []
  const lookupError = tracklistLookupErrorPayload(error, tlPlugin)
  mainWindow.webContents.send('tracklist-loaded', {
    ...tracklistLoadedBase(tlPlugin),
    tracklistUrl: null,
    isFallback: true,
    ...(lookupError ? { lookupError } : {}),
    ...tracklistFallbackExtras(),
  })
  if (lookupError?.code === 'network_unavailable') {
    mainWindow.webContents.send('wv-status', {
      type: 'network-error',
      url: currentSourceUrl,
      message: lookupError.message,
    })
  } else {
    mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
  }
}

/** Manual retry path retained for the existing alternate-provider action. */
async function runTracklistLookup(tlPlugin, meta, lookupToken, { manual = false } = {}) {
  if (!manual) mainWindow.webContents.send('wv-status', { type: 'loading', msg: `Searching ${tlPlugin.name}…` })
  try {
    const result = await probeTracklistProvider(tlPlugin, meta, lookupToken)
    if (result.stale || lookupToken !== currentLookupToken) return
    emitSetMetadata(tlPlugin, result.metadata, result.sourceUrl, lookupToken)
    const soundcloudUrl = result.sourceLinks?.soundcloud || null
    emitSetAvailability({
      [tlPlugin.id]: {
        status: result.usable ? 'available' : 'unavailable',
        url: result.usable ? result.tracklistUrl : null,
      },
      ...(tlPlugin.id === 'set79'
        ? { soundcloud: { status: soundcloudUrl ? 'available' : 'unavailable', url: soundcloudUrl } }
        : {}),
    }, result.sourceUrl, lookupToken)
    if (result.usable) applyTracklistResult(tlPlugin, result, { persistPreference: manual })
    else sendTracklistFallback(tlPlugin)
  } catch (error) {
    if (lookupToken !== currentLookupToken) return
    log(`[lookup] provider failed provider=${tlPlugin.id}: ${error?.message || error}`)
    emitSetAvailability({
      [tlPlugin.id]: { status: 'error' },
      ...(tlPlugin.id === 'set79' ? { soundcloud: { status: 'error', url: null } } : {}),
    }, meta.url || currentSourceUrl, lookupToken)
    sendTracklistFallback(tlPlugin, error)
  }
}

async function runAutomaticTracklistLookups(primaryPlugin, meta, lookupToken, {
  bypassCache = false,
  showLoading = true,
  waitForFallback = false,
} = {}) {
  const fallbackPlugin = plugins.automaticFallbackTracklistsForSource(currentSourceId)[0] || null
  if (showLoading) mainWindow.webContents.send('wv-status', { type: 'loading', msg: `Searching ${primaryPlugin.name}…` })

  const lookups = startPrimaryWithFallback({
    primaryProvider: primaryPlugin,
    fallbackProvider: fallbackPlugin,
    preferredProviderId: getTracklistPreference(meta.url || currentSourceUrl),
    lookup: plugin => probeTracklistProvider(plugin, meta, lookupToken, { bypassCache }),
  })

  // set79 metadata is useful even when 1001Tracklists supplies the tracks.
  lookups.fallback.then(outcome => {
    if (!outcome) return
    if (outcome.result) registerTracklistOption(outcome.provider, outcome.result, lookupToken)
    if (outcome.result) emitSetMetadata(outcome.provider, outcome.result.metadata, outcome.result.sourceUrl, lookupToken)
    const soundcloudUrl = outcome.result?.sourceLinks?.soundcloud || null
    emitSetAvailability({
      [outcome.provider.id]: {
        status: providerAvailability(outcome),
        url: outcome.result?.usable ? outcome.result.tracklistUrl : null,
      },
      soundcloud: { status: soundcloudUrl ? 'available' : providerAvailability(outcome), url: soundcloudUrl },
    }, meta.url || currentSourceUrl, lookupToken)
  })

  lookups.primary.then(outcome => {
    if (!outcome) return
    if (outcome.result) registerTracklistOption(outcome.provider, outcome.result, lookupToken)
    emitSetAvailability({
      [primaryPlugin.id]: {
        status: providerAvailability(outcome),
        url: outcome.result?.usable ? outcome.result.tracklistUrl : null,
      },
    }, meta.url || currentSourceUrl, lookupToken)

    if (!outcome.result?.usable && lookupToken === currentLookupToken) {
      // The fallback may still be running, but playback should already be visible.
      mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
    }
  })

  const choice = await lookups.selected
  if (lookupToken !== currentLookupToken || choice.selected?.result?.stale) return

  if (choice.selected) {
    applyTracklistResult(choice.selected.provider, choice.selected.result)
    // A user-requested refresh keeps its busy state until every advertised
    // service has settled, while the selected result is still applied immediately.
    if (waitForFallback) await Promise.all([lookups.primary, lookups.fallback])
    return
  }

  const primaryError = choice.primary?.error || null
  if (primaryError) log(`[lookup] primary provider failed: ${primaryError?.message || primaryError}`)
  if (choice.fallback?.error) log(`[lookup] fallback provider failed: ${choice.fallback.error?.message || choice.fallback.error}`)
  sendTracklistFallback(primaryPlugin, primaryError)
}

/**
 * Re-run the lookup for the set already on screen using a different provider.
 * Playback keeps running throughout — only the tracklist half of the state is
 * torn down and rebuilt.
 */
async function tryTracklistProvider(providerId) {
  const tlPlugin = plugins.tracklistById(providerId)
  if (!tlPlugin) {
    log(`[lookup] manual retry rejected — unknown provider=${providerId}`)
    return false
  }
  if (!currentSourceMeta || !currentSourceUrl) {
    log(`[lookup] manual retry rejected — no current set`)
    return false
  }

  const lookupToken = ++currentLookupToken
  log(`[lookup] MANUAL START provider=${providerId} source=${currentSourceUrl} token=${lookupToken}`)

  // Drop the previous provider's tracks so the timeline re-emits against the
  // new ones; scrobble whatever was playing before it disappears.
  scrobbleLastTrackIfReady()
  resetTimelineState()
  currentTracks = []
  currentTracklistUrl = null
  currentTracklistProvider = null
  isTracklistLookupPending = true

  emitSetAvailability({
    [tlPlugin.id]: { status: 'checking' },
    ...(tlPlugin.id === 'set79' ? { soundcloud: { status: 'checking', url: null } } : {}),
  }, currentSourceUrl, lookupToken)

  await runTracklistLookup(tlPlugin, currentSourceMeta, lookupToken, { manual: true })
  return true
}

async function selectTracklistProvider(providerId) {
  const option = currentTracklistOptions.get(providerId)
  if (!option || !currentSourceUrl) {
    log(`[lookup] provider selection rejected provider=${providerId} source=${currentSourceUrl || '(none)'}`)
    return false
  }
  if (providerId === currentTracklistProvider) {
    writeTracklistPreference(currentSourceUrl, providerId)
    return true
  }

  log(`[lookup] SWITCH provider=${providerId} source=${currentSourceUrl}`)
  scrobbleLastTrackIfReady()
  resetTimelineState()
  applyTracklistResult(option.provider, option.result, { persistPreference: true })
  return true
}

async function refreshTracklistLookups() {
  const primaryPlugin = plugins.tracklistForSource(currentSourceId)
  if (!primaryPlugin || !currentSourceMeta || !currentSourceUrl) {
    log('[lookup] refresh rejected — no current set')
    return false
  }

  const lookupToken = ++currentLookupToken
  triedProviders = new Set()
  currentTracklistOptions = new Map()
  isTracklistLookupPending = true
  log(`[lookup] REFRESH source=${currentSourceUrl} token=${lookupToken}`)

  // Clear stale presentation state immediately. The cache remains available
  // for later sessions, but neither provider may read it during this refresh.
  mainWindow.webContents.send('set-metadata', {
    sourceUrl: currentSourceUrl,
    providerId: null,
    ...normalizeSetMetadata(null),
  })
  mainWindow.webContents.send('set-availability', {
    sourceUrl: currentSourceUrl,
    services: {
      youtube: { status: 'available', url: currentSourceUrl },
      soundcloud: { status: 'checking', url: null },
      '1001tracklists': { status: 'checking', url: null },
      set79: { status: 'checking', url: null },
    },
  })

  await runAutomaticTracklistLookups(primaryPlugin, currentSourceMeta, lookupToken, {
    bypassCache: true,
    showLoading: false,
    waitForFallback: true,
  })
  return lookupToken === currentLookupToken
}

async function autoSetMetadata() {
  const set79 = plugins.tracklistById('set79')
  if (!set79 || !currentSourceMeta || !currentSourceUrl) return false

  // Reuse the active token so this metadata-only probe never cancels the
  // initial tracklist lookup or background artwork work.
  const lookupToken = currentLookupToken
  emitSetAvailability({
    set79: { status: 'checking', url: null },
    soundcloud: { status: 'checking', url: null },
  }, currentSourceUrl, lookupToken)

  try {
    const result = await probeTracklistProvider(set79, currentSourceMeta, lookupToken, { bypassCache: true })
    if (result.stale || lookupToken !== currentLookupToken) return false
    const matched = hasSetMetadata(result.metadata)
    if (matched) emitSetMetadata(set79, result.metadata, result.sourceUrl, lookupToken)
    const soundcloudUrl = result.sourceLinks?.soundcloud || null
    emitSetAvailability({
      set79: {
        status: result.usable ? 'available' : 'unavailable',
        url: result.usable ? result.tracklistUrl : null,
      },
      soundcloud: { status: soundcloudUrl ? 'available' : 'unavailable', url: soundcloudUrl },
    }, result.sourceUrl, lookupToken)
    return matched
  } catch (error) {
    if (lookupToken !== currentLookupToken) return false
    log(`[set79] auto metadata failed: ${error?.message || error}`)
    emitSetAvailability({
      set79: { status: 'error', url: null },
      soundcloud: { status: 'error', url: null },
    }, currentSourceUrl, lookupToken)
    return false
  }
}

// ── Source → tracklist routing ────────────────────────────────────────────────

async function handleSourceUrl(source, url, wvContents) {
  const tlPlugin = plugins.tracklistForSource(source.id)
  if (!tlPlugin) {
    log(`[lookup] no tracklist plugin for source=${source.id}`)
    return
  }

  const lookupToken = ++currentLookupToken
  log(`[lookup] START source=${source.id} url=${url} token=${lookupToken}`)

  statsSetReady = false
  currentStatsDjNames = []
  lastStatsTrackNum = null
  resetStatsPlayback({ flush: true })

  const videoId = extractVideoId(url)
  log(`[lookup] videoId=${videoId || '(none)'}`)
  currentTracks = []
  currentTracklistUrl = null
  currentTracklistProvider = null
  currentTracklistOptions = new Map()
  currentSourceId = source.id
  currentSourceMeta = null
  triedProviders = new Set()
  currentThumbnailUrl = thumbnailForSourceUrl(url)
  isYouTubePlayerMode = false
  isTracklistLookupPending = false
  mainWindow.webContents.send('wv-status', { type: 'loading', msg: 'Preparing player…' })

  log(`[lookup] calling source.getMeta url=${url}`)
  const meta = await source.getMeta(url)
  log(`[lookup] getMeta done title="${meta.title}" url="${meta.url}"`)
  if (lookupToken !== currentLookupToken) {
    log(`[lookup] token mismatch after getMeta (got ${currentLookupToken}, expected ${lookupToken}) — aborting`)
    return
  }

  currentSourceUrl = meta.url || url
  currentSourceMeta = meta
  currentSetTitle = meta.title || currentSourceUrl
  currentStatsDjNames = normalizeSetMetadata(meta).djNames
  if (!currentStatsDjNames.length) {
    currentStatsDjNames = storedDjNamesForStats(readStore(), currentSourceUrl)
  }
  statsSetReady = true
  registerCurrentStatsSet()
  currentThumbnailUrl = thumbnailForSourceUrl(currentSourceUrl) || currentThumbnailUrl
  log(`[lookup] meta resolved title="${currentSetTitle}" sourceUrl="${currentSourceUrl}"`)

  if (source.id === 'youtube' && videoId) {
    const playbackContents = playerWvContents || currentWvContents || wvContents
    log(`[lookup] youtube mode — playerWvContents=${!!playerWvContents} currentWvContents=${!!currentWvContents} wvContents=${!!wvContents} → using playbackContents=${!!playbackContents}`)
    isYouTubePlayerMode = true
    isTracklistLookupPending = true
    currentWvContents = playbackContents
    mainWindow.webContents.send('tracklist-loaded', {
      ...tracklistLoadedBase(null),
      tracklistUrl: null,
      isFallback: false,
    })
    emitSourceStatsWhenReady(meta, currentSourceUrl, lookupToken)
    const playerUrl = youtubePlayerUrl(videoId)
    log(`[lookup] loading player webview → ${playerUrl}`)
    mainWindow.webContents.send('wv-status', { type: 'player-loading' })
    playbackContents.loadURL(playerUrl)

    // The player owns the most trustworthy duration. Wait briefly for it so a
    // short clip never starts network lookups before we can apply the guard.
    await waitForSourceDuration(meta)
    if (lookupToken !== currentLookupToken) return
    if (isTooShortForAutomaticSetLookups(meta)) {
      isTracklistLookupPending = false
      log(`[lookup] skipping automatic provider and event lookups; ${meta.durationSeconds}s is below the 10-minute set threshold`)
      mainWindow.webContents.send('set-availability', {
        sourceUrl: currentSourceUrl,
        services: automaticLookupServices(currentSourceUrl, 'skipped'),
      })
      // Availability is emitted first: it stops the renderer from beginning
      // its own event lookup when this empty metadata payload arrives.
      mainWindow.webContents.send('set-metadata', {
        sourceUrl: currentSourceUrl,
        providerId: null,
        ...normalizeSetMetadata(null),
      })
      return
    }

    mainWindow.webContents.send('set-availability', {
      sourceUrl: currentSourceUrl,
      services: automaticLookupServices(currentSourceUrl),
    })
    mainWindow.webContents.send('set-metadata', {
      sourceUrl: currentSourceUrl,
      providerId: null,
      ...normalizeSetMetadata(null),
    })
  } else {
    log(`[lookup] no youtube videoId or non-youtube source — showing no-tracklist-prompt`)
    mainWindow.webContents.send('wv-status', { type: 'no-tracklist-prompt', url })
    return
  }

  await runAutomaticTracklistLookups(tlPlugin, meta, lookupToken)
}

// ── WebView wiring ────────────────────────────────────────────────────────────

function wireWebview(wvContents) {
  attachedWebviews.set(wvContents.id, wvContents)
  wvContents.once('destroyed', () => {
    attachedWebviews.delete(wvContents.id)
    if (playerWvContents === wvContents) playerWvContents = null
    if (browserWvContents === wvContents) browserWvContents = null
    if (currentWvContents === wvContents) currentWvContents = playerWvContents
  })
  wvContents.on('enter-html-full-screen', () => {
    wvContents.executeJavaScript(`
      (() => {
        if (document.fullscreenElement && document.exitFullscreen) {
          document.exitFullscreen().catch(() => {})
        }
      })()
    `).catch(() => {})
    if (mainWindow?.isFullScreen()) mainWindow.setFullScreen(false)
  })
  let pendingLookup = false
  const role = () => {
    if (wvContents === playerWvContents) return 'player'
    if (wvContents === browserWvContents) return 'browser'
    return null
  }

  wireYouTubePlayerUi(wvContents, () => role() === 'player', error => {
    log('[player-ui] frame styling failed:', error.message)
  })

  // Catch intercept signals from source plugins that use click interception
  wvContents.on('console-message', async ({ message }) => {
    if (role() === 'player') return
    for (const source of plugins.SOURCES) {
      const interceptedUrl = source.parseIntercept(message)
      if (!interceptedUrl) continue
      log(`[wv:browser] console-message intercept source=${source.id} url=${interceptedUrl} pendingLookup=${pendingLookup}`)
      if (pendingLookup) {
        log(`[wv:browser] skipping intercept — pendingLookup already true`)
        return
      }
      pendingLookup = true
      log(`[wv:browser] → handleSourceUrl source=${source.id}`)
      await handleSourceUrl(source, interceptedUrl, wvContents)
      log(`[wv:browser] ← handleSourceUrl returned source=${source.id}`)
      pendingLookup = false
      return
    }
  })

  // Real navigations — sources without an intercept script use this
  wvContents.on('will-navigate', async (event, url) => {
    if (role() === 'player') return
    const source = plugins.sourceForUrl(url)
    log(`[wv:${role() || 'unknown'}] will-navigate url=${url} source=${source?.id || '(none)'} hasIntercept=${!!source?.interceptScript} pendingLookup=${pendingLookup}`)
    if (!source || source.interceptScript) return
    if (pendingLookup) {
      log(`[wv:${role()}] skipping will-navigate — pendingLookup already true`)
      return
    }
    pendingLookup = true
    event.preventDefault()
    log(`[wv:${role()}] → handleSourceUrl via will-navigate source=${source.id}`)
    await handleSourceUrl(source, url, wvContents)
    log(`[wv:${role()}] ← handleSourceUrl returned via will-navigate source=${source.id}`)
    pendingLookup = false
  })

  // SPA pushState navigations (SoundCloud)
  wvContents.on('did-navigate-in-page', async (_event, url, isMainFrame) => {
    if (role() === 'player') return
    if (!isMainFrame) return
    const source = plugins.sourceForUrl(url)
    log(`[wv:${role() || 'unknown'}] did-navigate-in-page url=${url} source=${source?.id || '(none)'} pendingLookup=${pendingLookup}`)
    if (!source || source.interceptScript) return
    if (pendingLookup) {
      log(`[wv:${role()}] skipping did-navigate-in-page — pendingLookup already true`)
      return
    }
    pendingLookup = true
    log(`[wv:${role()}] → handleSourceUrl via did-navigate-in-page source=${source.id}`)
    await handleSourceUrl(source, url, wvContents)
    log(`[wv:${role()}] ← handleSourceUrl returned via did-navigate-in-page source=${source.id}`)
    pendingLookup = false
  })

  wvContents.on('did-finish-load', async () => {
    const url = wvContents.getURL()
    const r = role()
    log(`[wv:${r || 'unknown'}] did-finish-load url=${url} isYTPlayerMode=${isYouTubePlayerMode}`)

    wvContents.executeJavaScript(CONSENT_SCRIPT).catch(() => {})

    // Inject intercept scripts for matching source plugins
    for (const source of plugins.SOURCES) {
      if (source.interceptScript && source.shouldInjectOn(url)) {
        log(`[wv:${r || 'unknown'}] injecting intercept script for source=${source.id}`)
        wvContents.executeJavaScript(source.interceptScript).catch(() => {})
      }
    }

    if (r === 'browser') {
      log(`[wv:browser] did-finish-load → hide-overlay`)
      mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
      return
    }

    if (r === 'player' && isYouTubePlayerMode && isYouTubePlayerUrl(url)) {
      log(`[wv:player] did-finish-load — YT player URL confirmed → hide-overlay + startMonitoring`)
      mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
      startYouTubePlayerMonitoring(wvContents)
      return
    }

    log(`[wv:${r || 'unknown'}] did-finish-load — unexpected URL or mode, resetting state`)
    mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
    isTracklistLookupPending = false
    currentLookupToken++
    isYouTubePlayerMode = false
    stopMonitoring()
  })

  wvContents.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    const r = role()
    log(`[wv:${r || 'unknown'}] did-fail-load code=${code} desc="${desc}" url=${failedUrl} isMainFrame=${isMainFrame}`)
    if (r === 'browser') return
    if (isMainFrame) {
      log(`[wv:${r || 'unknown'}] did-fail-load mainFrame → resetting state`)
      mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
      isTracklistLookupPending = false
      currentLookupToken++
      isYouTubePlayerMode = false
      stopMonitoring()
    }
  })
}

// ── Updates ──────────────────────────────────────────────────────────────────

function httpsJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `DJ-Scrobbler/${app.getVersion()}`,
      },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsJson(res.headers.location).then(resolve, reject)
        res.resume()
        return
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error(`GitHub returned ${res.statusCode}`)
          error.statusCode = res.statusCode
          reject(error)
          return
        }
        try { resolve(JSON.parse(body)) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

function releaseFromGitHub(data) {
  return releaseFromGitHubPayload(data, {
    currentVersion: app.getVersion(),
    releasesUrl: UPDATE_RELEASES_URL,
  })
}

async function fetchTagMessage(tagName) {
  if (!tagName) return ''
  try {
    const ref = await httpsJson(`https://api.github.com/repos/${UPDATE_OWNER}/${UPDATE_REPO}/git/ref/tags/${encodeURIComponent(tagName)}`)
    if (ref?.object?.type === 'commit' && ref.object.url) {
      const commit = await httpsJson(ref.object.url)
      return (commit?.message || '').trim()
    }
    if (ref?.object?.type === 'tag' && ref.object.url) {
      const tag = await httpsJson(ref.object.url)
      if ((tag?.message || '').trim()) return tag.message.trim()
      if (tag?.object?.type === 'commit' && tag.object.url) {
        const commit = await httpsJson(tag.object.url)
        return (commit?.message || '').trim()
      }
    }
  } catch {}
  return ''
}

async function releaseFromGitHubWithChangelog(data) {
  const update = releaseFromGitHub(data)
  if (update.changelog) return update
  return { ...update, changelog: await fetchTagMessage(update.tagName) }
}

async function fetchGitHubReleaseByVersion(version) {
  const releases = await httpsJson(UPDATE_RELEASES_API_URL)
  if (!Array.isArray(releases)) return null
  const clean = cleanVersion(version)
  return releases.find(release =>
    !release.draft &&
    cleanVersion(release.tag_name || release.name) === clean
  ) || null
}

function releaseFromUpdateInfo(info) {
  return {
    ...releaseFromUpdateInfoPayload(info, {
      currentVersion: app.getVersion(),
      releasesUrl: UPDATE_RELEASES_URL,
      canInstall: app.isPackaged,
    }),
    currentVersion: app.getVersion(),
    canInstall: app.isPackaged,
  }
}

function updateSettings() {
  return readStore().settings || {}
}

function sendUpdateStatus(status, payload = {}) {
  updateState = mergeUpdateStatus(updateState, status, payload)
  mainWindow?.webContents.send('update-status', updateState)
  return updateState
}

function setUpdateNotificationsDisabled(disabled) {
  const store = readStore()
  if (!store.settings) store.settings = {}
  store.settings.updateNotificationsDisabled = !!disabled
  writeStore(store)
  return store.settings.updateNotificationsDisabled
}

async function checkForUpdates({ manual = false } = {}) {
  if (!manual && updateSettings().updateNotificationsDisabled) return updateState
  if (updateState.isChecking) return updateState

  updateCheckWasManual = manual
  updateState = {
    ...updateState,
    latestVersion: null,
    releaseName: null,
    changelog: '',
    progress: null,
  }
  sendUpdateStatus('checking', { manual })
  try {
    const releases = await httpsJson(UPDATE_RELEASES_API_URL)
    const latestPublishedRelease = Array.isArray(releases)
      ? releases.find(release => !release.draft)
      : null
    if (!latestPublishedRelease) {
      return sendUpdateStatus('not-available', {
        currentVersion: app.getVersion(),
        latestVersion: null,
        releaseName: null,
        releaseUrl: UPDATE_RELEASES_URL,
        publishedAt: null,
        changelog: 'No published GitHub Release was found yet. Once a release is published, DJ Scrobbler can compare it against this build.',
        canInstall: false,
        manual,
      })
    }
    const ghRelease = await releaseFromGitHubWithChangelog(latestPublishedRelease)
    if (compareVersions(ghRelease.latestVersion, app.getVersion()) <= 0) {
      return sendUpdateStatus('not-available', { ...ghRelease, manual })
    }

    if (MAC_SELF_UPDATE) {
      const asset = macUpdater.pickMacZipAsset(latestPublishedRelease.assets)
      macStagedAppPath = null
      sendUpdateStatus('available', {
        ...ghRelease,
        manual,
        downloadUrl: asset?.browser_download_url || null,
        assetName: asset?.name || null,
        canInstall: !!(asset && app.isPackaged && macUpdater.runningAppBundlePath()),
      })
      if (AUTO_UPDATE_TEST && updateState.canInstall) downloadUpdate().catch(() => {})
      return updateState
    }

    sendUpdateStatus('available', { ...ghRelease, manual })

    if (app.isPackaged) {
      autoUpdater.checkForUpdates().catch(err => {
        sendUpdateStatus('error', { error: err.message || 'Could not start the updater.' })
      })
    }
    return updateState
  } catch (e) {
    if (e.statusCode === 404) {
      return sendUpdateStatus('not-available', {
        currentVersion: app.getVersion(),
        latestVersion: null,
        releaseName: null,
        releaseUrl: UPDATE_RELEASES_URL,
        publishedAt: null,
        changelog: 'No public GitHub Release was found yet. Once a release is published, DJ Scrobbler can compare it against this build.',
        canInstall: false,
        manual,
      })
    }
    return sendUpdateStatus('error', { error: e.message || 'Could not check for updates.', manual })
  }
}

async function downloadUpdate() {
  if (!app.isPackaged) {
    shell.openExternal(updateState.releaseUrl || UPDATE_RELEASES_URL)
    return sendUpdateStatus('external-download', { canInstall: false })
  }
  if (MAC_SELF_UPDATE) return downloadMacUpdate()
  installAfterDownload = true
  sendUpdateStatus('downloading')
  try {
    await autoUpdater.downloadUpdate()
    return updateState
  } catch (e) {
    installAfterDownload = false
    return sendUpdateStatus('error', { error: e.message || 'Could not download the update.' })
  }
}

function macUpdatesDir() {
  return path.join(app.getPath('userData'), 'updates')
}

async function downloadMacUpdate() {
  if (!updateState.downloadUrl || !macUpdater.runningAppBundlePath()) {
    shell.openExternal(updateState.releaseUrl || UPDATE_RELEASES_URL)
    return sendUpdateStatus('external-download', { canInstall: false })
  }
  installAfterDownload = true
  sendUpdateStatus('downloading', { progress: 0 })
  try {
    macStagedAppPath = await macUpdater.stageUpdate({
      url: updateState.downloadUrl,
      version: updateState.latestVersion,
      dir: macUpdatesDir(),
      log,
      onProgress: pct => sendUpdateStatus('downloading', { progress: pct, manual: updateCheckWasManual }),
    })
    sendUpdateStatus('downloaded', { canInstall: true, progress: 100, manual: updateCheckWasManual })
    if (installAfterDownload) setTimeout(() => macQuitAndInstall(), 750)
    return updateState
  } catch (e) {
    installAfterDownload = false
    log('[update] mac update staging failed:', e.message)
    return sendUpdateStatus('error', { error: e.message || 'Could not download the update.' })
  }
}

function macQuitAndInstall() {
  const targetAppPath = macUpdater.runningAppBundlePath()
  if (!macStagedAppPath || !targetAppPath) return false
  macUpdater.installAndRelaunch({
    stagedAppPath: macStagedAppPath,
    targetAppPath,
    dir: macUpdatesDir(),
    log,
  })
  app.quit()
  return true
}

async function enrichUpdateChangelog(update) {
  if (!update.latestVersion || String(update.changelog || '').trim()) return update
  try {
    const release = await fetchGitHubReleaseByVersion(update.latestVersion)
    if (!release) return update
    return { ...update, ...(await releaseFromGitHubWithChangelog(release)), canInstall: update.canInstall }
  } catch {
    return update
  }
}

autoUpdater.on('update-available', async info => {
  const update = await enrichUpdateChangelog(releaseFromUpdateInfo(info))
  sendUpdateStatus('available', { ...update, manual: updateCheckWasManual })
})

autoUpdater.on('update-not-available', async info => {
  const update = await enrichUpdateChangelog(releaseFromUpdateInfo(info))
  sendUpdateStatus('not-available', { ...update, manual: updateCheckWasManual })
})

autoUpdater.on('download-progress', progress => {
  sendUpdateStatus('downloading', { progress: Math.round(progress.percent || 0), manual: updateCheckWasManual })
})

autoUpdater.on('update-downloaded', async info => {
  const update = await enrichUpdateChangelog(releaseFromUpdateInfo(info))
  sendUpdateStatus('downloaded', { ...update, canInstall: true, progress: 100, manual: updateCheckWasManual })
  if (installAfterDownload) {
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 750)
  }
})

autoUpdater.on('error', err => {
  installAfterDownload = false
  sendUpdateStatus('error', { error: err.message || 'Updater error.', manual: updateCheckWasManual })
})

// ── Menu bar ──────────────────────────────────────────────────────────────────

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    // macOS app menu
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { label: 'About DJ Scrobbler', click: () => mainWindow?.webContents.send('menu-open-about') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+\\',
          click: () => mainWindow?.webContents.send('menu-toggle-sidebar'),
        },
        { type: 'separator' },
        {
          label: 'Reload App',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.send('menu-reload'),
        },
        ...(DEVELOPER_MODE ? [
          {
            label: 'Open App DevTools',
            accelerator: 'CmdOrCtrl+Alt+I',
            click: () => { if (mainWindow) mainWindow.webContents.openDevTools({ mode: 'detach' }) },
          },
          {
            label: 'Open WebView DevTools',
            accelerator: 'CmdOrCtrl+Shift+I',
            click: () => { if (currentWvContents) currentWvContents.openDevTools() },
          },
        ] : []),
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
        ] : []),
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates...',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: () => checkForUpdates({ manual: true }),
        },
        {
          label: 'GitHub Releases',
          click: () => shell.openExternal(UPDATE_RELEASES_URL),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── Dock icon ─────────────────────────────────────────────────────────────────

function setDockIcon(theme) {
  if (process.platform !== 'darwin') return
  try {
    app.dock.setIcon(appIcon(theme))
  } catch (e) {
    appendLog(['[dock] failed to set icon:', e.message])
    console.error('[dock] failed to set icon:', e.message)
  }
}

function appIconPath(theme = 'neon-night') {
  const file = process.platform === 'win32' ? 'icon.ico' : 'icon.png'
  return path.join(__dirname, 'images', 'electron-icons', theme, file)
}

function appIcon(theme) {
  const image = nativeImage.createFromPath(appIconPath(theme))
  return image.isEmpty() ? nativeImage.createFromPath(appIconPath('neon-night')) : image
}

function setWindowIcon(theme) {
  if (!mainWindow || typeof mainWindow.setIcon !== 'function') return
  mainWindow.setIcon(appIcon(theme))
}

// ── Native title bar controls ─────────────────────────────────────────────────

function titleBarOptions(theme) {
  if (process.platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset' }
  }

  if (process.platform === 'win32') {
    const titleBar = THEME_TITLE_BAR[theme] || THEME_TITLE_BAR['neon-night']
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: titleBar.color,
        symbolColor: titleBar.symbolColor,
        height: WINDOWS_TITLE_BAR_OVERLAY_HEIGHT,
      },
    }
  }

  // Linux: use native frame so the window manager provides its own title bar and
  // close/min/max buttons. This works across all DEs (GNOME, KDE, XFCE, tiling WMs…)
  // without any platform-specific code. Custom frameless controls are tracked in ROADMAP.md.
  return { frame: true }
}

function setTitleBarTheme(theme) {
  if (process.platform !== 'win32' || !mainWindow || typeof mainWindow.setTitleBarOverlay !== 'function') return
  const titleBar = THEME_TITLE_BAR[theme] || THEME_TITLE_BAR['neon-night']
  mainWindow.setTitleBarOverlay({
    color: titleBar.color,
    symbolColor: titleBar.symbolColor,
    height: WINDOWS_TITLE_BAR_OVERLAY_HEIGHT,
  })
}

// ── Window bounds persistence ─────────────────────────────────────────────────

function persistBounds() {
  clearTimeout(saveBoundsTimer)
  saveBoundsTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed() || displayFullscreenBounds || mainWindow.isMinimized() || mainWindow.isMaximized() || mainWindow.isFullScreen()) return
    const store = readStore()
    if (!store.settings) store.settings = {}
    store.settings.windowBounds = mainWindow.getBounds()
    if (lfmSession) store.settings.lfmSession = lfmSession
    writeStore(store)
  }, 400)
}

function setDisplayFullscreen(enabled) {
  if (!mainWindow) return false
  if (enabled) {
    if (!displayFullscreenBounds) displayFullscreenBounds = mainWindow.getBounds()
    if (mainWindow.isMaximized()) mainWindow.unmaximize()
    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false)
    const display = screen.getDisplayMatching(mainWindow.getBounds())
    mainWindow.setResizable(false)
    mainWindow.setBounds(display.bounds, true)
    return true
  }
  if (!displayFullscreenBounds) return false
  const restoreBounds = displayFullscreenBounds
  displayFullscreenBounds = null
  mainWindow.setResizable(true)
  mainWindow.setBounds(restoreBounds, true)
  return true
}

// ── Window ────────────────────────────────────────────────────────────────────

// Per-theme topbar colors for the Windows native titlebar overlay (min/max/close buttons).
// Keeps the native controls visually integrated with the active theme.
const TITLEBAR_OVERLAY_THEMES = {
  'neon-night':  { color: '#0f1a30', symbolColor: '#6e88b8' },
  'signal-teal': { color: '#071f25', symbolColor: '#6ab4aa' },
  'sunset-deck': { color: '#190c1e', symbolColor: '#9b7e8e' },
}
function titleBarOverlayForTheme(theme) {
  const colors = TITLEBAR_OVERLAY_THEMES[theme] || TITLEBAR_OVERLAY_THEMES['neon-night']
  return { ...colors, height: 52 }   // 52 matches --topbar-h
}

function createWindow() {
  const store = readStore()
  const { windowBounds, theme = 'neon-night' } = store.settings || {}
  mainWindow = new BrowserWindow({
    width:  windowBounds?.width  || 1400,
    height: windowBounds?.height || 900,
    ...(windowBounds?.x != null ? { x: windowBounds.x, y: windowBounds.y } : {}),
    minWidth: 360,
    minHeight: 600,
    ...titleBarOptions(theme),
    autoHideMenuBar: process.platform !== 'darwin',
    fullscreenable: false,
    backgroundColor: '#0c1220',
    icon: appIcon(theme),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
    },
  })

  mainWindow.on('resize', persistBounds)
  mainWindow.on('move',   persistBounds)
  if (typeof mainWindow.setFullScreenable === 'function') mainWindow.setFullScreenable(false)

  if (process.env.DJ_DEBUG_LOAD_URL) {
    mainWindow.webContents.once('did-finish-load', () => {
      const url = process.env.DJ_DEBUG_LOAD_URL
      log(`[debug] startup load ${url}`)
      setTimeout(() => loadSourceUrl(url).catch(err => log('[debug] startup load failed', err?.stack || err?.message || err)), 250)
    })
  }
  mainWindow.loadFile('renderer/index.html')
  mainWindow.webContents.once('did-finish-load', () => {
    if (AUTO_UPDATE_TEST) {
      // manual:true bypasses the "update notifications disabled" setting
      setTimeout(() => checkForUpdates({ manual: true }), 1500)
    } else if (!updateSettings().updateNotificationsDisabled) {
      setTimeout(() => checkForUpdates({ manual: false }), 2500)
    }
  })
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(true))
  mainWindow.webContents.on('did-attach-webview', (_event, wvContents) => wireWebview(wvContents))

  // Spotify-style close: hide instead of quit — unless the user is actually quitting
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin' && !isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const store = readStore()
  if (store.settings?.lfmSession) {
    lfmSession = store.settings.lfmSession
    lfmStatus  = 'ok'
  }

  const theme = store.settings?.theme || 'neon-night'
  setDockIcon(theme)
  buildMenu()
  createWindow()

  // Clicking the dock icon shows the window if it's hidden
  app.on('activate', () => {
    if (mainWindow) mainWindow.show()
    else createWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  clearTimeout(saveBoundsTimer) // prevent in-flight timer from firing on a destroyed window
  persistStatsNow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('store-get',  () => readStoreForRenderer())
ipcMain.handle('stats-get',  () => readStats())
ipcMain.handle('store-set', (_event, data) => {
  const existing = readStore()
  const next = { ...data }
  if (lfmSession) {
    if (!next.settings) next.settings = {}
    next.settings.lfmSession = lfmSession
  }
  if (existing.tracklistCache) next.tracklistCache = existing.tracklistCache
  if (existing.tracklistPreferences) next.tracklistPreferences = existing.tracklistPreferences
  if (existing.artworkCache) next.artworkCache = existing.artworkCache
  if (existing.eventLookupCache) next.eventLookupCache = existing.eventLookupCache
  writeStore(next)
  syncCurrentStatsMetadataFromStore(next)
})

function validatedEventLocation(value, { allowMissingCountryCode = false } = {}) {
  const city = String(value?.city || '').trim().slice(0, 100)
  const country = String(value?.country || '').trim().slice(0, 100)
  const countryCode = String(value?.countryCode || '').trim().toUpperCase()
  if (!city || !country || (!allowMissingCountryCode && !/^[A-Z]{2}$/.test(countryCode)) || (countryCode && !/^[A-Z]{2}$/.test(countryCode))) {
    throw new Error('Choose a city and country first.')
  }
  return { city, country, countryCode }
}

ipcMain.handle('event-location-resolve', async (_event, value) => {
  const location = validatedEventLocation(value, { allowMissingCountryCode: true })
  const resolved = await plugins.resolveEventLocation(location)
  if (!resolved) throw new Error(`Resident Advisor does not list ${location.city}, ${location.country} as an exact city.`)
  return resolved
})

ipcMain.handle('event-lookup', async (_event, value) => {
  const sourceUrl = String(value?.sourceUrl || '')
  const requestId = Number(value?.requestId) || 0
  const eventSettings = readStore().settings || {}
  if (eventSettings.eventSuggestionsEnabled === false) {
    return { sourceUrl, requestId, location: null, results: [] }
  }
  const location = validatedEventLocation(eventSettings.eventLocation)
  if (!sourceUrl || sourceUrl !== currentSourceUrl) return { sourceUrl, requestId, location, results: [] }
  const djNames = Array.isArray(value?.djNames)
    ? value.djNames.map(name => String(name).trim().slice(0, 120)).filter(Boolean).slice(0, 8)
    : []
  if (!djNames.length) return { sourceUrl, requestId, location, results: [] }
  const cachedResults = getCachedEventLookup(location, djNames)
  if (cachedResults) {
    log(`[cache] hit event lookup city=${location.city} artists=${djNames.length}`)
    return { sourceUrl, requestId, location, results: cachedResults }
  }
  const results = await plugins.lookupNextEvents({
    djNames,
    location,
    onError(source, artist, error) {
      log(`[events] ${source.name} failed artist="${artist}": ${error?.message || error}`)
    },
    onProgress(progress) {
      if (!_event.sender.isDestroyed() && sourceUrl === currentSourceUrl) {
        _event.sender.send('event-lookup-progress', { sourceUrl, requestId, ...progress })
      }
    },
  })
  writeCachedEventLookup(location, djNames, results)
  return { sourceUrl, requestId, location, results }
})

ipcMain.handle('register-webview-role', (_event, id, role) => {
  log(`[wv] register-webview-role id=${id} role=${role} known=${attachedWebviews.has(id)} pendingSourceUrl=${pendingSourceUrl || '(none)'}`)
  const wvContents = attachedWebviews.get(id)
  if (!wvContents) {
    log(`[wv] register-webview-role FAILED — id=${id} not in attachedWebviews (size=${attachedWebviews.size})`)
    return false
  }
  if (role === 'player') {
    playerWvContents = wvContents
    currentWvContents = wvContents
    log(`[wv] player webview registered id=${id}`)
    if (pendingSourceUrl) {
      const url = pendingSourceUrl
      pendingSourceUrl = null
      log(`[wv] flushing pendingSourceUrl=${url}`)
      setImmediate(() => loadSourceUrl(url, wvContents).catch(err => log('[lookup] queued source failed', err?.message || err)))
    }
    return true
  }
  if (role === 'browser') {
    browserWvContents = wvContents
    log(`[wv] browser webview registered id=${id}`)
    return true
  }
  return false
})

ipcMain.handle('open-devtools', () => {
  if (!DEVELOPER_MODE) return
  if (currentWvContents) currentWvContents.openDevTools()
})

ipcMain.handle('player-toggle', async () => {
  if (!currentWvContents) return
  const isPlaying = await currentWvContents.executeJavaScript(YT_STATE_SCRIPT).catch(() => null)
  if (isPlaying === null) return
  const script = isPlaying ? YT_PAUSE_SCRIPT : YT_PLAY_SCRIPT
  await currentWvContents.executeJavaScript(script).catch(() => {})
})

ipcMain.handle('player-volume-get', async () => {
  if (!currentWvContents) return null
  return currentWvContents.executeJavaScript(YT_VOLUME_STATE_SCRIPT).catch(() => null)
})

ipcMain.handle('player-volume-set', async (_event, value) => {
  if (!currentWvContents) return null
  const volume = Math.max(0, Math.min(100, Math.round(Number(value) || 0)))
  return currentWvContents.executeJavaScript(`
    (() => {
      const p = window.ytPlayer
      if (!p || typeof p.setVolume !== 'function') return null
      p.setVolume(${volume})
      if (${volume} === 0 && typeof p.mute === 'function') p.mute()
      if (${volume} > 0 && typeof p.unMute === 'function') p.unMute()
      return {
        volume: ${volume},
        muted: ${volume} === 0,
      }
    })()
  `).catch(() => null)
})

ipcMain.handle('lfm-connect',    async () => lfmConnect())
ipcMain.handle('lfm-disconnect', ()      => lfmDisconnect())
ipcMain.handle('lfm-session',    ()      => lfmSession)
ipcMain.handle('lfm-status-get', ()      => lfmStatus)

// Send source plugin metadata to renderer (for search placeholder etc.)
ipcMain.handle('get-sources', () =>
  plugins.SOURCES.map(s => ({ id: s.id, name: s.name, searchPlaceholder: s.searchPlaceholder, searchQueryUrl: null }))
)

ipcMain.handle('get-version', () => app.getVersion())
ipcMain.handle('get-platform', () => process.platform)

ipcMain.handle('tracklist-cache-clear', () => {
  artworkCacheGeneration++
  const store = readStore()
  const tracklistCount = Object.keys(store.tracklistCache || {}).length
  const artworkCount = Object.keys(store.artworkCache || {}).length
  store.tracklistCache = {}
  store.tracklistPreferences = {}
  store.artworkCache = {}
  writeStore(store)
  log(`[cache] cleared tracklists=${tracklistCount} artwork=${artworkCount}`)
  return tracklistCount + artworkCount
})
ipcMain.handle('tracklist-try-provider', (_event, providerId) => tryTracklistProvider(providerId))
ipcMain.handle('tracklist-select-provider', (_event, providerId) => selectTracklistProvider(providerId))
ipcMain.handle('tracklist-refresh', () => refreshTracklistLookups())
ipcMain.handle('set-metadata-auto', () => autoSetMetadata())
ipcMain.handle('updates-check', () => checkForUpdates({ manual: true }))
ipcMain.handle('updates-download', () => downloadUpdate())
ipcMain.handle('updates-install', () => {
  if (app.isPackaged && updateState.status === 'downloaded') {
    if (MAC_SELF_UPDATE) return macQuitAndInstall()
    autoUpdater.quitAndInstall(false, true)
    return true
  }
  shell.openExternal(updateState.releaseUrl || UPDATE_RELEASES_URL)
  return false
})
ipcMain.handle('updates-notifications-disabled-set', (_event, disabled) => setUpdateNotificationsDisabled(disabled))
ipcMain.handle('get-recent-logs', () => recentLogs.join('\n'))
ipcMain.handle('app-restart', () => {
  log('[app] restart requested by renderer')
  app.relaunch()
  app.exit(0)
})
ipcMain.handle('is-developer', () => DEVELOPER_MODE)
ipcMain.handle('set-display-fullscreen', (_event, enabled) => setDisplayFullscreen(!!enabled))
ipcMain.handle('window-drag-start', (_event, point) => {
  if (!mainWindow || displayFullscreenBounds) return false
  windowDragStart = { point, bounds: mainWindow.getBounds() }
  return true
})
ipcMain.handle('window-drag-move', (_event, point) => {
  if (!mainWindow || !windowDragStart || displayFullscreenBounds) return false
  const dx = Math.round(point.screenX - windowDragStart.point.screenX)
  const dy = Math.round(point.screenY - windowDragStart.point.screenY)
  mainWindow.setPosition(windowDragStart.bounds.x + dx, windowDragStart.bounds.y + dy, false)
  return true
})
ipcMain.handle('window-drag-end', () => {
  windowDragStart = null
  return true
})

// Hosts the app itself links to. Tracklist providers add their own — every
// provider sends the user to its site (the tracklist page, a contribute form),
// so deriving the list from the registry keeps a new provider's links from
// being silently dropped here.
const APP_EXTERNAL_HOSTS = ['djscrobbler.com', 'github.com', 'cast.ro', 'youtube.com', 'youtu.be', 'soundcloud.com']

function allowedExternalHosts() {
  return [...new Set([
    ...APP_EXTERNAL_HOSTS,
    ...plugins.TRACKLISTS.map(p => p.externalHost).filter(Boolean),
    ...plugins.EVENTS.map(p => p.externalHost).filter(Boolean),
  ])]
}

ipcMain.handle('open-external', (_event, url) => {
  try {
    const { hostname, protocol } = new URL(url)
    if (protocol === 'mailto:') return shell.openExternal(url)
    const allowed = allowedExternalHosts()
    if (allowed.some(d => hostname === d || hostname.endsWith('.' + d))) return shell.openExternal(url)
    log(`[external] blocked ${hostname} — not in [${allowed.join(', ')}]`)
  } catch {
    log(`[external] blocked unparseable url: ${url}`)
  }
})

ipcMain.handle('player-seek', (_event, seconds) => playerSeek(seconds))
ipcMain.handle('player-goto-track', (_event, track) => playerSeek(track?.cueSeconds ?? track))
ipcMain.handle('fallback-seek', (_event, seconds) => playerSeek(seconds))
ipcMain.handle('tl-seek', (_event, seconds) => playerSeek(seconds))

async function loadSourceUrl(url, playbackContents = playerWvContents || currentWvContents) {
  log(`[lookup] loadSourceUrl url=${url} hasPlayback=${!!playbackContents} playerWvContents=${!!playerWvContents} currentWvContents=${!!currentWvContents}`)
  const source = plugins.sourceForUrl(url)
  if (!source) {
    log(`[lookup] no source plugin for ${url}`)
    return false
  }
  log(`[lookup] matched source plugin id=${source.id}`)
  if (!playbackContents) {
    pendingSourceUrl = url
    log(`[lookup] queued source until player webview is ready: ${url}`)
    return true
  }
  log(`[lookup] calling handleSourceUrl source=${source.id}`)
  try {
    await handleSourceUrl(source, url, playbackContents)
  } catch (err) {
    log('[lookup] loadSourceUrl failed', err?.stack || err?.message || err)
    throw err
  }
  log(`[lookup] handleSourceUrl returned cleanly for url=${url}`)
  return true
}

// Re-run the full source → tracklist lookup for a URL (used when reopening a
// YouTube set that was previously saved as a fallback — gives it another chance
// to find a tracklist, while still falling back gracefully if none exists yet).
ipcMain.handle('load-source-url', async (_event, url) => {
  await loadSourceUrl(url)
})

// Theme change — update dock icon and persist.
ipcMain.handle('set-theme', (_event, theme) => {
  setDockIcon(theme)
  setWindowIcon(theme)
  setTitleBarTheme(theme)
  const store = readStore()
  if (!store.settings) store.settings = {}
  store.settings.theme = theme
  if (lfmSession) store.settings.lfmSession = lfmSession
  writeStore(store)
})
