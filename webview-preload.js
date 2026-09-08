/**
 * Injected into the <webview> for every page it loads.
 * Runs before the page's own scripts.
 */
const { ipcRenderer } = require('electron')

const host = location.hostname
let lastNowPlaying = null

function ready(fn) {
  if (document.readyState !== 'loading') fn()
  else document.addEventListener('DOMContentLoaded', fn)
}

ready(() => {
  if (host === 'www.youtube.com') setupYouTubeInterceptor()
  else if (host === 'soundcloud.com') setupSoundCloudInterceptor()
  else if (host === 'www.1001tracklists.com') setup1001TLMonitor()
  else if (host === 'set79.com') setupSet79Monitor()
})

// ── YouTube ──────────────────────────────────────────────────────────────────

function setupYouTubeInterceptor() {
  document.addEventListener(
    'click',
    (e) => {
      const anchor = e.target.closest('a[href]')
      if (!anchor) return
      const url = anchor.href
      if (url && url.includes('youtube.com/watch?v=')) {
        e.preventDefault()
        e.stopPropagation()
        ipcRenderer.sendToHost('yt-video-clicked', url)
      }
    },
    true
  )
}

// ── SoundCloud ───────────────────────────────────────────────────────────────

function setupSoundCloudInterceptor() {
  document.addEventListener(
    'click',
    (e) => {
      const anchor = e.target.closest('a[href]')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      // Match /user/track paths (exactly 2 segments, no query, no special SC pages)
      if (
        href &&
        /^\/[\w-]+\/[\w-]+$/.test(href) &&
        !href.startsWith('/you/') &&
        !href.startsWith('/discover') &&
        !href.startsWith('/upload') &&
        !href.startsWith('/signin')
      ) {
        e.preventDefault()
        e.stopPropagation()
        ipcRenderer.sendToHost('sc-track-clicked', 'https://soundcloud.com' + href)
      }
    },
    true
  )
}

// ── 1001tracklists monitor ────────────────────────────────────────────────────

function setup1001TLMonitor() {
  const titleEl = document.querySelector('h1, .tlTitle, [class*="title"]')
  const setTitle = titleEl?.textContent?.trim() || document.title
  ipcRenderer.sendToHost('page-type', { type: 'tracklist-1001tl', setTitle })

  // Watch for class/style mutations — 1001tl highlights current track via JS
  const observer = new MutationObserver(() => check1001TLNowPlaying())
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style'],
    childList: true,
  })

  // Also poll — their player updates are async
  setInterval(check1001TLNowPlaying, 1000)
}

function check1001TLNowPlaying() {
  // Try known class selectors for the currently playing track
  const selectors = [
    '.isPlaying',
    '.nowPlaying',
    '.playing',
    '.tli.active',
    '[class*="Playing"]',
    '[class*="playing"]',
  ]

  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el) {
      emit1001TLTrack(el)
      return
    }
  }

  // Fallback: look for a track row with a non-default background colour
  // 1001tl renders tracks as divs with ids like tlp_XXXXX
  const rows = document.querySelectorAll('[id^="tlp_"], .tlpItem, .tli')
  for (const row of rows) {
    const bg = window.getComputedStyle(row).backgroundColor
    // Anything that isn't transparent or plain white is likely the highlight
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(255, 255, 255)') {
      emit1001TLTrack(row)
      return
    }
  }
}

function emit1001TLTrack(el) {
  // Extract artist / title from element text nodes or child elements
  const artistEl = el.querySelector('.oArtist, [class*="artist"], [class*="Artist"]')
  const titleEl = el.querySelector('.oTitle, [class*="title"], [class*="Title"]')
  const artist = artistEl?.textContent?.trim()
  const title = titleEl?.textContent?.trim()
  const raw = el.textContent?.replace(/\s+/g, ' ').trim().substring(0, 200)
  const key = artist || title || raw
  if (!key || key === lastNowPlaying) return
  lastNowPlaying = key
  ipcRenderer.sendToHost('now-playing', { artist, title, raw, source: '1001tl' })
}

// ── set79 monitor ────────────────────────────────────────────────────────────

function setupSet79Monitor() {
  const h1 = document.querySelector('h1')
  const setTitle = h1?.textContent?.trim() || document.title
  ipcRenderer.sendToHost('page-type', { type: 'tracklist-set79', setTitle })

  const observer = new MutationObserver(() => checkSet79NowPlaying())
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
    childList: true,
  })

  setInterval(checkSet79NowPlaying, 500)
}

function checkSet79NowPlaying() {
  const activeRow = document.querySelector('.track-row.active')
  if (!activeRow) return

  // aria-label = "Track N: Artist - Title at HH:MM:SS"
  const ariaLabel = activeRow.getAttribute('aria-label') || ''
  const match = ariaLabel.match(/Track \d+: (.+?) at \d/)
  const raw = match ? match[1] : activeRow.textContent?.replace(/\s+/g, ' ').trim().substring(0, 200)
  if (!raw || raw === lastNowPlaying) return
  lastNowPlaying = raw

  // Split "Artist - Title" (last " - " is the divider)
  const dashIdx = raw.lastIndexOf(' - ')
  const artist = dashIdx > 0 ? raw.substring(0, dashIdx) : ''
  const title = dashIdx > 0 ? raw.substring(dashIdx + 3) : raw

  ipcRenderer.sendToHost('now-playing', { artist, title, raw, source: 'set79' })
}
