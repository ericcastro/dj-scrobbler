/**
 * Renderer process — all UI logic.
 * window.api is exposed by preload.js via contextBridge.
 *
 * Icons: Lucide (MIT) — https://lucide.dev
 */

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  source: 'youtube',
  currentSetTitle: '',
  currentSetUrl: '',
  currentSource: '',
  currentThumbnailUrl: null,
  nowPlaying: null,
  lfmStatus: 'unconfigured',
  isTrackPlaying: false,
  isIdTrack: false,
  tracklistUnavailable: false,
  store: { favorites: [], history: [], searchQueries: [], settings: {} },
  currentTracks: [],       // full track array from tracklist-data, used for progress lookups
  pendingResume: null,     // onclickStr to fire after tracklist loads (1001tl resume)
  pendingResumeTime: null, // seconds to seek to after first fallback-progress tick
}

// ── DOM refs ────────────────────────────────────────────────────────────────

const webview            = document.getElementById('webview')
const searchInput        = document.getElementById('search-input')
const searchDropdown     = document.getElementById('search-dropdown')
const searchBtn          = document.getElementById('search-btn')
const btnYT              = document.getElementById('btn-yt')
const btnSC              = document.getElementById('btn-sc')
const btnBookmark        = document.getElementById('btn-bookmark')
const btnDevtools        = document.getElementById('btn-devtools')
const btnSidebarToggle   = document.getElementById('btn-sidebar-toggle')
const sidebar            = document.getElementById('sidebar')
const sidebarResizeHandle= document.getElementById('sidebar-resize-handle')
const sidebarFooter      = document.getElementById('sidebar-footer')
const introScreen        = document.getElementById('intro-screen')
const introGreeting      = document.getElementById('intro-greeting')
const loadingOverlay     = document.getElementById('loading-overlay')
const loadingMsg         = document.getElementById('loading-msg')
const noTracklistMsg     = document.getElementById('no-tracklist-msg')
const noTracklistPrompt  = document.getElementById('no-tracklist-prompt')
const btnPlayAnyway      = document.getElementById('btn-play-anyway')
const navBtns            = document.querySelectorAll('.nav-btn')
const panels             = document.querySelectorAll('.sidebar-panel')
const favoritesList      = document.getElementById('favorites-list')
const historyList        = document.getElementById('history-list')
const favEmpty           = document.getElementById('fav-empty')
const histEmpty          = document.getElementById('hist-empty')
const mainContent              = document.getElementById('main-content')
const tracklistBelowVideo      = document.getElementById('tracklist-below-video')
const tracklistList            = document.getElementById('tracklist-list')
const tracklistUnavailableEl   = document.getElementById('tracklist-unavailable')
const tracklistCompactList  = document.getElementById('tracklist-compact-list')
const rightPanel            = document.getElementById('right-panel')
const rightPanelHandle      = document.getElementById('right-panel-handle')
const btnTracklistToggle    = document.getElementById('btn-tracklist-toggle')
const btnPlayPause          = document.getElementById('btn-playpause')
const ppIcon             = document.getElementById('pp-icon')
const npTracknum         = document.getElementById('np-tracknum')
const npTrack            = document.getElementById('np-track')
const npArtist           = document.getElementById('np-artist')
const npSet              = document.getElementById('np-set')
const npSource           = document.getElementById('np-source')
const resumeDialog        = document.getElementById('resume-dialog')
const resumeCountdownNum  = document.getElementById('resume-countdown-num')
const resumeDontAsk       = document.getElementById('resume-dont-ask')
const btnResumeStart      = document.getElementById('btn-resume-start')
const btnResumeResume     = document.getElementById('btn-resume-resume')
const scrobbleBadge      = document.getElementById('scrobble-badge')
const scrobbleLabel      = document.getElementById('scrobble-label')
const btnLfmConnect      = document.getElementById('btn-lfm-connect')
const btnLfmDisconnect   = document.getElementById('btn-lfm-disconnect')
const lfmConnected       = document.getElementById('lfm-connected')
const lfmDisconnected    = document.getElementById('lfm-disconnected')
const lfmUsername        = document.getElementById('lfm-username')
const lfmConnectStatus   = document.getElementById('lfm-connect-status')
const footerAppName      = document.getElementById('footer-app-name')

// ── Icons (Lucide MIT) ────────────────────────────────────────────────────────

function icon(paths, size = 14) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
}

const ICON = {
  play:     '<polygon points="5 3 19 12 5 21 5 3"/>',
  pause:    '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  heart:       '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  heartFilled: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" fill="currentColor"/>',
}

// ── Boot ────────────────────────────────────────────────────────────────────

const DEFAULT_SIDEBAR_W = 220

const GREETINGS = [
  'Welcome back.',
  'Good to see you.',
  'Ready to dig in?',
  "Let's find something good.",
  'Time to get lost.',
  'The decks are ready.',
  'What will it be tonight?',
]

let webviewReady = false
let pendingNav = null

function navigateTo(url) {
  hideIntro()
  if (webviewReady) webview.loadURL(url)
  else pendingNav = url
}

async function init() {
  state.store = await window.api.getStore()

  applyTheme(state.store.settings?.theme || 'neon-night', false)
  restoreSidebarWidth()
  restoreRightPanelWidth()

  // Restore right panel open/closed state (default: closed)
  const rightPanelOpen = state.store.settings?.rightPanelOpen ?? false
  if (rightPanelOpen) {
    rightPanel.classList.remove('collapsed')
    rightPanelHandle.classList.remove('hidden')
    btnTracklistToggle.classList.add('active')
  }

  const version = await window.api.getVersion()
  footerAppName.textContent = `DJ Scrobbler v${version}`

  introGreeting.textContent = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]

  renderFavorites()
  renderHistory()

  state.lfmStatus = await window.api.lfmStatusGet()
  refreshScrobbleBadge()
  await loadSettings()
  syncResumeSettingUI()

  webview.addEventListener('dom-ready', () => {
    webviewReady = true
    if (pendingNav) { webview.loadURL(pendingNav); pendingNav = null }
  })

  wireEvents()
  wireMainEvents()
  // No default navigation — show intro screen
}

// ── Intro screen ──────────────────────────────────────────────────────────────

function hideIntro() {
  introScreen.classList.add('hidden')
}

// ── Search ──────────────────────────────────────────────────────────────────

const SOURCE_URLS = {
  youtube:    q => q ? `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` : 'https://www.youtube.com',
  soundcloud: q => q ? `https://soundcloud.com/search?q=${encodeURIComponent(q)}` : 'https://soundcloud.com',
}

function navigateToSearch(query = '') {
  hideOverlays()
  clearTracklist()
  navigateTo(SOURCE_URLS[state.source](query))
}

function doSearch() {
  const q = searchInput.value.trim()
  hideSearchDropdown()
  if (q) saveSearchQuery(q)
  navigateToSearch(q)
}

// ── Search autocomplete ───────────────────────────────────────────────────────

let dropdownFocusIdx = -1

function showSearchDropdown(matches) {
  dropdownFocusIdx = -1
  searchDropdown.innerHTML = ''
  matches.forEach((q) => {
    const item = document.createElement('div')
    item.className = 'search-dropdown-item'
    item.textContent = q
    item.addEventListener('mousedown', (e) => {
      e.preventDefault() // keep focus on input
      searchInput.value = q
      hideSearchDropdown()
      doSearch()
    })
    searchDropdown.appendChild(item)
  })
  searchDropdown.classList.add('open')
}

function hideSearchDropdown() {
  searchDropdown.classList.remove('open')
  dropdownFocusIdx = -1
}

function updateDropdownFocus(delta) {
  const items = searchDropdown.querySelectorAll('.search-dropdown-item')
  if (!items.length) return
  items[dropdownFocusIdx]?.classList.remove('focused')
  dropdownFocusIdx = Math.max(-1, Math.min(items.length - 1, dropdownFocusIdx + delta))
  const focused = items[dropdownFocusIdx]
  if (focused) {
    focused.classList.add('focused')
    searchInput.value = focused.textContent
  }
}

function saveSearchQuery(query) {
  if (!query) return
  const queries = state.store.searchQueries || []
  const deduped = [query, ...queries.filter(q => q !== query)].slice(0, 50)
  state.store.searchQueries = deduped
  persist()
}

// ── Messages from main process ────────────────────────────────────────────────

function isResumeDialogOpen() {
  return !resumeDialog.classList.contains('hidden')
}

function wireMainEvents() {
  window.api.on('wv-status', (status) => {
    // Don't show/hide overlays while the resume dialog is open — it would change
    // the visible content behind the semi-transparent backdrop mid-countdown and
    // confuse the user about what's happening.
    if (isResumeDialogOpen()) return
    switch (status.type) {
      case 'loading':             showLoading(status.msg); break
      case 'no-tracklist':        showNoTracklist(); break
      case 'no-tracklist-prompt': showNoTracklistPrompt(status.url); break
      case 'hide-overlay':        hideOverlays(); break
    }
  })

  window.api.on('tracklist-loaded', ({ url, title, thumbnailUrl, isFallback }) => {
    // Don't update set state or history while the user is deciding in the dialog.
    if (isResumeDialogOpen()) return
    state.tracklistUnavailable = !!isFallback
    state.currentSetTitle      = title
    state.currentSetUrl        = url
    state.currentThumbnailUrl  = thumbnailUrl || null

    if (isFallback) {
      state.pendingResume  = null
      state.currentTracks  = []   // prevent stale count leaking into bookmark
      state.currentSource  = 'youtube'
      npSet.textContent     = title
      npSource.textContent  = 'youtube (no tracklist yet)'
      // Show the below-video area with the unavailable message
      tracklistUnavailableEl.classList.remove('hidden')
      tracklistList.innerHTML = ''
      tracklistCompactList.innerHTML = ''
      mainContent.classList.add('has-tracklist')
      // Clear any stale track info from a previous set
      state.nowPlaying       = null
      state.isTrackPlaying   = false
      npTrack.textContent    = ''
      npArtist.textContent   = ''
      npTracknum.textContent = ''
      ppIcon.innerHTML      = icon(ICON.play, 16)
      btnPlayPause.classList.remove('playing')
    } else {
      state.currentSource  = url.includes('1001tracklists') ? '1001tl' : 'set79'
      npSet.textContent    = title
      npSource.textContent = url.includes('1001tracklists')
        ? 'tracklist courtesy of 1001tracklists'
        : 'tracklist courtesy of set79'
      tracklistUnavailableEl.classList.add('hidden')
    }

    state.isIdTrack = false
    updateBookmarkBtn()
    refreshScrobbleBadge()
    addToHistory({ title, url, source: state.currentSource, thumbnailUrl: state.currentThumbnailUrl })
  })

  window.api.on('now-playing', (data) => {
    state.nowPlaying = data
    const playing = data.isPlaying !== false
    ppIcon.innerHTML = playing ? icon(ICON.pause, 16) : icon(ICON.play, 16)
    btnPlayPause.classList.toggle('playing', playing)
    state.isTrackPlaying = playing
    state.isIdTrack      = !!data.isId
    // Fallback events only carry play/pause state — don't overwrite track display
    if (data.source !== 'youtube-fallback') {
      npTrack.textContent    = data.isId ? 'ID' : (data.title || data.raw || '—')
      npArtist.textContent   = data.isId ? '—' : (data.artist || '—')
      npTracknum.textContent = data.trackNum ? `#${data.trackNum}` : ''
      if (data.trackNum) highlightTracklistByNum(data.trackNum)
    }
    // Save playback progress so history/favorites items can show a progress bar
    if (data.trackNum && state.currentSetUrl && data.source !== 'youtube-fallback') {
      const track = state.currentTracks.find(t => t.trackNum === data.trackNum)
      updateSetProgress(state.currentSetUrl, data.trackNum, track?.onclickStr || null)
    }
    refreshScrobbleBadge()
  })

  window.api.on('lfm-status', (status) => {
    state.lfmStatus = status
    refreshScrobbleBadge()
  })

  window.api.on('fallback-progress', ({ currentTime, duration }) => {
    if (!state.currentSetUrl || !duration) return
    // On first valid tick after a resume load, seek to the saved position then clear
    if (state.pendingResumeTime !== null) {
      const t = state.pendingResumeTime
      state.pendingResumeTime = null
      window.api.fallbackSeek(t)
      return  // progress bar will update on the next tick at the new position
    }
    const pct = Math.min(99, Math.round((currentTime / duration) * 100))
    if (pct < 1) return
    updateFallbackProgress(state.currentSetUrl, pct, currentTime)
  })

  window.api.on('tracklist-data', (tracks) => {
    if (isResumeDialogOpen()) return
    renderTracklist(tracks)
    state.currentTracks = tracks
    // Persist track count on the history/favorites entry so the sidebar can
    // show "XX tracks" instead of a source name
    const count = tracks.length
    state.store.history   = state.store.history.map(item =>
      item.url === state.currentSetUrl ? { ...item, trackCount: count } : item
    )
    state.store.favorites = state.store.favorites.map(item =>
      item.url === state.currentSetUrl ? { ...item, trackCount: count } : item
    )
    persist()
    renderHistory()
    renderFavorites()
    // If a resume was requested, seek to the saved track once the page is ready
    if (state.pendingResume) {
      const onclick = state.pendingResume
      state.pendingResume = null
      setTimeout(() => window.api.playerGotoTrack(onclick), 1500)
    }
  })

  window.api.on('menu-toggle-sidebar', () => toggleSidebar())
  window.api.on('menu-reload', () => navigateToSearch())
}

// ── Scrobble badge ────────────────────────────────────────────────────────────

const BADGE = {
  unconfigured:  { label: 'Scrobbling not configured', cls: '' },
  enabled:       { label: 'Scrobbling enabled',        cls: '' },
  scrobbling:    { label: 'Scrobbling',                cls: 'ok' },
  idtrack:       { label: 'Unidentified track',        cls: 'dim' },
  error:         { label: 'Error',                     cls: 'error' },
  unavailable:   { label: 'Tracklist unavailable',     cls: 'dim' },
}

function refreshScrobbleBadge() {
  let key
  if (state.tracklistUnavailable) key = 'unavailable'
  else if (state.isIdTrack && state.isTrackPlaying) key = 'idtrack'
  else if (state.lfmStatus === 'error') key = 'error'
  else if (state.lfmStatus === 'unconfigured') key = 'unconfigured'
  else if (state.isTrackPlaying) key = 'scrobbling'
  else key = 'enabled'
  const cfg = BADGE[key]
  scrobbleBadge.className = cfg.cls
  scrobbleLabel.textContent = cfg.label
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function switchSidebarPanel(name) {
  navBtns.forEach((b) => b.classList.toggle('active', b.dataset.panel === name))
  panels.forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`))
}

function toggleSidebar() {
  sidebar.classList.toggle('collapsed')
}

// ── Sidebar resize ────────────────────────────────────────────────────────────

function restoreSidebarWidth() {
  const w = state.store.settings?.sidebarWidth || DEFAULT_SIDEBAR_W
  sidebar.style.width = w + 'px'
}

function wireSidebarResize() {
  let isResizing = false

  // Full-screen overlay prevents mouse events being swallowed by the webview
  // (webview is an out-of-process iframe; events crossing into it vanish)
  const dragOverlay = document.createElement('div')
  dragOverlay.style.cssText =
    'position:fixed;inset:0;z-index:99999;cursor:col-resize;display:none'
  document.body.appendChild(dragOverlay)

  sidebarResizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true
    dragOverlay.style.display = 'block'
    sidebarResizeHandle.classList.add('dragging')
    document.body.style.userSelect = 'none'
    e.preventDefault()
  })

  const onMove = (e) => {
    if (!isResizing) return
    sidebar.style.width = Math.max(160, Math.min(480, e.clientX)) + 'px'
  }

  const onUp = () => {
    if (!isResizing) return
    isResizing = false
    dragOverlay.style.display = 'none'
    sidebarResizeHandle.classList.remove('dragging')
    document.body.style.userSelect = ''
    const w = parseInt(sidebar.style.width, 10)
    if (w) {
      if (!state.store.settings) state.store.settings = {}
      state.store.settings.sidebarWidth = w
      persist()
    }
  }

  dragOverlay.addEventListener('mousemove', onMove)
  dragOverlay.addEventListener('mouseup', onUp)
  document.addEventListener('mouseup', onUp) // safety net
}

// ── Favorites ────────────────────────────────────────────────────────────────

function addToFavorites(item) {
  if (state.store.favorites.find((f) => f.url === item.url)) return
  state.store.favorites.unshift(item)
  persist()
  renderFavorites()
}

// Ensure a history/favorites item is up to date with the latest known trackCount
// and progress. Called after addToFavorites so a newly-bookmarked set gets the
// same data that tracklist-data / updateSetProgress would have written earlier.
function syncProgressToItem(url) {
  const histEntry = state.store.history.find(h => h.url === url)
  if (!histEntry) return
  const patch = {}
  if (histEntry.trackCount       != null) patch.trackCount       = histEntry.trackCount
  if (histEntry.progressTrackNum != null) patch.progressTrackNum = histEntry.progressTrackNum
  if (histEntry.lastTrackOnclick != null) patch.lastTrackOnclick  = histEntry.lastTrackOnclick
  if (histEntry.progressTimePct  != null) patch.progressTimePct  = histEntry.progressTimePct
  if (histEntry.progressTime     != null) patch.progressTime     = histEntry.progressTime
  if (!Object.keys(patch).length) return
  state.store.favorites = state.store.favorites.map(f =>
    f.url === url ? { ...patch, ...f } : f   // patch fills gaps; f's own values win
  )
  persist()
  renderFavorites()
}

function removeFromFavorites(url) {
  state.store.favorites = state.store.favorites.filter((f) => f.url !== url)
  persist()
  renderFavorites()
  updateBookmarkBtn()
}

function renderFavorites() {
  const favs = state.store.favorites
  favoritesList.innerHTML = ''
  favEmpty.style.display = favs.length ? 'none' : ''
  favs.forEach((item) => favoritesList.appendChild(makeSetListItem(item, () => removeFromFavorites(item.url))))
}

function isFavorited(url) {
  return state.store.favorites.some((f) => f.url === url)
}

function updateBookmarkBtn() {
  const on = !!state.currentSetUrl && isFavorited(state.currentSetUrl)
  btnBookmark.innerHTML = on ? icon(ICON.heartFilled, 15) : icon(ICON.heart, 15)
  btnBookmark.classList.toggle('active', on)
}

// ── History ──────────────────────────────────────────────────────────────────

function addToHistory(item) {
  const existing = state.store.history.find(h => h.url === item.url)
  // Preserve progress fields from the previous entry so they survive re-opens
  const preserved = existing ? {
    trackCount:       existing.trackCount,
    progressTrackNum: existing.progressTrackNum,
    lastTrackOnclick: existing.lastTrackOnclick,
    progressTimePct:  existing.progressTimePct,
    progressTime:     existing.progressTime,
  } : {}
  state.store.history = state.store.history.filter(h => h.url !== item.url)
  state.store.history.unshift({ ...preserved, ...item, playedAt: Date.now() })
  if (state.store.history.length > 100) state.store.history.pop()
  persist()
  renderHistory()
}

function renderHistory() {
  const hist = state.store.history
  historyList.innerHTML = ''
  histEmpty.style.display = hist.length ? 'none' : ''
  hist.forEach((item) => historyList.appendChild(makeSetListItem(item)))
}

function wireMarquee(li) {
  const titleEl = li.querySelector('.set-item-title')
  if (!titleEl) return

  li.addEventListener('mouseenter', () => {
    // Cancel any in-progress return transition first
    titleEl.style.transition = 'none'
    titleEl.style.transform  = ''
    titleEl.classList.remove('marquee')

    requestAnimationFrame(() => {
      const overflow = titleEl.scrollWidth - titleEl.clientWidth
      if (overflow <= 4) return
      const secs = Math.max(1.5, overflow / 60) // 60 px/s
      titleEl.style.setProperty('--marquee-dist', `-${overflow}px`)
      titleEl.style.setProperty('--marquee-dur',  `${secs}s`)
      titleEl.classList.add('marquee')
    })
  })

  li.addEventListener('mouseleave', () => {
    if (!titleEl.classList.contains('marquee')) return
    // Read animated position so the return glide starts from where it is
    const currentX = new DOMMatrix(getComputedStyle(titleEl).transform).m41
    titleEl.classList.remove('marquee')
    titleEl.style.transform = `translateX(${currentX}px)`
    // Double rAF ensures the browser registers the explicit transform before
    // we add the transition, avoiding an instant snap
    requestAnimationFrame(() => requestAnimationFrame(() => {
      titleEl.style.transition = 'transform 0.5s ease'
      titleEl.style.transform  = 'translateX(0)'
    }))
  })

  titleEl.addEventListener('transitionend', () => {
    titleEl.style.transition = ''
    titleEl.style.transform  = ''
  })
}

function isYouTubeSourceUrl(url) {
  try {
    const { hostname } = new URL(url)
    return hostname.includes('youtube.com') || hostname === 'youtu.be'
  } catch { return false }
}

function getProgressPct(item) {
  if (item.progressTrackNum && item.trackCount && item.trackCount >= 2) {
    return Math.min(99, Math.round((item.progressTrackNum / item.trackCount) * 100))
  }
  return item.progressTimePct || 0
}

function updateSetProgress(url, trackNum, onclickStr) {
  const update = { progressTrackNum: trackNum, lastTrackOnclick: onclickStr || null }
  ;['history', 'favorites'].forEach(key => {
    state.store[key] = state.store[key].map(item =>
      item.url === url ? { ...item, ...update } : item
    )
  })
  persist()
  renderHistory()
  renderFavorites()
}

// Directly paint progress bars in history/favorites list items without a full re-render.
function paintProgressBars(url, pct) {
  document.querySelectorAll(`[data-url="${CSS.escape(url)}"]`).forEach(li => {
    let bar = li.querySelector('.set-progress-bar')
    if (!bar) {
      const wrap = document.createElement('div')
      wrap.className = 'set-progress'
      wrap.innerHTML = '<div class="set-progress-bar"></div>'
      li.appendChild(wrap)
      bar = wrap.querySelector('.set-progress-bar')
    }
    bar.style.width = pct + '%'
  })
}

let _fallbackPersistTimer = null

function updateFallbackProgress(url, pct, currentTime) {
  // Mutate in-memory store
  ;['history', 'favorites'].forEach(key => {
    state.store[key] = state.store[key].map(item =>
      item.url === url ? { ...item, progressTimePct: pct, progressTime: currentTime } : item
    )
  })
  // Update DOM immediately (cheap)
  paintProgressBars(url, pct)
  // Throttle the expensive persist + full re-render to once every 10 s
  if (!_fallbackPersistTimer) {
    _fallbackPersistTimer = setTimeout(() => {
      _fallbackPersistTimer = null
      persist()
      renderHistory()
      renderFavorites()
    }, 10_000)
  }
}

function loadSet(item, resume) {
  state.pendingResume     = resume && item.lastTrackOnclick ? item.lastTrackOnclick : null
  state.pendingResumeTime = resume && item.progressTime     ? item.progressTime     : null
  if (isYouTubeSourceUrl(item.url)) {
    hideIntro()
    showLoading('Searching tracklist…')
    window.api.loadSourceUrl(item.url)
  } else {
    navigateTo(item.url)
    hideOverlays()
  }
}

// ── Resume dialog ─────────────────────────────────────────────────────────────

let resumeDialogTarget    = null
let resumeCountdownTimer  = null

function showResumeDialog(item) {
  // Guard: if the dialog is already visible for this same item, do nothing.
  // Without this, re-clicking the sidebar item while the dialog is open would
  // create a second setInterval while the first (stale) one kept ticking,
  // causing the dialog to fire early from the user's perspective.
  if (!resumeDialog.classList.contains('hidden') && resumeDialogTarget === item) return

  // Clear any existing countdown timer before starting a new one.
  if (resumeCountdownTimer) { clearInterval(resumeCountdownTimer); resumeCountdownTimer = null }

  resumeDialogTarget = item
  resumeCountdownNum.textContent = '5'
  resumeDontAsk.checked = false
  resumeDialog.classList.remove('hidden')
  let count = 5
  resumeCountdownTimer = setInterval(() => {
    count--
    if (count <= 0) {
      clearInterval(resumeCountdownTimer)
      resumeCountdownTimer = null
      doResumeChoice(true)
    } else {
      resumeCountdownNum.textContent = count
    }
  }, 1000)
}

function closeResumeDialog() {
  if (resumeCountdownTimer) { clearInterval(resumeCountdownTimer); resumeCountdownTimer = null }
  resumeDialog.classList.add('hidden')
  resumeDialogTarget = null
}

function doResumeChoice(resume) {
  if (resumeDontAsk.checked) {
    if (!state.store.settings) state.store.settings = {}
    state.store.settings.resumeBehavior = resume ? 'always' : 'never'
    persist()
    syncResumeSettingUI()
  }
  const item = resumeDialogTarget
  closeResumeDialog()
  loadSet(item, resume)
}

function syncResumeSettingUI() {
  const val = state.store.settings?.resumeBehavior || 'ask'
  document.querySelectorAll('input[name="resume-behavior"]').forEach(r => {
    r.checked = r.value === val
  })
}

function makeSetListItem(item, onRemove) {
  const li = document.createElement('li')
  li.dataset.url = item.url
  const thumbHtml = item.thumbnailUrl
    ? `<img class="set-item-thumb" src="${escHtml(item.thumbnailUrl)}" alt="" loading="lazy" />`
    : `<div class="set-item-thumb set-item-thumb-empty"></div>`
  const pct = getProgressPct(item)
  const progressHtml = pct > 0
    ? `<div class="set-progress"><div class="set-progress-bar" style="width:${pct}%"></div></div>`
    : ''
  li.innerHTML = `
    ${thumbHtml}
    <div class="set-item-meta">
      <div class="set-item-title">${escHtml(item.title)}</div>
      <div class="set-item-src">${item.trackCount != null ? `${item.trackCount} tracks` : 'tracklist unavailable'}</div>
    </div>
    ${onRemove ? '<button class="set-item-remove" title="Remove">✕</button>' : ''}
    ${progressHtml}
  `
  li.addEventListener('click', (e) => {
    if (e.target.classList.contains('set-item-remove')) return
    const hasProgress = !!(item.progressTrackNum > 1 && item.lastTrackOnclick)
                     || !!(item.progressTimePct > 5 && item.progressTime)
    const resumeSetting = state.store.settings?.resumeBehavior || 'ask'
    if (hasProgress) {
      if      (resumeSetting === 'always') loadSet(item, true)
      else if (resumeSetting === 'never')  loadSet(item, false)
      else                                 showResumeDialog(item)
    } else {
      loadSet(item, false)
    }
  })
  if (onRemove) {
    li.querySelector('.set-item-remove').addEventListener('click', (e) => {
      e.stopPropagation()
      onRemove()
    })
  }
  wireMarquee(li)
  return li
}

// ── Tracklist panel ───────────────────────────────────────────────────────────

function createTrackItem(track, compact) {
  const li = document.createElement('li')
  li.className = 'track-item' +
    (track.isId             ? ' track-id'      : '') +
    (track.isWWith          ? ' track-with'    : '') +
    (track.isMashupComponent ? ' track-mashup' : '')
  li.dataset.trackNum = track.trackNum || ''

  const numHtml = track.isWWith
    ? `<span class="track-num track-num-with">w/</span>`
    : `<span class="track-num">${track.trackNum || ''}</span>`

  const artHtml = compact ? '' : (
    track.artUrl
      ? `<img class="track-art" src="${escHtml(track.artUrl)}" loading="lazy" alt="" />`
      : `<div class="track-art track-art-empty"></div>`
  )

  const titleText  = track.isId ? 'ID — ID' : escHtml(track.title || track.raw || '?')
  const artistHtml = (!track.isId && track.artist && !compact)
    ? `<span class="track-artist">${escHtml(track.artist)}</span>`
    : ''

  const cueHtml = track.cueDisplay
    ? `<span class="track-cue">${escHtml(track.cueDisplay)}</span>`
    : ''

  li.innerHTML = `
    ${numHtml}
    ${artHtml}
    <div class="track-info">
      <span class="track-title">${titleText}</span>
      ${artistHtml}
    </div>
    ${cueHtml}
  `

  if (track.onclickStr && !track.isMashupComponent) {
    li.addEventListener('click', () => window.api.playerGotoTrack(track.onclickStr))
  }

  return li
}

function renderTracklist(tracks) {
  tracklistList.innerHTML = ''
  tracklistCompactList.innerHTML = ''

  tracks.forEach(track => {
    tracklistList.appendChild(createTrackItem(track, false))
    tracklistCompactList.appendChild(createTrackItem(track, false))
  })

  mainContent.classList.toggle('has-tracklist', tracks.length > 0)
}

function highlightTracklistByNum(trackNum) {
  for (const list of [tracklistList, tracklistCompactList]) {
    let found = null
    list.querySelectorAll('.track-item').forEach(li => {
      const active = li.dataset.trackNum === String(trackNum)
      li.classList.toggle('active', active)
      if (active) found = li
    })
    if (found) found.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
}

function clearTracklist() {
  tracklistList.innerHTML = ''
  tracklistCompactList.innerHTML = ''
  mainContent.classList.remove('has-tracklist')
  tracklistUnavailableEl.classList.add('hidden')
}

// ── Right panel ───────────────────────────────────────────────────────────────

function toggleRightPanel() {
  const open = rightPanel.classList.toggle('collapsed')
  // 'collapsed' class present = panel is closed
  rightPanelHandle.classList.toggle('hidden', rightPanel.classList.contains('collapsed'))
  btnTracklistToggle.classList.toggle('active', !rightPanel.classList.contains('collapsed'))
  if (!state.store.settings) state.store.settings = {}
  state.store.settings.rightPanelOpen = !rightPanel.classList.contains('collapsed')
  persist()
}

function restoreRightPanelWidth() {
  const w = state.store.settings?.rightPanelWidth || 260
  rightPanel.style.width = w + 'px'
}

function wireRightPanelResize() {
  let isResizing = false

  const dragOverlay = document.createElement('div')
  dragOverlay.style.cssText =
    'position:fixed;inset:0;z-index:99999;cursor:col-resize;display:none'
  document.body.appendChild(dragOverlay)

  rightPanelHandle.addEventListener('mousedown', (e) => {
    isResizing = true
    dragOverlay.style.display = 'block'
    rightPanelHandle.classList.add('dragging')
    e.preventDefault()
  })

  const onMove = (e) => {
    if (!isResizing) return
    // Dragging left = wider panel; width = distance from cursor to right edge
    const w = Math.max(180, Math.min(400, window.innerWidth - e.clientX))
    rightPanel.style.width = w + 'px'
  }

  const onUp = () => {
    if (!isResizing) return
    isResizing = false
    dragOverlay.style.display = 'none'
    rightPanelHandle.classList.remove('dragging')
    const w = parseInt(rightPanel.style.width, 10)
    if (w) {
      if (!state.store.settings) state.store.settings = {}
      state.store.settings.rightPanelWidth = w
      persist()
    }
  }

  dragOverlay.addEventListener('mousemove', onMove)
  dragOverlay.addEventListener('mouseup', onUp)
  document.addEventListener('mouseup', onUp)
}

// ── Theme ─────────────────────────────────────────────────────────────────────

function applyTheme(theme, shouldPersist = true) {
  document.documentElement.setAttribute('data-theme', theme)
  document.querySelectorAll('.theme-swatch').forEach(el => {
    el.classList.toggle('active', el.dataset.themeId === theme)
  })
  if (shouldPersist) {
    if (!state.store.settings) state.store.settings = {}
    state.store.settings.theme = theme
    window.api.setTheme(theme)
  }
}

// ── Last.fm auth ──────────────────────────────────────────────────────────────

function showLfmConnected(name) {
  lfmUsername.textContent = name
  lfmConnected.classList.remove('hidden')
  lfmDisconnected.classList.add('hidden')
}

function showLfmDisconnected() {
  lfmConnected.classList.add('hidden')
  lfmDisconnected.classList.remove('hidden')
  lfmConnectStatus.textContent = ''
  btnLfmConnect.disabled = false
  btnLfmConnect.textContent = 'Connect Last.fm'
}

async function loadSettings() {
  const session = await window.api.lfmSession()
  if (session?.name) showLfmConnected(session.name)
  else showLfmDisconnected()
}

// ── Persist ───────────────────────────────────────────────────────────────────

function persist() {
  window.api.setStore(state.store)
}

// ── Now-playing reset ─────────────────────────────────────────────────────────

function resetNowPlaying() {
  state.nowPlaying         = null
  state.currentSetTitle    = ''
  state.currentSetUrl      = ''
  state.currentSource      = ''
  state.currentThumbnailUrl = null
  state.isTrackPlaying     = false
  npTrack.textContent    = ''
  npArtist.textContent   = ''
  npTracknum.textContent = ''
  npSet.textContent      = ''
  npSource.textContent   = ''
  ppIcon.innerHTML       = icon(ICON.play, 16)
  btnPlayPause.classList.remove('playing')
  updateBookmarkBtn()
}

// ── Overlays ──────────────────────────────────────────────────────────────────

let pendingPlayUrl = null

function showLoading(msg = 'Loading…') {
  loadingMsg.textContent = msg
  loadingOverlay.classList.remove('hidden')
  noTracklistMsg.classList.add('hidden')
  noTracklistPrompt.classList.add('hidden')
  // A new search is starting — clear the unavailable state + stale tracklist
  state.tracklistUnavailable = false
  clearTracklist()
  refreshScrobbleBadge()
}

function showNoTracklist() {
  noTracklistMsg.classList.remove('hidden')
  loadingOverlay.classList.add('hidden')
  noTracklistPrompt.classList.add('hidden')
}

function showNoTracklistPrompt(url) {
  pendingPlayUrl = url
  noTracklistPrompt.classList.remove('hidden')
  loadingOverlay.classList.add('hidden')
  noTracklistMsg.classList.add('hidden')
  resetNowPlaying()
  state.tracklistUnavailable = true
  refreshScrobbleBadge()
}

function hideOverlays() {
  loadingOverlay.classList.add('hidden')
  noTracklistMsg.classList.add('hidden')
  noTracklistPrompt.classList.add('hidden')
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireEvents() {
  btnYT.addEventListener('click', () => {
    state.source = 'youtube'
    btnYT.classList.add('active')
    btnSC.classList.remove('active')
    navigateToSearch()
  })

  btnSC.addEventListener('click', () => {
    state.source = 'soundcloud'
    btnSC.classList.add('active')
    btnYT.classList.remove('active')
    navigateToSearch()
  })

  searchBtn.addEventListener('click', doSearch)

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      doSearch() // hides dropdown inside doSearch()
    } else if (e.key === 'Escape') {
      hideSearchDropdown()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      updateDropdownFocus(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      updateDropdownFocus(-1)
    }
  })

  searchInput.addEventListener('input', () => {
    const q = searchInput.value.trim().toLowerCase()
    if (!q) { hideSearchDropdown(); return }
    const matches = (state.store.searchQueries || [])
      .filter(s => s.toLowerCase().includes(q))
      .slice(0, 8)
    if (matches.length === 0) { hideSearchDropdown(); return }
    showSearchDropdown(matches)
  })

  searchInput.addEventListener('blur', () => {
    // Small delay so mousedown on an item fires before blur hides the list
    setTimeout(hideSearchDropdown, 150)
  })

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-box')) hideSearchDropdown()
  })

  btnDevtools.addEventListener('click', () => window.api.openDevTools())
  btnSidebarToggle.addEventListener('click', () => toggleSidebar())
  btnTracklistToggle.addEventListener('click', () => toggleRightPanel())

  navBtns.forEach((btn) =>
    btn.addEventListener('click', () => switchSidebarPanel(btn.dataset.panel))
  )

  btnBookmark.addEventListener('click', () => {
    if (!state.currentSetUrl) return
    if (isFavorited(state.currentSetUrl)) {
      removeFromFavorites(state.currentSetUrl)
    } else {
      // Include whatever we already know at bookmark time — trackCount from the
      // current tracklist, plus progress if a track has played this session.
      const histEntry = state.store.history.find(h => h.url === state.currentSetUrl)
      addToFavorites({
        title:            state.currentSetTitle || state.currentSetUrl,
        url:              state.currentSetUrl,
        source:           state.currentSource,
        thumbnailUrl:     state.currentThumbnailUrl,
        trackCount:       state.currentTracks.length || histEntry?.trackCount || undefined,
        progressTrackNum: histEntry?.progressTrackNum || undefined,
        lastTrackOnclick: histEntry?.lastTrackOnclick || undefined,
      })
      syncProgressToItem(state.currentSetUrl)
      updateBookmarkBtn()
    }
  })

  btnLfmConnect.addEventListener('click', async () => {
    btnLfmConnect.disabled = true
    btnLfmConnect.textContent = 'Waiting…'
    lfmConnectStatus.textContent = 'Authorize in the browser window that just opened.'
    try {
      const session = await window.api.lfmConnect()
      showLfmConnected(session.name)
    } catch (e) {
      btnLfmConnect.disabled = false
      btnLfmConnect.textContent = 'Connect Last.fm'
      lfmConnectStatus.textContent = e.message || 'Connection failed.'
    }
  })

  btnLfmDisconnect.addEventListener('click', async () => {
    await window.api.lfmDisconnect()
    showLfmDisconnected()
    state.lfmStatus = 'unconfigured'
    state.isTrackPlaying = false
    refreshScrobbleBadge()
  })

  webview.addEventListener('did-navigate', (e) => {
    const url = e.url || ''
    if (!url.includes('1001tracklists.com') && !url.includes('set79.com')) {
      hideOverlays()
      ppIcon.innerHTML = icon(ICON.play, 16)
      btnPlayPause.classList.remove('playing')
      npTracknum.textContent = ''
      state.isTrackPlaying = false
      refreshScrobbleBadge()
    }
  })

  btnPlayAnyway.addEventListener('click', () => {
    if (!pendingPlayUrl) return
    const url = pendingPlayUrl
    pendingPlayUrl = null
    navigateTo(url)
  })

  btnPlayPause.addEventListener('click', () => window.api.playerToggle())

  document.querySelectorAll('.theme-swatch').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.themeId))
  })

  sidebarFooter.addEventListener('click', (e) => {
    const link = e.target.closest('.sidebar-footer-link')
    if (link?.dataset.href) window.api.openExternal(link.dataset.href)
  })

  // Resume dialog
  btnResumeStart.addEventListener('click',  () => doResumeChoice(false))
  btnResumeResume.addEventListener('click', () => doResumeChoice(true))
  resumeDialog.addEventListener('click', (e) => {
    if (e.target === resumeDialog) doResumeChoice(false)  // backdrop click = start fresh
  })

  // Resume behavior setting radio buttons
  document.querySelectorAll('input[name="resume-behavior"]').forEach(r => {
    r.addEventListener('change', () => {
      if (!state.store.settings) state.store.settings = {}
      state.store.settings.resumeBehavior = r.value
      persist()
    })
  })

  wireSidebarResize()
  wireRightPanelResize()
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Start ─────────────────────────────────────────────────────────────────────

init()
