const { app, BrowserWindow, ipcMain, shell, Menu, nativeImage, nativeTheme } = require('electron')
const path   = require('path')
const https  = require('https')
const crypto = require('crypto')
const fs     = require('fs')
const plugins  = require('./plugins')
const overlay  = require('./plugins/overlay')

// Must be set before app is ready — controls menu bar name and dock tooltip
app.name = 'DJ Scrobbler'

// Force dark color scheme for all webviews — YouTube and other sources will
// respect prefers-color-scheme: dark and render in their native dark mode.
nativeTheme.themeSource = 'dark'

// ── Verbose logging ───────────────────────────────────────────────────────────
// Enable with:  DJ_VERBOSE=1 npm start
const VERBOSE = !!process.env.DJ_VERBOSE
function log(...args) { if (VERBOSE) console.log(...args) }

let mainWindow
let currentWvContents = null
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

// ── Now-playing polling ───────────────────────────────────────────────────────

let monitorInterval      = null
let lastNowPlaying       = null
let lastTrackData        = null
let trackStartedAt       = null
let currentSetTitle      = null   // DJ set title used as album in Last.fm scrobbles
let currentThumbnailUrl  = null   // YouTube thumbnail for history/favorites
let isFallbackMode       = false  // true when showing YouTube fallback player
let lastFallbackPlaying  = null   // last known play state in fallback mode

function extractVideoId(url) {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtube.com')) return u.searchParams.get('v')
    if (u.hostname === 'youtu.be')          return u.pathname.slice(1).split('?')[0]
  } catch {}
  return null
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

function stopMonitoring() {
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null }
  lastNowPlaying = null
}

function startMonitoring(wvContents, tlPlugin) {
  stopMonitoring()
  monitorInterval = setInterval(async () => {
    try {
      const data = await wvContents.executeJavaScript(tlPlugin.nowPlayingScript)
      if (data) emitNowPlaying(data)
    } catch {}
  }, 500)
}

function emitNowPlaying(data) {
  if (data.raw === lastNowPlaying) return

  // Scrobble the track that just ended (must have played ≥30s).
  // Skip ID tracks — they have no artist/title to scrobble.
  if (lastTrackData && !lastTrackData.isId && trackStartedAt && (Date.now() - trackStartedAt) >= 30000) {
    lfmScrobble(lastTrackData.artist, lastTrackData.title, trackStartedAt, currentSetTitle)
  }

  lastNowPlaying = data.raw
  lastTrackData  = data
  trackStartedAt = Date.now()

  // Don't hit Last.fm for unidentified tracks — it would error and flip the badge.
  if (!data.isId) lfmUpdateNowPlaying(data.artist, data.title)
  mainWindow.webContents.send('now-playing', data)
}

// ── Source → tracklist routing ────────────────────────────────────────────────

async function handleSourceUrl(source, url, wvContents) {
  const tlPlugin = plugins.tracklistForSource(source.id)
  if (!tlPlugin) return

  log(`[lookup] source=${source.id} url=${url}`)

  currentThumbnailUrl = thumbnailForSourceUrl(url)
  mainWindow.webContents.send('wv-status', { type: 'loading', msg: `Searching ${tlPlugin.name}…` })

  const meta = await source.getMeta(url)
  log(`[lookup] meta title="${meta.title}"`)

  const results = await tlPlugin.findTracklists(meta)
  log(`[lookup] results=${results.length}`, results.map(r => r.title))

  if (results.length === 0) {
    log('[lookup] → fallback (no results)')
    return startFallbackForSource(source, url, meta, wvContents)
  }

  // Plugin confirmed the match by an exact criterion (e.g. YouTube video ID) —
  // load directly without text-similarity scoring.
  if (results[0].confirmed) {
    log(`[lookup] → confirmed match: ${results[0].url}`)
    isFallbackMode = false
    wvContents.loadURL(results[0].url)
    return
  }

  const scored = results
    .map(r => ({ ...r, score: plugins.titleSimilarity(meta, r.title) }))
    .sort((a, b) => b.score - a.score)

  log(`[${tlPlugin.id}] ${scored.length} results for: "${meta.title}"`)
  scored.forEach((r, i) => log(`  [${i + 1}] ${r.score}%  ${r.title}  →  ${r.url}`))

  if (scored[0].score === 0) {
    log('[lookup] → fallback (all scores 0)')
    return startFallbackForSource(source, url, meta, wvContents)
  }

  log(`[lookup] → loading tracklist: ${scored[0].url}`)
  isFallbackMode = false
  wvContents.loadURL(scored[0].url)
}

// Handles the "no tracklist found" case.
// YouTube → load native iframe fallback. Other sources → show the prompt.
function startFallbackForSource(source, url, meta, wvContents) {
  if (source.id === 'youtube') {
    const videoId = extractVideoId(url)
    if (videoId) {
      isFallbackMode    = true
      currentSetTitle   = meta.title || null
      mainWindow.webContents.send('tracklist-loaded', {
        url,
        title:        meta.title || url,
        thumbnailUrl: currentThumbnailUrl,
        isFallback:   true,
      })
      // Use the custom embed page — ad-free, always embeddable
      const embedUrl = `https://www.djscrobbler.com/embed/youtube?id=${videoId}`
      wvContents.loadURL(embedUrl)
      return
    }
  }
  // Non-YouTube or no video ID → original prompt
  mainWindow.webContents.send('wv-status', { type: 'no-tracklist-prompt', url })
}

// Scripts run inside the djscrobbler.com/embed/youtube page.
// window.ytPlayer is a real YT.Player object exposed by the embed page via the
// YouTube IFrame API — so these calls are direct and reliable.
const FALLBACK_STATE_SCRIPT = `
  (() => {
    if (window.ytPlayer && typeof window.ytPlayer.getPlayerState === 'function')
      return window.ytPlayer.getPlayerState() === 1   // 1 = YT.PlayerState.PLAYING
    return null  // API not ready yet — skip this tick
  })()
`

const FALLBACK_PLAY_SCRIPT = `
  (() => {
    if (window.ytPlayer && typeof window.ytPlayer.playVideo === 'function')
      window.ytPlayer.playVideo()
  })()
`

const FALLBACK_PAUSE_SCRIPT = `
  (() => {
    if (window.ytPlayer && typeof window.ytPlayer.pauseVideo === 'function')
      window.ytPlayer.pauseVideo()
  })()
`

// Returns { isPlaying, currentTime, duration } or null if not ready.
const FALLBACK_POLL_SCRIPT = `
  (() => {
    const p = window.ytPlayer
    if (!p || typeof p.getPlayerState !== 'function') return null
    const state = p.getPlayerState()
    if (state === -1) return null  // unstarted — not ready
    return {
      isPlaying:   state === 1,
      currentTime: p.getCurrentTime()  || 0,
      duration:    p.getDuration()     || 0,
    }
  })()
`

function startFallbackMonitoring(wvContents) {
  stopMonitoring()
  lastFallbackPlaying = null
  // Give the embed page time to load the IFrame API and fire onYouTubeIframeAPIReady
  setTimeout(() => {
    wvContents.executeJavaScript(FALLBACK_PLAY_SCRIPT).catch(() => {})
  }, 1500)
  monitorInterval = setInterval(async () => {
    try {
      const poll = await wvContents.executeJavaScript(FALLBACK_POLL_SCRIPT)
      if (!poll) return   // player not ready yet — try next tick
      if (poll.isPlaying !== lastFallbackPlaying) {
        lastFallbackPlaying = poll.isPlaying
        mainWindow.webContents.send('now-playing', {
          artist:      '',
          title:       '',
          raw:         'fallback',
          trackNum:    null,
          isPlaying:   poll.isPlaying,
          currentTime: poll.currentTime,
          duration:    poll.duration,
          source:      'youtube-fallback',
        })
      }
      // Always emit progress so the renderer can update the time-based bar
      if (poll.duration > 0) {
        mainWindow.webContents.send('fallback-progress', {
          currentTime: poll.currentTime,
          duration:    poll.duration,
        })
      }
    } catch {}
  }, 500)
}

// ── WebView wiring ────────────────────────────────────────────────────────────

function wireWebview(wvContents) {
  currentWvContents = wvContents
  let pendingLookup = false

  // Catch intercept signals from source plugins that use click interception
  wvContents.on('console-message', async (_e, _level, message) => {
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

    // djscrobbler.com custom embed page (YouTube fallback) — start monitoring play state
    if (isFallbackMode && url.includes('djscrobbler.com/embed/youtube')) {
      mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
      startFallbackMonitoring(wvContents)
      return
    }

    const tlPlugin = plugins.tracklistForUrl(url)
    if (tlPlugin) {
      isFallbackMode = false
      mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
      try {
        const title = await wvContents.executeJavaScript(
          `document.querySelector('h1')?.textContent?.trim() || document.title`
        )
        currentSetTitle = title || null
        mainWindow.webContents.send('tracklist-loaded', { url, title, thumbnailUrl: currentThumbnailUrl })
      } catch {}
      startMonitoring(wvContents, tlPlugin)

      // Inject overlay to hide page noise and surface the player full-width
      if (tlPlugin.playerConfig) {
        const store   = readStore()
        const theme   = store.settings?.theme || 'neon-night'
        const bgColor = overlay.bgForTheme(theme)
        const script  = overlay.buildOverlayScript(tlPlugin.playerConfig, bgColor)
        wvContents.executeJavaScript(script).catch(() => {})
      }

      if (tlPlugin.autoplayScript) {
        setTimeout(
          () => wvContents.executeJavaScript(tlPlugin.autoplayScript).catch(() => {}),
          tlPlugin.autoplayDelay || 0
        )
      }

      // Extract full tracklist and send to renderer for native display
      if (tlPlugin.tracklistExtractScript) {
        try {
          const tracks = await wvContents.executeJavaScript(tlPlugin.tracklistExtractScript)
          if (Array.isArray(tracks) && tracks.length) {
            mainWindow.webContents.send('tracklist-data', tracks)
          }
        } catch (e) {
          console.error('[tracklist] extraction failed:', e.message)
        }
      }
    } else {
      mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
      stopMonitoring()
    }
  })

  wvContents.on('did-fail-load', (_e, _code, _desc, _failedUrl, isMainFrame) => {
    if (isMainFrame) {
      mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
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
        {
          label: 'Open WebView DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => { if (currentWvContents) currentWvContents.openDevTools() },
        },
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
    console.error('[dock] failed to set icon:', e.message)
  }
}

// ── Window bounds persistence ─────────────────────────────────────────────────

function persistBounds() {
  clearTimeout(saveBoundsTimer)
  saveBoundsTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isMinimized() || mainWindow.isMaximized() || mainWindow.isFullScreen()) return
    const store = readStore()
    if (!store.settings) store.settings = {}
    store.settings.windowBounds = mainWindow.getBounds()
    if (lfmSession) store.settings.lfmSession = lfmSession
    writeStore(store)
  }, 400)
}

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  const { windowBounds } = readStore().settings || {}
  mainWindow = new BrowserWindow({
    width:  windowBounds?.width  || 1400,
    height: windowBounds?.height || 900,
    ...(windowBounds?.x != null ? { x: windowBounds.x, y: windowBounds.y } : {}),
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
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
  if (lfmSession) {
    if (!data.settings) data.settings = {}
    data.settings.lfmSession = lfmSession
  }
  writeStore(data)
})

ipcMain.handle('open-devtools', () => {
  if (currentWvContents) currentWvContents.openDevTools()
})

ipcMain.handle('player-toggle', async () => {
  if (!currentWvContents) return
  if (isFallbackMode) {
    const isPlaying = await currentWvContents.executeJavaScript(FALLBACK_STATE_SCRIPT).catch(() => null)
    const script = isPlaying ? FALLBACK_PAUSE_SCRIPT : FALLBACK_PLAY_SCRIPT
    await currentWvContents.executeJavaScript(script).catch(() => {})
    return
  }
  const url = currentWvContents.getURL()
  const tlPlugin = plugins.tracklistForUrl(url)
  if (!tlPlugin) return
  // Each plugin could expose a toggleScript; fall back to common selectors
  const script = url.includes('1001tracklists.com')
    ? `document.getElementById('playerWidgetPause')?.click()`
    : `document.querySelector('.play-button.active, .play-button')?.click()`
  await currentWvContents.executeJavaScript(script).catch(() => {})
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

ipcMain.handle('open-external', (_event, url) => {
  const allowed = ['djscrobbler.com', 'github.com']
  try {
    const { hostname } = new URL(url)
    if (allowed.some(d => hostname === d || hostname.endsWith('.' + d))) shell.openExternal(url)
  } catch {}
})

ipcMain.handle('player-goto-track', async (_event, onclickStr) => {
  if (!currentWvContents || !onclickStr) return
  // Replace the DOM element reference with null — playPosition accepts it
  const script = String(onclickStr).replace(/playPosition\s*\(\s*this/, 'playPosition(null')
  await currentWvContents.executeJavaScript(script).catch(() => {})
})

ipcMain.handle('fallback-seek', (_event, seconds) => {
  if (!currentWvContents) return
  const s = Number(seconds)
  if (!isFinite(s) || s < 0) return
  log('[fallback-seek] seeking to', s)
  currentWvContents.executeJavaScript(`
    (() => {
      if (window.ytPlayer && typeof window.ytPlayer.seekTo === 'function') {
        window.ytPlayer.seekTo(${s}, true)
        return 'ok'
      }
      return 'not-ready'
    })()
  `).then(r => log('[fallback-seek] result:', r)).catch(() => {})
})

// Re-run the full source → tracklist lookup for a URL (used when reopening a
// YouTube set that was previously saved as a fallback — gives it another chance
// to find a tracklist, while still falling back gracefully if none exists yet).
ipcMain.handle('load-source-url', async (_event, url) => {
  if (!currentWvContents) return
  const source = plugins.sourceForUrl(url)
  if (!source) return
  await handleSourceUrl(source, url, currentWvContents)
})

// Theme change — update dock icon, persist, and live-update overlay color
ipcMain.handle('set-theme', (_event, theme) => {
  setDockIcon(theme)
  const store = readStore()
  if (!store.settings) store.settings = {}
  store.settings.theme = theme
  if (lfmSession) store.settings.lfmSession = lfmSession
  writeStore(store)
  if (currentWvContents) {
    currentWvContents.executeJavaScript(
      overlay.buildColorUpdateScript(overlay.bgForTheme(theme))
    ).catch(() => {})
  }
})
