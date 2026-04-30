const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const https = require('https')
const fs = require('fs')

let mainWindow
let currentWvContents = null   // reference to the active webview webContents

// ── Persistence ───────────────────────────────────────────────────────────────

function getStorePath() {
  return path.join(app.getPath('userData'), 'dj-scrobbler.json')
}

function readStore() {
  try {
    return JSON.parse(fs.readFileSync(getStorePath(), 'utf8'))
  } catch {
    return { favorites: [], history: [], settings: {} }
  }
}

function writeStore(data) {
  fs.writeFileSync(getStorePath(), JSON.stringify(data, null, 2))
}

// ── URL classification ────────────────────────────────────────────────────────

function isYouTubeWatch(url) {
  try {
    const u = new URL(url)
    return (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') &&
      u.pathname === '/watch' && u.searchParams.has('v')
  } catch { return false }
}

function isSoundCloudTrack(url) {
  try {
    const u = new URL(url)
    if (u.hostname !== 'soundcloud.com') return false
    const parts = u.pathname.split('/').filter(Boolean)
    const SKIP = ['you', 'discover', 'upload', 'signin', 'pages', 'charts', 'jobs', 'imprint', 'stream']
    return parts.length === 2 && !SKIP.includes(parts[0])
  } catch { return false }
}

function buildSet79Url(scUrl) {
  const u = new URL(scUrl)
  return `https://set79.com/tracklist/soundcloud.com${u.pathname}`
}

// ── 1001tracklists search ─────────────────────────────────────────────────────

function search1001tl(youtubeUrl) {
  return new Promise((resolve) => {
    const postData = new URLSearchParams({
      main_search: youtubeUrl,
      search_selection: '9',
      orderby: 'added',
    }).toString()

    const req = https.request(
      {
        hostname: 'www.1001tracklists.com',
        path: '/search/result.php',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:150.0) Gecko/20100101 Firefox/150.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          Origin: 'https://www.1001tracklists.com',
          Referer: 'https://www.1001tracklists.com/search/result.php',
          Cookie: 'guid=3dc62f90cce8f',
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const html = Buffer.concat(chunks).toString()
          const match = html.match(/href="(\/tracklist\/[^"]+\.html)"/)
          resolve(match ? 'https://www.1001tracklists.com' + match[1] : null)
        })
      }
    )
    req.on('error', () => resolve(null))
    req.write(postData)
    req.end()
  })
}

// ── Consent popup dismissal ───────────────────────────────────────────────────
// Inject into each page after load to auto-dismiss common cookie/GDPR banners.

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
      if (labels.some(r => r.test(text))) {
        btn.click()
        return true
      }
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

// ── Now-playing polling ───────────────────────────────────────────────────────

let monitorInterval = null
let lastNowPlaying = null

function stopMonitoring() {
  if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null }
  lastNowPlaying = null
}

function startMonitoring(wvContents, url) {
  stopMonitoring()

  if (url.includes('1001tracklists.com/tracklist/')) {
    monitorInterval = setInterval(async () => {
      try {
        const data = await wvContents.executeJavaScript(`
          (() => {
            const row = document.getElementsByClassName('cPlay')[0]
            if (!row) return null
            const nameMeta   = row.querySelector('meta[itemprop="name"]')
            const artistMeta = row.querySelector('meta[itemprop="byArtist"]')
            if (!nameMeta) return null
            const fullName = nameMeta.getAttribute('content') || ''
            const artist   = artistMeta ? (artistMeta.getAttribute('content') || '') : ''
            const prefix   = artist ? artist + ' - ' : ''
            const title    = prefix && fullName.startsWith(prefix)
              ? fullName.substring(prefix.length)
              : fullName
            const trackNumEl = row.querySelector('.fontXL')
            const trackNum   = trackNumEl ? parseInt(trackNumEl.textContent.trim()) : null
            const pauseBtn   = document.getElementById('playerWidgetPause')
            const isPlaying  = pauseBtn ? pauseBtn.classList.contains('fa-pause') : true
            return { artist, title, raw: fullName, trackNum, isPlaying, source: '1001tl' }
          })()
        `)
        if (data) emitNowPlaying(data)
      } catch {}
    }, 500)

  } else if (url.includes('set79.com/tracklist/')) {
    monitorInterval = setInterval(async () => {
      try {
        const data = await wvContents.executeJavaScript(`
          (() => {
            const activeRow = document.querySelector('.track-row.active')
            if (!activeRow) return null
            const ariaLabel = activeRow.getAttribute('aria-label') || ''
            const match = ariaLabel.match(/Track (\\d+): (.+?) at \\d/)
            if (!match) return null
            const trackNum = parseInt(match[1])
            const raw = match[2]
            const dashIdx = raw.lastIndexOf(' - ')
            return {
              artist: dashIdx > 0 ? raw.substring(0, dashIdx).trim() : '',
              title:  dashIdx > 0 ? raw.substring(dashIdx + 3).trim() : raw,
              raw, trackNum, isPlaying: true, source: 'set79',
            }
          })()
        `)
        if (data) emitNowPlaying(data)
      } catch {}
    }, 500)
  }
}

function emitNowPlaying(data) {
  if (data.raw === lastNowPlaying) return
  lastNowPlaying = data.raw
  mainWindow.webContents.send('now-playing', data)
}

// ── WebView wiring ────────────────────────────────────────────────────────────

function wireWebview(wvContents) {
  currentWvContents = wvContents

  let pendingLookup = false

  async function handleUrl(url, canPrevent, event) {
    if (isYouTubeWatch(url)) {
      if (pendingLookup) return
      pendingLookup = true
      if (canPrevent) event.preventDefault()
      mainWindow.webContents.send('wv-status', { type: 'loading', msg: 'Searching 1001tracklists…' })
      const tlUrl = await search1001tl(url)
      pendingLookup = false
      if (tlUrl) {
        wvContents.loadURL(tlUrl)
      } else {
        mainWindow.webContents.send('wv-status', { type: 'no-tracklist' })
      }
    } else if (isSoundCloudTrack(url)) {
      if (pendingLookup) return
      pendingLookup = true
      if (canPrevent) event.preventDefault()
      mainWindow.webContents.send('wv-status', { type: 'loading', msg: 'Looking up set79…' })
      wvContents.loadURL(buildSet79Url(url))
      pendingLookup = false
    }
  }

  // Real (non-SPA) navigations — can preventDefault
  wvContents.on('will-navigate', (event, url) => handleUrl(url, true, event))

  // SPA pushState navigations (YouTube, SoundCloud) — can't preventDefault
  wvContents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (!isMainFrame) return
    handleUrl(url, false, null)
  })

  wvContents.on('did-finish-load', async () => {
    const url = wvContents.getURL()

    // Dismiss consent popups on any page
    wvContents.executeJavaScript(CONSENT_SCRIPT).catch(() => {})

    if (url.includes('1001tracklists.com/tracklist/') || url.includes('set79.com/tracklist/')) {
      mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
      try {
        const title = await wvContents.executeJavaScript(
          url.includes('set79.com')
            ? `document.querySelector('h1')?.textContent?.trim() || document.title`
            : `document.title`
        )
        mainWindow.webContents.send('tracklist-loaded', { url, title })
      } catch {}
      startMonitoring(wvContents, url)

      // Auto-start playback once player JS has initialised
      if (url.includes('1001tracklists.com/tracklist/')) {
        setTimeout(() => {
          wvContents.executeJavaScript(`
            if (typeof ytPlayer !== 'undefined' && ytPlayer.idPlayer) {
              try { getYTPlayer(ytPlayer.idPlayer).player.playVideo() } catch(e) {}
            }
          `).catch(() => {})
        }, 3000)
      }
    } else {
      mainWindow.webContents.send('wv-status', { type: 'hide-overlay' })
      stopMonitoring()
    }
  })

  wvContents.on('did-fail-load', (_e, _code, _desc, _failedUrl, isMainFrame) => {
    // Only react to main-frame failures; sub-resource errors are normal
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

  mainWindow.webContents.on('did-attach-webview', (_event, wvContents) => {
    wireWebview(wvContents)
  })
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── IPC handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('search-1001tl', (_event, url) => search1001tl(url))

ipcMain.handle('get-set79-url', (_event, scUrl) => {
  try {
    const u = new URL(scUrl)
    return u.hostname === 'soundcloud.com' ? buildSet79Url(scUrl) : null
  } catch { return null }
})

ipcMain.handle('store-get', () => readStore())
ipcMain.handle('store-set', (_event, data) => writeStore(data))

ipcMain.handle('open-devtools', () => {
  if (currentWvContents) currentWvContents.openDevTools()
})

ipcMain.handle('player-toggle', async () => {
  if (!currentWvContents) return
  const url = currentWvContents.getURL()
  if (url.includes('1001tracklists.com')) {
    await currentWvContents.executeJavaScript(
      `document.getElementById('playerWidgetPause')?.click()`
    ).catch(() => {})
  } else if (url.includes('set79.com')) {
    await currentWvContents.executeJavaScript(
      `document.querySelector('.play-button.active, .play-button')?.click()`
    ).catch(() => {})
  }
})
