/**
 * Renderer process — all UI logic.
 * window.api is exposed by preload.js via contextBridge.
 */

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  source: 'youtube',
  currentSetTitle: '',
  currentSetUrl: '',
  currentSource: '',
  nowPlaying: null,
  lfmStatus: 'unconfigured',   // 'unconfigured' | 'ok' | 'error'
  isTrackPlaying: false,
  store: { favorites: [], history: [], searchQueries: [], settings: {} },
}

// ── DOM refs ────────────────────────────────────────────────────────────────

const webview            = document.getElementById('webview')
const searchInput        = document.getElementById('search-input')
const searchSuggestions  = document.getElementById('search-suggestions')
const searchBtn          = document.getElementById('search-btn')
const btnYT              = document.getElementById('btn-yt')
const btnSC              = document.getElementById('btn-sc')
const btnBookmark        = document.getElementById('btn-bookmark')
const btnDevtools        = document.getElementById('btn-devtools')
const btnSidebarToggle   = document.getElementById('btn-sidebar-toggle')
const sidebar            = document.getElementById('sidebar')
const sidebarResizeHandle= document.getElementById('sidebar-resize-handle')
const sidebarFooter      = document.getElementById('sidebar-footer')
const loadingOverlay     = document.getElementById('loading-overlay')
const loadingMsg         = document.getElementById('loading-msg')
const noTracklistMsg     = document.getElementById('no-tracklist-msg')
const navBtns            = document.querySelectorAll('.nav-btn')
const panels             = document.querySelectorAll('.sidebar-panel')
const favoritesList      = document.getElementById('favorites-list')
const historyList        = document.getElementById('history-list')
const favEmpty           = document.getElementById('fav-empty')
const histEmpty          = document.getElementById('hist-empty')
const btnPlayPause       = document.getElementById('btn-playpause')
const ppIcon             = document.getElementById('pp-icon')
const npTracknum         = document.getElementById('np-tracknum')
const npTrack            = document.getElementById('np-track')
const npArtist           = document.getElementById('np-artist')
const npSet              = document.getElementById('np-set')
const npSource           = document.getElementById('np-source')
const scrobbleBadge      = document.getElementById('scrobble-badge')
const scrobbleLabel      = document.getElementById('scrobble-label')
const btnLfmConnect      = document.getElementById('btn-lfm-connect')
const btnLfmDisconnect   = document.getElementById('btn-lfm-disconnect')
const lfmConnected       = document.getElementById('lfm-connected')
const lfmDisconnected    = document.getElementById('lfm-disconnected')
const lfmUsername        = document.getElementById('lfm-username')
const lfmConnectStatus   = document.getElementById('lfm-connect-status')
const footerAppName      = document.getElementById('footer-app-name')

// ── Boot ────────────────────────────────────────────────────────────────────

const DEFAULT_SIDEBAR_W = 220

let webviewReady = false
let pendingNav = null

function navigateTo(url) {
  if (webviewReady) webview.loadURL(url)
  else pendingNav = url
}

async function init() {
  state.store = await window.api.getStore()

  applyTheme(state.store.settings?.theme || 'neon-night', false)
  restoreSidebarWidth()

  // Footer version from main process
  const version = await window.api.getVersion()
  footerAppName.textContent = `DJ Scrobbler v${version}`

  renderFavorites()
  renderHistory()
  renderSearchSuggestions()
  await loadSettings()

  state.lfmStatus = await window.api.lfmStatusGet()
  refreshScrobbleBadge()

  webview.addEventListener('dom-ready', () => {
    webviewReady = true
    if (pendingNav) { webview.loadURL(pendingNav); pendingNav = null }
  })

  wireEvents()
  wireMainEvents()
  navigateToSearch()
}

// ── Search ──────────────────────────────────────────────────────────────────

const SOURCE_URLS = {
  youtube:    q => q ? `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` : 'https://www.youtube.com',
  soundcloud: q => q ? `https://soundcloud.com/search?q=${encodeURIComponent(q)}` : 'https://soundcloud.com',
}

function navigateToSearch(query = '') {
  hideOverlays()
  navigateTo(SOURCE_URLS[state.source](query))
}

function doSearch() {
  const q = searchInput.value.trim()
  if (q) saveSearchQuery(q)
  navigateToSearch(q)
}

// ── Search history ───────────────────────────────────────────────────────────

function saveSearchQuery(query) {
  if (!query) return
  const queries = state.store.searchQueries || []
  const deduped = [query, ...queries.filter(q => q !== query)].slice(0, 50)
  state.store.searchQueries = deduped
  persist()
  renderSearchSuggestions()
}

function renderSearchSuggestions() {
  searchSuggestions.innerHTML = ''
  const queries = state.store.searchQueries || []
  queries.forEach(q => {
    const opt = document.createElement('option')
    opt.value = q
    searchSuggestions.appendChild(opt)
  })
}

// ── Messages from main process ────────────────────────────────────────────────

function wireMainEvents() {
  window.api.on('wv-status', (status) => {
    switch (status.type) {
      case 'loading':      showLoading(status.msg); break
      case 'no-tracklist': showNoTracklist(); break
      case 'hide-overlay': hideOverlays(); break
    }
  })

  window.api.on('tracklist-loaded', ({ url, title }) => {
    state.currentSetTitle = title
    state.currentSetUrl   = url
    state.currentSource   = url.includes('1001tracklists') ? '1001tl' : 'set79'
    npSet.textContent     = title
    npSource.textContent  = url.includes('1001tracklists') ? '1001Tracklists' : 'set79'
    updateBookmarkBtn()
    addToHistory({ title, url, source: state.currentSource })
  })

  window.api.on('now-playing', (data) => {
    state.nowPlaying = data
    npTrack.textContent    = data.title  || data.raw || '—'
    npArtist.textContent   = data.artist || '—'
    npTracknum.textContent = data.trackNum ? `#${data.trackNum}` : ''
    const playing = data.isPlaying !== false
    ppIcon.textContent = playing ? '⏸' : '▶'
    btnPlayPause.classList.toggle('playing', playing)
    state.isTrackPlaying = playing
    refreshScrobbleBadge()
  })

  window.api.on('lfm-status', (status) => {
    state.lfmStatus = status
    refreshScrobbleBadge()
  })

  window.api.on('menu-toggle-sidebar', () => toggleSidebar())
  window.api.on('menu-reload', () => navigateToSearch())
}

// ── Scrobble badge ────────────────────────────────────────────────────────────

const BADGE = {
  unconfigured: { label: 'Scrobbling not configured', cls: '' },
  enabled:      { label: 'Scrobbling enabled',        cls: '' },  // muted, same as unconfigured
  scrobbling:   { label: 'Scrobbling',                cls: 'ok' },
  error:        { label: 'Error',                     cls: 'error' },
}

function refreshScrobbleBadge() {
  let key
  if (state.lfmStatus === 'error') key = 'error'
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

  sidebarResizeHandle.addEventListener('mousedown', (e) => {
    isResizing = true
    sidebarResizeHandle.classList.add('dragging')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    e.preventDefault()
  })

  document.addEventListener('mousemove', (e) => {
    if (!isResizing) return
    const min = 160, max = 480
    const w = Math.max(min, Math.min(max, e.clientX))
    sidebar.style.width = w + 'px'
  })

  document.addEventListener('mouseup', () => {
    if (!isResizing) return
    isResizing = false
    sidebarResizeHandle.classList.remove('dragging')
    document.body.style.cursor = ''
    document.body.style.userSelect = ''

    const w = parseInt(sidebar.style.width, 10)
    if (w) {
      if (!state.store.settings) state.store.settings = {}
      state.store.settings.sidebarWidth = w
      persist()
    }
  })
}

// ── Favorites ────────────────────────────────────────────────────────────────

function addToFavorites(item) {
  if (state.store.favorites.find((f) => f.url === item.url)) return
  state.store.favorites.unshift(item)
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
  btnBookmark.classList.toggle('active', on)
  btnBookmark.textContent = on ? '★' : '☆'
}

// ── History ──────────────────────────────────────────────────────────────────

function addToHistory(item) {
  state.store.history = state.store.history.filter((h) => h.url !== item.url)
  state.store.history.unshift({ ...item, playedAt: Date.now() })
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

function makeSetListItem(item, onRemove) {
  const li = document.createElement('li')
  li.innerHTML = `
    <div class="set-item-title">${escHtml(item.title)}</div>
    <div class="set-item-src">${escHtml(item.source === '1001tl' ? '1001Tracklists' : 'set79')}</div>
    ${onRemove ? '<button class="set-item-remove" title="Remove">✕</button>' : ''}
  `
  li.addEventListener('click', (e) => {
    if (e.target.classList.contains('set-item-remove')) return
    navigateTo(item.url)
    hideOverlays()
  })
  if (onRemove) {
    li.querySelector('.set-item-remove').addEventListener('click', (e) => {
      e.stopPropagation()
      onRemove()
    })
  }
  return li
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

// ── Overlays ──────────────────────────────────────────────────────────────────

function showLoading(msg = 'Loading…') {
  loadingMsg.textContent = msg
  loadingOverlay.classList.remove('hidden')
  noTracklistMsg.classList.add('hidden')
}

function showNoTracklist() {
  noTracklistMsg.classList.remove('hidden')
  loadingOverlay.classList.add('hidden')
}

function hideOverlays() {
  loadingOverlay.classList.add('hidden')
  noTracklistMsg.classList.add('hidden')
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
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch() })

  btnDevtools.addEventListener('click', () => window.api.openDevTools())
  btnSidebarToggle.addEventListener('click', () => toggleSidebar())

  navBtns.forEach((btn) =>
    btn.addEventListener('click', () => switchSidebarPanel(btn.dataset.panel))
  )

  btnBookmark.addEventListener('click', () => {
    if (!state.currentSetUrl) return
    if (isFavorited(state.currentSetUrl)) {
      removeFromFavorites(state.currentSetUrl)
    } else {
      addToFavorites({ title: state.currentSetTitle || state.currentSetUrl, url: state.currentSetUrl, source: state.currentSource })
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
      ppIcon.textContent = '▶'
      btnPlayPause.classList.remove('playing')
      npTracknum.textContent = ''
      state.isTrackPlaying = false
      refreshScrobbleBadge()
    }
  })

  btnPlayPause.addEventListener('click', () => window.api.playerToggle())

  document.querySelectorAll('.theme-swatch').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.themeId))
  })

  // Sidebar footer links — open in default browser
  sidebarFooter.addEventListener('click', (e) => {
    const link = e.target.closest('.sidebar-footer-link')
    if (link?.dataset.href) window.api.openExternal(link.dataset.href)
  })

  wireSidebarResize()
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Start ─────────────────────────────────────────────────────────────────────

init()
