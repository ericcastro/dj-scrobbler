const { app, BrowserWindow, ipcMain, shell, Menu, nativeImage, nativeTheme, screen } = require('electron')
const path   = require('path')
const https  = require('https')
const crypto = require('crypto')
const fs     = require('fs')
const plugins  = require('./plugins')

// Must be set before app is ready — controls menu bar name and dock tooltip
app.name = 'DJ Scrobbler'

// Force dark color scheme for all webviews — YouTube and other sources will
// respect prefers-color-scheme: dark and render in their native dark mode.
nativeTheme.themeSource = 'dark'

// ── Verbose logging ───────────────────────────────────────────────────────────
// Enable with:  DJ_VERBOSE=1 npm start
const VERBOSE = !!process.env.DJ_VERBOSE
const DEBUG_LOG_PATH = process.env.DJ_VERBOSE ? '/private/tmp/djscrobbler-debug.log' : null
const recentLogs = []
function formatLogArg(arg) {
  if (typeof arg === 'string') return arg
  try { return JSON.stringify(arg) } catch { return String(arg) }
}
function appendLog(args) {
  const line = `[${new Date().toISOString()}] ${args.map(formatLogArg).join(' ')}`
  recentLogs.push(line)
  if (recentLogs.length > 80) recentLogs.shift()
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
const MAX_TRACKLIST_CACHE_ENTRIES = 200

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
  fs.writeFileSync(getStorePath(), JSON.stringify(data, null, 2))
}

function tracklistCacheKey(providerId, sourceUrl) {
  return crypto.createHash('sha1').update(`${providerId}:${sourceUrl}`).digest('hex')
}

function isUsableCachedTracklist(entry, now = Date.now()) {
  return entry &&
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

function writeCachedTracklist({ sourceUrl, providerId, tracklistUrl, title, thumbnailUrl, tracks }) {
  if (!sourceUrl || !providerId || !tracklistUrl || !Array.isArray(tracks) || tracks.length === 0) return

  const store = readStore()
  if (!store.tracklistCache || typeof store.tracklistCache !== 'object') store.tracklistCache = {}

  const now = Date.now()
  const key = tracklistCacheKey(providerId, sourceUrl)
  store.tracklistCache[key] = {
    version: 1,
    sourceUrl,
    providerId,
    tracklistUrl,
    title: title || null,
    thumbnailUrl: thumbnailUrl || null,
    tracks,
    cachedAt: now,
    expiresAt: now + TRACKLIST_CACHE_TTL_MS,
  }
  pruneTracklistCache(store.tracklistCache, now)
  writeStore(store)
  log(`[cache] stored tracklist tracks=${tracks.length} provider=${providerId} source=${sourceUrl}`)
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
let lastNowPlaying       = null
let lastTrackData        = null
let trackStartedAt       = null
let currentSetTitle      = null   // DJ set title used as album in Last.fm scrobbles
let currentThumbnailUrl  = null   // YouTube thumbnail for history/favorites
let currentSourceUrl     = null   // Canonical source URL for history/favorites
let currentTracklistUrl  = null
let currentTracklistProvider = null
let currentTracks        = []
let isYouTubePlayerMode  = false
let isTracklistLookupPending = false
let lastPlayerPlaying    = null
let lastPlaybackTickAt   = null
let currentTrackPlayedMs = 0
let activeTrackKey       = null
let currentLookupToken   = 0

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

function isYouTubePlayerUrl(url) {
  try {
    const u = new URL(url)
    const hostOk = u.hostname === 'djscrobbler.com' || u.hostname === 'www.djscrobbler.com'
    const pathOk = u.pathname.replace(/\/$/, '') === '/embed/youtube'
    return hostOk && pathOk
  } catch {
    return false
  }
}

function thumbnailForSourceUrl(sourceUrl) {
  if (!sourceUrl) return null
  try {
    const u = new URL(sourceUrl)
    let videoId = null
    if (u.hostname.includes('youtube.com')) videoId = u.searchParams.get('v')
    else if (u.hostname === 'youtu.be')     videoId = u.pathname.slice(1).split('?')[0]
    if (videoId) return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
  } catch {}
  return null
}

function resetTimelineState() {
  lastNowPlaying       = null
  lastTrackData        = null
  trackStartedAt       = null
  lastPlayerPlaying    = null
  lastPlaybackTickAt   = null
  currentTrackPlayedMs = 0
  activeTrackKey       = null
}

function scrobbleLastTrackIfReady() {
  if (!lastTrackData || lastTrackData.isId || !trackStartedAt) return
  if (currentTrackPlayedMs < 30000) return
  lfmScrobble(lastTrackData.artist, lastTrackData.title, trackStartedAt, currentSetTitle)
}

function stopMonitoring({ finalize = true } = {}) {
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null }
  if (finalize) scrobbleLastTrackIfReady()
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
  return tracks.map((track, index) => normalizeTrack(track, index, providerId))
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

function updatePlayAccumulator(now) {
  if (lastPlaybackTickAt && lastPlayerPlaying === true && lastTrackData) {
    currentTrackPlayedMs += Math.max(0, now - lastPlaybackTickAt)
  }
  lastPlaybackTickAt = now
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

function emitTimelineTrack(track, poll) {
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
    cueSeconds: track.cueSeconds,
    currentTime: poll.currentTime,
    duration: poll.duration,
  }

  const trackChanged = key !== activeTrackKey
  const playChanged = poll.isPlaying !== lastPlayerPlaying

  if (!trackChanged && !playChanged && data.raw === lastNowPlaying) return

  if (trackChanged) {
    scrobbleLastTrackIfReady()
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
  updatePlayAccumulator(now)

  if (poll.duration > 0) {
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

  emitTimelineTrack(activeTrack, poll)
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
  setTimeout(() => {
    wvContents.executeJavaScript(YT_PLAY_SCRIPT).catch(() => {})
    const settings = readStore().settings || {}
    const volume = Math.max(0, Math.min(100, Math.round(Number(settings.playerVolume ?? 80) || 0)))
    const muted = !!settings.playerMuted || volume === 0
    wvContents.executeJavaScript(`
      (() => {
        const p = window.ytPlayer
        if (!p || typeof p.setVolume !== 'function') return
        p.setVolume(${volume})
        if (${muted} && typeof p.mute === 'function') p.mute()
        if (!${muted} && typeof p.unMute === 'function') p.unMute()
      })()
    `).catch(() => {})
  }, 1000)
  monitorInterval = setInterval(async () => {
    try {
      const poll = await wvContents.executeJavaScript(YT_POLL_SCRIPT)
      if (poll) handlePlaybackPoll(poll)
    } catch {}
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

function extractTracklistInBackground(tlPlugin, url) {
  return new Promise((resolve) => {
    log(`[extract] background load ${url}`)
    const win = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
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
      finish({ title: null, tracks: [] })
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
        log(`[extract] tracks=${tracks.length} title="${title || ''}"`)
        clearTimeout(timeout)
        finish({ title, tracks })
      } catch (err) {
        log('[extract] failed', err?.message || err)
        clearTimeout(timeout)
        finish({ title: null, tracks: [] })
      }
    })

    wc.on('did-fail-load', (_event, code, desc, failedUrl, isMainFrame) => {
      if (isMainFrame) {
        log(`[extract] did-fail-load code=${code} desc="${desc}" url=${failedUrl}`)
        clearTimeout(timeout)
        finish({ title: null, tracks: [] })
      }
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

  const scored = results
    .map(r => ({ ...r, score: plugins.titleSimilarity(meta, r.title) }))
    .sort((a, b) => b.score - a.score)

  log(`[${tlPlugin.id}] ${scored.length} results for: "${meta.title}"`)
  scored.forEach((r, i) => log(`  [${i + 1}] ${r.score}%  ${r.title}  →  ${r.url}`))

  return scored[0]?.score > 0 ? scored[0] : null
}

function tracklistLookupErrorPayload(err, tlPlugin) {
  if (!err) return null
  return {
    code: err.code || 'tracklist_lookup_failed',
    message: err.message || 'Tracklist lookup failed.',
    providerId: err.providerId || tlPlugin?.id || null,
  }
}

// ── Source → tracklist routing ────────────────────────────────────────────────

async function handleSourceUrl(source, url, wvContents) {
  const tlPlugin = plugins.tracklistForSource(source.id)
  if (!tlPlugin) return

  const lookupToken = ++currentLookupToken
  log(`[lookup] source=${source.id} url=${url}`)

  const videoId = extractVideoId(url)
  currentTracks = []
  currentTracklistUrl = null
  currentTracklistProvider = null
  currentThumbnailUrl = thumbnailForSourceUrl(url)
  isYouTubePlayerMode = false
  isTracklistLookupPending = false
  mainWindow.webContents.send('wv-status', { type: 'loading', msg: 'Preparing player…' })

  const meta = await source.getMeta(url)
  if (lookupToken !== currentLookupToken) return

  currentSourceUrl = meta.url || url
  currentSetTitle = meta.title || currentSourceUrl
  currentThumbnailUrl = thumbnailForSourceUrl(currentSourceUrl) || currentThumbnailUrl
  log(`[lookup] meta title="${meta.title}"`)

  if (source.id === 'youtube' && videoId) {
    const playbackContents = playerWvContents || currentWvContents || wvContents
    isYouTubePlayerMode = true
    isTracklistLookupPending = true
    currentWvContents = playbackContents
    mainWindow.webContents.send('tracklist-loaded', {
      url: currentSourceUrl,
      sourceUrl: currentSourceUrl,
      title: currentSetTitle,
      thumbnailUrl: currentThumbnailUrl,
      providerId: null,
      tracklistUrl: null,
      isFallback: false,
    })
    playbackContents.loadURL(youtubePlayerUrl(videoId))
  } else {
    mainWindow.webContents.send('wv-status', { type: 'no-tracklist-prompt', url })
    return
  }

  const cached = getCachedTracklist(tlPlugin.id, currentSourceUrl)
  if (cached) {
    log(`[cache] hit provider=${cached.providerId} source=${currentSourceUrl} tracks=${cached.tracks.length}`)
    isTracklistLookupPending = false
    currentTracklistUrl = cached.tracklistUrl
    currentTracklistProvider = cached.providerId
    currentSetTitle = cached.title || currentSetTitle
    currentTracks = normalizeTracks(cached.tracks, cached.providerId)

    mainWindow.webContents.send('tracklist-loaded', {
      url: currentSourceUrl,
      sourceUrl: currentSourceUrl,
      title: currentSetTitle,
      thumbnailUrl: currentThumbnailUrl,
      providerId: cached.providerId,
      tracklistUrl: cached.tracklistUrl,
      isFallback: false,
      fromCache: true,
    })
    mainWindow.webContents.send('tracklist-data', {
      providerId: cached.providerId,
      url: cached.tracklistUrl,
      tracks: currentTracks,
      fromCache: true,
    })
    mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
    return
  }

  mainWindow.webContents.send('wv-status', { type: 'loading', msg: `Searching ${tlPlugin.name}…` })

  let best
  try {
    best = await findBestTracklist(tlPlugin, meta)
  } catch (err) {
    const lookupError = tracklistLookupErrorPayload(err, tlPlugin)
    log(`[lookup] provider failed code=${lookupError.code} provider=${lookupError.providerId}: ${lookupError.message}`)
    isTracklistLookupPending = false
    mainWindow.webContents.send('tracklist-loaded', {
      url: currentSourceUrl,
      sourceUrl: currentSourceUrl,
      title: currentSetTitle,
      thumbnailUrl: currentThumbnailUrl,
      providerId: tlPlugin.id,
      tracklistUrl: null,
      isFallback: true,
      lookupError,
    })
    mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
    return
  }
  if (lookupToken !== currentLookupToken) return

  if (!best) {
    log('[lookup] → no tracklist found')
    isTracklistLookupPending = false
    mainWindow.webContents.send('tracklist-loaded', {
      url: currentSourceUrl,
      sourceUrl: currentSourceUrl,
      title: currentSetTitle,
      thumbnailUrl: currentThumbnailUrl,
      providerId: null,
      tracklistUrl: null,
      isFallback: true,
    })
    mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
    return
  }

  log(`[lookup] → extracting tracklist metadata: ${best.url}`)
  mainWindow.webContents.send('wv-status', { type: 'loading', msg: 'Loading tracklist…' })
  currentTracklistUrl = best.url
  currentTracklistProvider = tlPlugin.id
  const extracted = await extractTracklistInBackground(tlPlugin, best.url)
  if (lookupToken !== currentLookupToken) return

  isTracklistLookupPending = false
  const title = currentSetTitle || extracted.title || best.title || currentSourceUrl
  currentSetTitle = title
  currentTracks = normalizeTracks(extracted.tracks, tlPlugin.id)
  writeCachedTracklist({
    sourceUrl: currentSourceUrl,
    providerId: tlPlugin.id,
    tracklistUrl: best.url,
    title,
    thumbnailUrl: currentThumbnailUrl,
    tracks: currentTracks,
  })

  mainWindow.webContents.send('tracklist-loaded', {
    url: currentSourceUrl,
    sourceUrl: currentSourceUrl,
    title,
    thumbnailUrl: currentThumbnailUrl,
    providerId: tlPlugin.id,
    tracklistUrl: best.url,
    isFallback: currentTracks.length === 0,
  })

  if (currentTracks.length) {
    mainWindow.webContents.send('tracklist-data', {
      providerId: tlPlugin.id,
      url: best.url,
      tracks: currentTracks,
    })
  }
  mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
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

  // Catch intercept signals from source plugins that use click interception
  wvContents.on('console-message', async (_e, _level, message) => {
    if (role() === 'player') return
    for (const source of plugins.SOURCES) {
      const interceptedUrl = source.parseIntercept(message)
      if (!interceptedUrl) continue
      if (pendingLookup) return
      pendingLookup = true
      await handleSourceUrl(source, interceptedUrl, wvContents)
      pendingLookup = false
      return
    }
  })

  // Real navigations — sources without an intercept script use this
  wvContents.on('will-navigate', async (event, url) => {
    if (role() === 'player') return
    const source = plugins.sourceForUrl(url)
    if (!source || source.interceptScript) return
    if (pendingLookup) return
    pendingLookup = true
    event.preventDefault()
    await handleSourceUrl(source, url, wvContents)
    pendingLookup = false
  })

  // SPA pushState navigations (SoundCloud)
  wvContents.on('did-navigate-in-page', async (_event, url, isMainFrame) => {
    if (role() === 'player') return
    if (!isMainFrame) return
    const source = plugins.sourceForUrl(url)
    if (!source || source.interceptScript) return
    if (pendingLookup) return
    pendingLookup = true
    await handleSourceUrl(source, url, wvContents)
    pendingLookup = false
  })

  wvContents.on('did-finish-load', async () => {
    const url = wvContents.getURL()

    wvContents.executeJavaScript(CONSENT_SCRIPT).catch(() => {})

    // Inject intercept scripts for matching source plugins
    for (const source of plugins.SOURCES) {
      if (source.interceptScript && source.shouldInjectOn(url)) {
        wvContents.executeJavaScript(source.interceptScript).catch(() => {})
      }
    }

    if (role() === 'browser') {
      mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
      return
    }

    if (role() === 'player' && isYouTubePlayerMode && isYouTubePlayerUrl(url)) {
      if (!isTracklistLookupPending) {
        mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
      }
      startYouTubePlayerMonitoring(wvContents)
      return
    }

    mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
    isTracklistLookupPending = false
    currentLookupToken++
    isYouTubePlayerMode = false
    stopMonitoring()
  })

  wvContents.on('did-fail-load', (_e, _code, _desc, _failedUrl, isMainFrame) => {
    if (role() === 'browser') return
    if (isMainFrame) {
      mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
      isTracklistLookupPending = false
      currentLookupToken++
      isYouTubePlayerMode = false
      stopMonitoring()
    }
  })
}

// ── Menu bar ──────────────────────────────────────────────────────────────────

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    // macOS app menu
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
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
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ── Dock icon ─────────────────────────────────────────────────────────────────

function setDockIcon(theme) {
  if (process.platform !== 'darwin') return
  const iconPath = path.join(__dirname, 'images', 'electron-icons', theme, 'icon.png')
  try {
    app.dock.setIcon(nativeImage.createFromPath(iconPath))
  } catch (e) {
    appendLog(['[dock] failed to set icon:', e.message])
    console.error('[dock] failed to set icon:', e.message)
  }
}

// ── Window bounds persistence ─────────────────────────────────────────────────

function persistBounds() {
  clearTimeout(saveBoundsTimer)
  saveBoundsTimer = setTimeout(() => {
    if (!mainWindow || displayFullscreenBounds || mainWindow.isMinimized() || mainWindow.isMaximized() || mainWindow.isFullScreen()) return
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

function createWindow() {
  const { windowBounds } = readStore().settings || {}
  mainWindow = new BrowserWindow({
    width:  windowBounds?.width  || 1400,
    height: windowBounds?.height || 900,
    ...(windowBounds?.x != null ? { x: windowBounds.x, y: windowBounds.y } : {}),
    minWidth: 360,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    fullscreenable: false,
    backgroundColor: '#0c1220',
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

app.on('before-quit', () => { isQuitting = true })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('store-get', () => readStore())
ipcMain.handle('store-set', (_event, data) => {
  const existing = readStore()
  const next = { ...data }
  if (lfmSession) {
    if (!next.settings) next.settings = {}
    next.settings.lfmSession = lfmSession
  }
  if (existing.tracklistCache) next.tracklistCache = existing.tracklistCache
  writeStore(next)
})

ipcMain.handle('register-webview-role', (_event, id, role) => {
  const wvContents = attachedWebviews.get(id)
  if (!wvContents) return false
  if (role === 'player') {
    playerWvContents = wvContents
    currentWvContents = wvContents
    if (pendingSourceUrl) {
      const url = pendingSourceUrl
      pendingSourceUrl = null
      setImmediate(() => loadSourceUrl(url, wvContents).catch(err => log('[lookup] queued source failed', err?.message || err)))
    }
    return true
  }
  if (role === 'browser') {
    browserWvContents = wvContents
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
        volume: typeof p.getVolume === 'function' ? p.getVolume() : ${volume},
        muted: typeof p.isMuted === 'function' ? p.isMuted() : false,
      }
    })()
  `).catch(() => null)
})

ipcMain.handle('player-mute-toggle', async () => {
  if (!currentWvContents) return null
  return currentWvContents.executeJavaScript(`
    (() => {
      const p = window.ytPlayer
      if (!p || typeof p.isMuted !== 'function') return null
      if (p.isMuted()) {
        if (typeof p.unMute === 'function') p.unMute()
      } else if (typeof p.mute === 'function') {
        p.mute()
      }
      return {
        volume: typeof p.getVolume === 'function' ? p.getVolume() : 0,
        muted: typeof p.isMuted === 'function' ? p.isMuted() : false,
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
ipcMain.handle('get-recent-logs', () => recentLogs.slice(-30).join('\n'))
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

ipcMain.handle('open-external', (_event, url) => {
  const allowed = ['djscrobbler.com', 'github.com']
  try {
    const { hostname, protocol } = new URL(url)
    if (protocol === 'mailto:') shell.openExternal(url)
    else if (allowed.some(d => hostname === d || hostname.endsWith('.' + d))) shell.openExternal(url)
  } catch {}
})

ipcMain.handle('player-seek', (_event, seconds) => playerSeek(seconds))
ipcMain.handle('player-goto-track', (_event, track) => playerSeek(track?.cueSeconds ?? track))
ipcMain.handle('fallback-seek', (_event, seconds) => playerSeek(seconds))
ipcMain.handle('tl-seek', (_event, seconds) => playerSeek(seconds))

async function loadSourceUrl(url, playbackContents = playerWvContents || currentWvContents) {
  log(`[lookup] loadSourceUrl url=${url} hasPlayback=${!!playbackContents}`)
  const source = plugins.sourceForUrl(url)
  if (!source) {
    log(`[lookup] no source plugin for ${url}`)
    return false
  }
  if (!playbackContents) {
    pendingSourceUrl = url
    log(`[lookup] queued source until player webview is ready: ${url}`)
    return true
  }
  try {
    await handleSourceUrl(source, url, playbackContents)
  } catch (err) {
    log('[lookup] loadSourceUrl failed', err?.stack || err?.message || err)
    throw err
  }
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
  const store = readStore()
  if (!store.settings) store.settings = {}
  store.settings.theme = theme
  if (lfmSession) store.settings.lfmSession = lfmSession
  writeStore(store)
})
