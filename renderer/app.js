/**
 * Renderer process — all UI logic.
 * window.api is exposed by preload.js via contextBridge.
 * Navigation interception and now-playing polling run in main.js (more reliable).
 */

// ── State ──────────────────────────────────────────────────────────────────

const state = {
  source: 'youtube',
  currentSetTitle: '',
  currentSetUrl: '',
  currentSource: '',
  nowPlaying: null,
  store: { favorites: [], history: [], settings: {} },
}

// ── DOM refs ────────────────────────────────────────────────────────────────

const webview          = document.getElementById('webview')
const searchInput      = document.getElementById('search-input')
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
const btnLfmConnect    = document.getElementById('btn-lfm-connect')
const btnLfmDisconnect = document.getElementById('btn-lfm-disconnect')
const lfmConnected     = document.getElementById('lfm-connected')
const lfmDisconnected  = document.getElementById('lfm-disconnected')
const lfmUsername      = document.getElementById('lfm-username')
const lfmConnectStatus = document.getElementById('lfm-connect-status')

// ── Boot ────────────────────────────────────────────────────────────────────

// Webview navigation must happen via loadURL(), and only after dom-ready.
let webviewReady = false
let pendingNav = null

function navigateTo(url) {
  if (webviewReady) {
    webview.loadURL(url)
  } else {
    pendingNav = url
  }
}

async function init() {
  state.store = await window.api.getStore()
  renderFavorites()
  renderHistory()
  await loadSettings()

  // Webview methods are only available after dom-ready
  webview.addEventListener('dom-ready', () => {
    webviewReady = true
    if (pendingNav) {
      webview.loadURL(pendingNav)
      pendingNav = null
    }
  })

  wireEvents()
  wireMainEvents()
  navigateToSearch()
}

// ── Search ──────────────────────────────────────────────────────────────────

function navigateToSearch(query = '') {
  hideOverlays()
  const q = encodeURIComponent(query)
  const url = state.source === 'youtube'
    ? (q ? `https://www.youtube.com/results?search_query=${q}` : 'https://www.youtube.com')
    : (q ? `https://soundcloud.com/search?q=${q}` : 'https://soundcloud.com')
  navigateTo(url)
}

function doSearch() {
  navigateToSearch(searchInput.value.trim())
}

// ── Messages pushed from main process ────────────────────────────────────────

function wireMainEvents() {
  // Navigation status updates from main.js
  window.api.on('wv-status', (status) => {
    switch (status.type) {
      case 'loading':
        showLoading(status.msg)
        break
      case 'no-tracklist':
        showNoTracklist()
        break
      case 'hide-overlay':
        hideOverlays()
        break
    }
  })

  // Main detected a tracklist page finished loading
  window.api.on('tracklist-loaded', ({ url, title }) => {
    state.currentSetTitle = title
    state.currentSetUrl   = url
    state.currentSource   = url.includes('1001tracklists') ? '1001tl' : 'set79'
    npSet.textContent     = title
    npSource.textContent  = url.includes('1001tracklists') ? '1001Tracklists' : 'set79'
    updateBookmarkBtn()
    addToHistory({ title, url, source: state.currentSource })
  })

  // Now-playing update from main's polling loop
  window.api.on('now-playing', (data) => {
    state.nowPlaying = data
    npTrack.textContent    = data.title  || data.raw || '—'
    npArtist.textContent   = data.artist || '—'
    npTracknum.textContent = data.trackNum ? `#${data.trackNum}` : ''
    const playing = data.isPlaying !== false   // treat undefined as playing
    ppIcon.textContent = playing ? '⏸' : '▶'
    btnPlayPause.classList.toggle('playing', playing)
  })
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
  favs.forEach((item) =>
    favoritesList.appendChild(makeSetListItem(item, () => removeFromFavorites(item.url)))
  )
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
  })

  // Overlay cleanup when webview navigates away from tracklists
  webview.addEventListener('did-navigate', (e) => {
    const url = e.url || ''
    if (!url.includes('1001tracklists.com') && !url.includes('set79.com')) {
      hideOverlays()
      ppIcon.textContent = '▶'
      btnPlayPause.classList.remove('playing')
      npTracknum.textContent = ''
    }
  })

  // Play/pause button
  btnPlayPause.addEventListener('click', () => window.api.playerToggle())
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Start ─────────────────────────────────────────────────────────────────────

init()
