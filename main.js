const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path   = require('path')
const https  = require('https')
const crypto = require('crypto')
const fs     = require('fs')
const plugins = require('./plugins')

let mainWindow
let currentWvContents = null

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

function lfmScrobble(artist, title, startedAt) {
  if (!lfmSession?.key || !artist || !title) return
  lfmPost({
    method: 'track.scrobble',
    'artist[0]': artist,
    'track[0]': title,
    'timestamp[0]': String(Math.floor(startedAt / 1000)),
    sk: lfmSession.key,
  })
    .then(res => setLfmStatus(res.error ? 'error' : 'ok'))
    .catch(() => setLfmStatus('error'))
}

// ── Now-playing polling ───────────────────────────────────────────────────────

let monitorInterval = null
let lastNowPlaying  = null
let lastTrackData   = null
let trackStartedAt  = null

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

  // Scrobble the track that just ended (must have played ≥30s)
  if (lastTrackData && trackStartedAt && (Date.now() - trackStartedAt) >= 30000) {
    lfmScrobble(lastTrackData.artist, lastTrackData.title, trackStartedAt)
  }

  lastNowPlaying = data.raw
  lastTrackData  = data
  trackStartedAt = Date.now()

  lfmUpdateNowPlaying(data.artist, data.title)
  mainWindow.webContents.send('now-playing', data)
}

// ── Source → tracklist routing ────────────────────────────────────────────────

async function handleSourceUrl(source, url, wvContents) {
  const tlPlugin = plugins.tracklistForSource(source.id)
  if (!tlPlugin) return

  mainWindow.webContents.send('wv-status', { type: 'loading', msg: `Searching ${tlPlugin.name}…` })

  const meta    = await source.getMeta(url)
  const results = await tlPlugin.findTracklists(meta)

  if (results.length === 0) {
    mainWindow.webContents.send('wv-status', { type: 'no-tracklist' })
    return
  }

  const scored = results
    .map(r => ({ ...r, score: plugins.titleSimilarity(meta.title || '', r.title) }))
    .sort((a, b) => b.score - a.score)

  console.log(`[${tlPlugin.id}] ${scored.length} results for: "${meta.title}"`)
  scored.forEach((r, i) => console.log(`  [${i + 1}] ${r.score}%  ${r.title}  →  ${r.url}`))

  wvContents.loadURL(scored[0].url)
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

    const tlPlugin = plugins.tracklistForUrl(url)
    if (tlPlugin) {
      mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
      try {
        const title = await wvContents.executeJavaScript(
          `document.querySelector('h1')?.textContent?.trim() || document.title`
        )
        mainWindow.webContents.send('tracklist-loaded', { url, title })
      } catch {}
      startMonitoring(wvContents, tlPlugin)

      if (tlPlugin.autoplayScript) {
        setTimeout(
          () => wvContents.executeJavaScript(tlPlugin.autoplayScript).catch(() => {}),
          tlPlugin.autoplayDelay || 0
        )
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

// ── Window ────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true,
    },
  })

  mainWindow.loadFile('renderer/index.html')
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(true))
  mainWindow.webContents.on('did-attach-webview', (_event, wvContents) => wireWebview(wvContents))

  // Spotify-style close: hide the window instead of quitting
  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin') {
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
  createWindow()
  // Clicking the dock icon shows the window if it's hidden
  app.on('activate', () => {
    if (mainWindow) mainWindow.show()
    else createWindow()
  })
})

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
