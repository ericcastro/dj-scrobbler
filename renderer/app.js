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
  store: { favorites: [], history: [], searchQueries: [], settings: {} },
}

// ── DOM refs ────────────────────────────────────────────────────────────────

const webview          = document.getElementById('webview')
const searchInput      = document.getElementById('search-input')
const searchSuggestions= document.getElementById('search-suggestions')
const searchBtn        = document.getElementById('search-btn')
const btnYT            = document.getElementById('btn-yt')
const btnSC            = document.getElementById('btn-sc')
const btnBookmark      = document.getElementById('btn-bookmark')
const btnDevtools      = document.getElementById('btn-devtools')
const btnSidebarToggle = document.getElementById('btn-sidebar-toggle')
const sidebar          = document.getElementById('sidebar')
const loadingOverlay   = document.getElementById('loading-overlay')
const loadingMsg       = document.getElementById('loading-msg')
const noTracklistMsg   = document.getElementById('no-tracklist-msg')
const navBtns          = document.querySelectorAll('.nav-btn')
const panels           = document.querySelectorAll('.sidebar-panel')
const favoritesList    = document.getElementById('favorites-list')
const historyList      = document.getElementById('history-list')
const favEmpty         = document.getElementById('fav-empty')
const histEmpty        = document.getElementById('hist-empty')
const btnPlayPause     = document.getElementById('btn-playpause')
const ppIcon           = document.getElementById('pp-icon')
const npTracknum       = document.getElementById('np-tracknum')
const npTrack          = document.getElementById('np-track')
const npArtist         = document.getElementById('np-artist')
const npSet            = document.getElementById('np-set')
const npSource         = document.getElementById('np-source')
const scrobbleBadge    = document.getElementById('scrobble-badge')
const scrobbleDot      = document.getElementById('scrobble-dot')
const scrobbleLabel    = document.getElementById('scrobble-label')
const btnLfmConnect    = document.getElementById('btn-lfm-connect')
const btnLfmDisconnect = document.getElementById('btn-lfm-disconnect')
const lfmConnected     = document.getElementById('lfm-connected')
const lfmDisconnected  = document.getElementById('lfm-disconnected')
const lfmUsername      = document.getElementById('lfm-username')
const lfmConnectStatus = document.getElementById('lfm-connect-status')

// ── Boot ────────────────────────────────────────────────────────────────────

let webviewReady = false
let pendingNav = null

function navigateTo(url) {
  if (webviewReady) webview.loadURL(url)
  else pendingNav = url
}

async function init() {
  state.store = await window.api.getStore()
  renderFavorites()
  renderHistory()
  renderSearchSuggestions()
  await loadSettings()
  updateScrobbleBadge(await window.api.lfmStatusGet())

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
  })

  window.api.on('lfm-status', (status) => updateScrobbleBadge(status))
}

// ── Scrobble badge ────────────────────────────────────────────────────────────

const BADGE = {
  unconfigured: { label: 'Not configured', cls: '' },
  ok:           { label: 'Scrobbling',     cls: 'ok' },
  error:        { label: 'Error',          cls: 'error' },
}

function updateScrobbleBadge(status) {
  const cfg = BADGE[status] || BADGE.unconfigured
  scrobbleBadge.className = cfg.cls
  scrobbleLabel.textContent = cfg.label
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function switchSidebarPanel(name) {
  navBtns.forEach((b) => b.classList.toggle('active', b.dataset.panel === name))
  panels.forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`))
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
  btnSidebarToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'))

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
    updateScrobbleBadge('unconfigured')
  })

  webview.addEventListener('did-navigate', (e) => {
    const url = e.url || ''
    if (!url.includes('1001tracklists.com') && !url.includes('set79.com')) {
      hideOverlays()
      ppIcon.textContent = '▶'
      btnPlayPause.classList.remove('playing')
      npTracknum.textContent = ''
    }
  })

  btnPlayPause.addEventListener('click', () => window.api.playerToggle())
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Start ─────────────────────────────────────────────────────────────────────

init()
