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
  currentTracklistUrl: null,
  currentTracklistProvider: null,
  currentThumbnailUrl: null,
  nowPlaying: null,
  playbackCurrentTime: 0,
  playbackDuration: 0,
  lfmStatus: 'unconfigured',
  isTrackPlaying: false,
  isIdTrack: false,
  tracklistUnavailable: false,
  store: { favorites: [], history: [], searchQueries: [], settings: {} },
  currentTracks: [],       // full track array from tracklist-data, used for progress lookups
  pendingResumeTime: null, // seconds to seek to after first playback-progress tick
}

// ── DOM refs ────────────────────────────────────────────────────────────────

const webview            = document.getElementById('webview')
const browserWebview     = document.getElementById('browser-webview')
const searchInput        = document.getElementById('search-input')
const searchDropdown     = document.getElementById('search-dropdown')
const searchBtn          = document.getElementById('search-btn')
const btnYT              = document.getElementById('btn-yt')
const btnSC              = document.getElementById('btn-sc')
const btnBookmark        = document.getElementById('btn-bookmark')
const btnVideoMode       = document.getElementById('btn-video-mode')
const btnVideoDock       = document.getElementById('btn-video-dock')
const btnVideoFullscreen = document.getElementById('btn-video-fullscreen')
const btnVideoHide       = document.getElementById('btn-video-hide')
const btnDevtools        = document.getElementById('btn-devtools')
const btnSidebarToggle   = document.getElementById('btn-sidebar-toggle')
const sidebar            = document.getElementById('sidebar')
const sidebarResizeHandle= document.getElementById('sidebar-resize-handle')
const sidebarFooter      = document.getElementById('sidebar-footer')
const sidebarMiniPlayerSlot = document.getElementById('sidebar-mini-player-slot')
const introScreen        = document.getElementById('intro-screen')
const introGreeting      = document.getElementById('intro-greeting')
const loadingOverlay     = document.getElementById('loading-overlay')
const loadingMsg         = document.getElementById('loading-msg')
const playerStatusOverlay = document.getElementById('player-status-overlay')
const playerStatusTitle  = document.getElementById('player-status-title')
const playerStatusSub    = document.getElementById('player-status-sub')
const noTracklistMsg     = document.getElementById('no-tracklist-msg')
const noTracklistPrompt  = document.getElementById('no-tracklist-prompt')
const noTlPromptTitle    = document.getElementById('no-tl-prompt-title')
const noTlPromptSub      = document.querySelector('.no-tl-prompt-sub')
const btnPlayAnyway      = document.getElementById('btn-play-anyway')
const btnRetryLoad       = document.getElementById('btn-retry-load')
const videoControls      = document.getElementById('video-controls')
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
const tracklistUnavailableTitle = document.getElementById('tracklist-unavailable-title')
const tracklistUnavailableSub   = document.getElementById('tracklist-unavailable-sub')
const tracklistCompactList  = document.getElementById('tracklist-compact-list')
const rightPanel            = document.getElementById('right-panel')
const rightPanelHandle      = document.getElementById('right-panel-handle')
const btnTracklistToggle    = document.getElementById('btn-tracklist-toggle')
const btnPlayPause          = document.getElementById('btn-playpause')
const btnPrevTrack          = document.getElementById('btn-prev-track')
const btnNextTrack          = document.getElementById('btn-next-track')
const ppIcon             = document.getElementById('pp-icon')
const playbackProgress      = document.getElementById('playback-progress')
const playbackProgressTrack = document.getElementById('playback-progress-track')
const playbackProgressFill  = document.getElementById('playback-progress-fill')
const playbackProgressSegments = document.getElementById('playback-progress-segments')
const playbackProgressThumb = document.getElementById('playback-progress-thumb')
const playbackProgressTooltip = document.getElementById('playback-progress-tooltip')
const playbackProgressTooltipArt = document.getElementById('playback-progress-tooltip-art')
const playbackProgressTooltipTitle = document.getElementById('playback-progress-tooltip-title')
const playbackProgressTooltipArtist = document.getElementById('playback-progress-tooltip-artist')
const playbackElapsed       = document.getElementById('playback-elapsed')
const playbackRemaining     = document.getElementById('playback-remaining')
const npTracknum         = document.getElementById('np-tracknum')
const npTrack            = document.getElementById('np-track')
const npTrackText        = document.getElementById('np-track-text')
const npArtist           = document.getElementById('np-artist')
const npSet              = document.getElementById('np-set')
const npSource           = document.getElementById('np-source')
const resumeDialog        = document.getElementById('resume-dialog')
const resumeCountdownNum  = document.getElementById('resume-countdown-num')
const resumeDontAsk       = document.getElementById('resume-dont-ask')
const btnResumeStart      = document.getElementById('btn-resume-start')
const btnResumeResume     = document.getElementById('btn-resume-resume')
const supportDialog       = document.getElementById('support-dialog')
const supportDialogTitle  = document.getElementById('support-dialog-title')
const supportDialogSub    = document.getElementById('support-dialog-sub')
const btnSupportGithub    = document.getElementById('btn-support-github')
const btnSupportEmail     = document.getElementById('btn-support-email')
const btnSupportClose     = document.getElementById('btn-support-close')
const btnCheckUpdates     = document.getElementById('btn-check-updates')
const updateSettingsStatus = document.getElementById('update-settings-status')
const updatesDisableNotifications = document.getElementById('updates-disable-notifications')
const updateDialog        = document.getElementById('update-dialog')
const updateDialogTitle   = document.getElementById('update-dialog-title')
const updateDialogSub     = document.getElementById('update-dialog-sub')
const updateChangelog     = document.getElementById('update-changelog')
const updateDisableNotifications = document.getElementById('update-disable-notifications')
const btnUpdateDownload   = document.getElementById('btn-update-download')
const btnUpdateLater      = document.getElementById('btn-update-later')
const btnUpdateClose      = document.getElementById('btn-update-close')
const scrobbleBadge      = document.getElementById('scrobble-badge')
const scrobbleLabel      = document.getElementById('scrobble-label')
const volumeControl      = document.getElementById('volume-control')
const btnVolume          = document.getElementById('btn-volume')
const volumeSlider       = document.getElementById('volume-slider')
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
  alertCircle: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><polygon points="10 9 15 12 10 15 10 9"/>',
  theater: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 21h10"/>',
  fullscreen: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  fullscreenExit: '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>',
  maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  miniPlayer: '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="5" y="12" width="6" height="4" rx="1"/>',
  audioOnly: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  volume: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>',
  volume2: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>',
  volumeX: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
}

// ── Boot ────────────────────────────────────────────────────────────────────

const MIN_SIDEBAR_W = 360
const MAX_SIDEBAR_W = 480
const DEFAULT_SIDEBAR_W = 360
const COMPACT_SIDEBAR_BREAKPOINT = MIN_SIDEBAR_W * 2

const GREETINGS = [
  'Welcome back.',
  'Good to see you.',
  'Ready to dig in?',
  "Let's find something good.",
  'Time to get lost.',
  'The decks are ready.',
  'What will it be tonight?',
]

const SUPPORT_EMAIL = 'feedback@djscrobbler.com'
const SUPPORT_CONFIG = {
  bug: {
    title: 'Report a bug',
    sub: 'If you have a GitHub account, you can open a bug report on GitHub. If not, you can report the bug anonymously by email.',
    emailButton: 'Report bug anonymously',
    issueTitle: 'Bug: ',
    issueBody: [
      '## What happened?',
      '',
      '',
      '## What did you expect to happen?',
      '',
      '',
      '## Steps to reproduce',
      '1. ',
      '2. ',
      '3. ',
      '',
      '## DJ Scrobbler version',
      '',
      '',
      '## Operating system',
      '',
      '',
      '## Screenshots or logs',
      '',
    ].join('\n'),
    emailSubject: 'DJ Scrobbler bug report',
    emailBody: 'What happened?\n\nSteps to reproduce:\n1. \n2. \n3. \n\nDJ Scrobbler version:\n\nOperating system:\n',
    label: 'bug',
  },
  feature: {
    title: 'Suggest a feature',
    sub: 'If you have a GitHub account, you can open a feature request on GitHub. If not, you can send the suggestion anonymously by email.',
    emailButton: 'Make suggestion anonymously',
    issueTitle: 'Feature request: ',
    issueBody: [
      '## What would you like DJ Scrobbler to do?',
      '',
      '',
      '## Why would this be useful?',
      '',
      '',
      '## Any examples or references?',
      '',
    ].join('\n'),
    emailSubject: 'DJ Scrobbler feature suggestion',
    emailBody: 'What would you like DJ Scrobbler to do?\n\nWhy would this be useful?\n',
    label: 'enhancement',
  },
}

let supportType = 'bug'
let appVersion = ''
let latestUpdateState = null

function feedbackVersionLine() {
  return appVersion ? `DJ Scrobbler v${appVersion}` : 'DJ Scrobbler'
}

async function supportGithubUrl(type) {
  const cfg = SUPPORT_CONFIG[type] || SUPPORT_CONFIG.bug
  const logs = (await window.api.getRecentLogs()) || 'No recent app logs captured.'
  const body = `${cfg.issueBody}\n\n## App version\n${feedbackVersionLine()}\n\n## Recent app logs\n\`\`\`text\n${logs}\n\`\`\`\n`
  const params = new URLSearchParams({
    title: `${cfg.issueTitle}${appVersion ? `(v${appVersion}) ` : ''}`,
    body,
    labels: cfg.label,
  })
  return `https://github.com/ericcastro/dj-scrobbler/issues/new?${params.toString()}`
}

async function supportEmailUrl(type) {
  const cfg = SUPPORT_CONFIG[type] || SUPPORT_CONFIG.bug
  const logs = (await window.api.getRecentLogs()) || 'No recent app logs captured.'
  const body = `${cfg.emailBody}\nApp version:\n${feedbackVersionLine()}\n\nRecent app logs:\n${logs}\n`
  const subject = `${cfg.emailSubject}${appVersion ? ` (v${appVersion})` : ''}`
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

function openSupportDialog(type) {
  supportType = SUPPORT_CONFIG[type] ? type : 'bug'
  const cfg = SUPPORT_CONFIG[supportType]
  supportDialogTitle.textContent = cfg.title
  supportDialogSub.textContent = cfg.sub
  btnSupportGithub.textContent = 'Open issue on GitHub'
  btnSupportEmail.textContent = cfg.emailButton
  supportDialog.classList.remove('hidden')
}

function closeSupportDialog() {
  supportDialog.classList.add('hidden')
}

function syncUpdateNotificationCheckboxes(checked) {
  updatesDisableNotifications.checked = checked
  updateDisableNotifications.checked = checked
  updateSettingsStatus.textContent = checked
    ? 'Update notifications are disabled. Manual checks still work.'
    : 'Check GitHub Releases for newer builds.'
}

async function setUpdateNotificationsDisabled(disabled) {
  const value = await window.api.updatesNotificationsDisabledSet(disabled)
  if (!state.store.settings) state.store.settings = {}
  state.store.settings.updateNotificationsDisabled = value
  syncUpdateNotificationCheckboxes(value)
  persist()
}

function updateDialogCopy(update) {
  latestUpdateState = update
  const latest = update.latestVersion ? `v${update.latestVersion}` : 'latest version'
  const releaseKind = update.prerelease ? ' pre-release' : ''
  const current = update.currentVersion ? `v${update.currentVersion}` : feedbackVersionLine()

  btnUpdateDownload.disabled = false
  btnUpdateLater.textContent = 'Remind me later'
  updateChangelog.value = update.changelog || 'No changelog was provided for this release.'

  if (update.status === 'checking') {
    updateDialogTitle.textContent = 'Checking for updates!'
    updateDialogSub.textContent = 'Looking at GitHub Releases.'
    updateChangelog.value = ''
    btnUpdateDownload.disabled = true
    btnUpdateDownload.textContent = 'Checking...'
  } else if (update.status === 'available') {
    updateDialogTitle.textContent = `DJ Scrobbler ${latest}${releaseKind} is available!`
    updateDialogSub.textContent = `You are running ${current}.`
    btnUpdateDownload.textContent = 'Download and restart'
  } else if (update.status === 'downloading') {
    updateDialogTitle.textContent = `Downloading DJ Scrobbler ${latest}${releaseKind}!`
    updateDialogSub.textContent = update.progress != null ? `${update.progress}% downloaded.` : 'Downloading the update.'
    btnUpdateDownload.disabled = true
    btnUpdateDownload.textContent = 'Downloading...'
  } else if (update.status === 'downloaded') {
    updateDialogTitle.textContent = `DJ Scrobbler ${latest} is ready!`
    updateDialogSub.textContent = 'Restart now to finish installing the update.'
    btnUpdateDownload.textContent = 'Restart'
  } else if (update.status === 'not-available') {
    updateDialogTitle.textContent = 'DJ Scrobbler is up to date!'
    updateDialogSub.textContent = `You are running ${current}.`
    updateChangelog.value = update.changelog || 'No newer GitHub Release was found.'
    btnUpdateDownload.disabled = true
    btnUpdateDownload.textContent = 'Up to date'
  } else if (update.status === 'external-download') {
    updateDialogTitle.textContent = `DJ Scrobbler ${latest}${releaseKind} is available!`
    updateDialogSub.textContent = 'The GitHub Releases page is open for this dev build.'
    btnUpdateDownload.textContent = 'Download and restart'
  } else if (update.status === 'error') {
    updateDialogTitle.textContent = 'Could not check for updates!'
    updateDialogSub.textContent = update.error || 'The update check failed.'
    updateChangelog.value = ''
    btnUpdateDownload.disabled = false
    btnUpdateDownload.textContent = 'Try again'
  }
}

function openUpdateDialog(update = latestUpdateState) {
  updateDialog.classList.remove('hidden')
  updateDialogCopy(update || {
    status: 'checking',
    currentVersion: appVersion,
    changelog: '',
  })
}

function closeUpdateDialog() {
  updateDialog.classList.add('hidden')
}

function dragPoint(e) {
  return { screenX: e.screenX, screenY: e.screenY }
}

function startWindowDrag(e) {
  if (e.button !== 0 || e.target.closest('.video-control-btn')) return
  if (currentVideoMode === 'fullscreen') return
  e.preventDefault()
  window.api.windowDragStart(dragPoint(e))

  const onMove = (moveEvent) => window.api.windowDragMove(dragPoint(moveEvent))
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    window.api.windowDragEnd()
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

let webviewReady = false
let browserWebviewReady = false
let pendingNav = null

function navigateTo(url) {
  hideIntro()
  document.body.classList.add('is-browsing')
  if (browserWebviewReady) browserWebview.loadURL(url)
  else pendingNav = url
}

async function init() {
  state.store = await window.api.getStore()
  document.body.classList.add(`platform-${await window.api.getPlatform()}`)
  if (await window.api.isDeveloper()) btnDevtools.classList.remove('hidden')

  applyTheme(state.store.settings?.theme || 'neon-night', false)
  restoreSidebarWidth()
  applyVideoMode(state.store.settings?.videoMode || 'inline', false)
  applyResponsiveSidebar()
  restoreRightPanelWidth()
  playerVolume = Math.max(0, Math.min(100, Math.round(Number(state.store.settings?.playerVolume ?? 80) || 0)))
  previousPlayerVolume = Math.max(1, Math.min(100, Math.round(Number(state.store.settings?.previousPlayerVolume ?? (playerVolume || 80)) || 80)))
  updateVolumeUI()

  // Restore right panel open/closed state (default: closed)
  const rightPanelOpen = state.store.settings?.rightPanelOpen ?? false
  if (rightPanelOpen) {
    rightPanel.classList.remove('collapsed')
    rightPanelHandle.classList.remove('hidden')
    btnTracklistToggle.classList.add('active')
  }

  appVersion = await window.api.getVersion()
  footerAppName.textContent = `DJ Scrobbler v${appVersion}`
  syncUpdateNotificationCheckboxes(!!state.store.settings?.updateNotificationsDisabled)

  introGreeting.textContent = GREETINGS[Math.floor(Math.random() * GREETINGS.length)]

  renderFavorites()
  renderHistory()
  wireFooterMarquees()

  state.lfmStatus = await window.api.lfmStatusGet()
  refreshScrobbleBadge()
  await loadSettings()
  syncResumeSettingUI()

  webview.addEventListener('dom-ready', () => {
    webviewReady = true
    window.api.registerWebviewRole(webview.getWebContentsId(), 'player')
  })

  browserWebview.addEventListener('dom-ready', () => {
    browserWebviewReady = true
    window.api.registerWebviewRole(browserWebview.getWebContentsId(), 'browser')
    if (pendingNav) { browserWebview.loadURL(pendingNav); pendingNav = null }
  })

  wireEvents()
  wireMainEvents()
  // No default navigation — show intro screen
}

// ── Intro screen ──────────────────────────────────────────────────────────────

function hideIntro() {
  introScreen.classList.add('hidden')
}

// ── Video mode ───────────────────────────────────────────────────────────────

const VIDEO_MODES = ['inline', 'mini', 'hidden', 'fullscreen']
let currentVideoMode = 'inline'
let progressSegmentKey = ''
let sidebarAutoHidden = false
let playerVolume = 80
let previousPlayerVolume = 80
let volumeHideTimer = null
let playerStatusTimer = null
let pendingKeyboardSeekTarget = null
let pendingKeyboardVolumeTarget = null

function setSidebarWidthVar() {
  document.documentElement.style.setProperty('--sidebar-w-current', `${sidebar.offsetWidth || DEFAULT_SIDEBAR_W}px`)
}

function clampSidebarWidth(width) {
  const numericWidth = Number(width)
  const fallback = Number.isFinite(numericWidth) ? numericWidth : DEFAULT_SIDEBAR_W
  return Math.max(MIN_SIDEBAR_W, Math.min(MAX_SIDEBAR_W, fallback))
}

function isCompactLayout() {
  return window.innerWidth < COMPACT_SIDEBAR_BREAKPOINT
}

function updateMiniPlayerMetrics() {
  if (!document.body.classList.contains('video-mode-mini')) return
  const rect = sidebarMiniPlayerSlot.getBoundingClientRect()
  if (!rect.width || !rect.height) {
    requestAnimationFrame(updateMiniPlayerMetrics)
    return
  }
  const style = getComputedStyle(sidebarMiniPlayerSlot)
  const borderLeft = parseFloat(style.borderLeftWidth) || 0
  const borderRight = parseFloat(style.borderRightWidth) || 0
  const borderTop = parseFloat(style.borderTopWidth) || 0
  const borderBottom = parseFloat(style.borderBottomWidth) || 0
  document.documentElement.style.setProperty('--mini-player-left', `${rect.left + borderLeft}px`)
  document.documentElement.style.setProperty('--mini-player-top', `${rect.top + borderTop}px`)
  document.documentElement.style.setProperty('--mini-player-width', `${rect.width - borderLeft - borderRight}px`)
  document.documentElement.style.setProperty('--mini-player-height', `${rect.height - borderTop - borderBottom}px`)
}

function applyVideoMode(mode, persistSetting = true) {
  const next = VIDEO_MODES.includes(mode) ? mode : 'inline'
  if (next === 'mini' && sidebar.classList.contains('collapsed') && !isCompactLayout()) {
    sidebar.classList.remove('collapsed')
  }
  if (next !== 'mini' || !sidebar.classList.contains('collapsed')) {
    document.body.classList.remove('sidebar-player-hidden')
  }
  window.api.setDisplayFullscreen(next === 'fullscreen')
  currentVideoMode = next
  document.body.classList.toggle('video-mode-mini', next === 'mini')
  document.body.classList.toggle('video-mode-hidden', next === 'hidden')
  document.body.classList.toggle('video-mode-fullscreen', next === 'fullscreen')
  updateVideoModeButtons()
  setSidebarWidthVar()
  requestAnimationFrame(() => requestAnimationFrame(updateMiniPlayerMetrics))
  if (persistSetting) {
    if (!state.store.settings) state.store.settings = {}
    state.store.settings.videoMode = next === 'fullscreen' ? 'inline' : next
    persist()
  }
}

function videoModePrimaryAction(mode = currentVideoMode) {
  if (mode === 'mini' || mode === 'fullscreen' || mode === 'hidden') return 'inline'
  return 'mini'
}

function videoModeLabel(mode) {
  if (mode === 'mini') return 'Mini-player mode'
  if (mode === 'inline') return 'Theater view'
  if (mode === 'fullscreen') return 'Exit full screen'
  if (mode === 'hidden') return 'Show video'
  return 'Video mode'
}

function videoModeIcon(mode) {
  if (mode === 'mini') return ICON.miniPlayer
  if (mode === 'hidden') return ICON.video
  if (mode === 'inline') return ICON.theater
  if (mode === 'fullscreen') return ICON.fullscreenExit
  return ICON.video
}

function updateVideoModeButtons() {
  const nextAction = videoModePrimaryAction()
  btnVideoMode.innerHTML = icon(videoModeIcon(nextAction), 15)
  btnVideoMode.title = videoModeLabel(nextAction)

  btnVideoDock.innerHTML = icon(videoModeIcon(nextAction), 15)
  btnVideoDock.title = videoModeLabel(nextAction)

  const fullscreenAction = currentVideoMode === 'fullscreen' ? 'inline' : 'fullscreen'
  btnVideoFullscreen.innerHTML = icon(currentVideoMode === 'fullscreen' ? ICON.fullscreenExit : ICON.fullscreen, 15)
  btnVideoFullscreen.title = currentVideoMode === 'fullscreen' ? 'Exit full screen' : 'Full screen'

  btnVideoHide.innerHTML = icon(ICON.x, 15)
  btnVideoHide.title = 'Audio only'
  btnVideoFullscreen.dataset.mode = fullscreenAction
}

function cycleVideoMode() {
  applyVideoMode(videoModePrimaryAction())
}

function formatPlaybackTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':')
}

function updatePlaybackProgress(currentTime = state.playbackCurrentTime, duration = state.playbackDuration) {
  const hasDuration = Number.isFinite(duration) && duration > 0
  const safeCurrent = Math.max(0, Number(currentTime) || 0)
  const pct = hasDuration ? Math.max(0, Math.min(1, safeCurrent / duration)) : 0
  playbackProgressFill.style.width = `${pct * 100}%`
  playbackProgressThumb.style.left = `${pct * 100}%`
  playbackElapsed.textContent = formatPlaybackTime(safeCurrent)
  playbackRemaining.textContent = hasDuration
    ? `-${formatPlaybackTime(Math.max(0, duration - safeCurrent))}`
    : '-00:00:00'
  playbackProgress.classList.toggle('has-duration', hasDuration)
  renderPlaybackSegments()
}

function seekFromProgressEvent(e) {
  if (!state.playbackDuration) return
  const rect = playbackProgressTrack.getBoundingClientRect()
  if (!rect.width) return
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const seconds = pct * state.playbackDuration
  state.playbackCurrentTime = seconds
  updatePlaybackProgress(seconds, state.playbackDuration)
  window.api.playerSeek(seconds)
}

function seekRelativeSeconds(deltaSeconds) {
  const current = Math.max(0, Number(state.playbackCurrentTime) || 0)
  const duration = Math.max(0, Number(state.playbackDuration) || 0)
  const target = Math.max(0, duration
    ? Math.min(duration, current + deltaSeconds)
    : current + deltaSeconds)
  state.playbackCurrentTime = target
  updatePlaybackProgress(target, state.playbackDuration)
  window.api.playerSeek(target)
}

function previewRelativeSeek(deltaSeconds) {
  const current = pendingKeyboardSeekTarget ?? Math.max(0, Number(state.playbackCurrentTime) || 0)
  const duration = Math.max(0, Number(state.playbackDuration) || 0)
  const target = Math.max(0, duration
    ? Math.min(duration, current + deltaSeconds)
    : current + deltaSeconds)
  pendingKeyboardSeekTarget = target
  state.playbackCurrentTime = target
  updatePlaybackProgress(target, state.playbackDuration)
}

function commitKeyboardSeek() {
  if (pendingKeyboardSeekTarget == null) return
  const target = pendingKeyboardSeekTarget
  pendingKeyboardSeekTarget = null
  window.api.playerSeek(target)
}

function startProgressDrag(e) {
  if (e.button !== 0 || !state.playbackDuration) return
  e.preventDefault()
  seekFromProgressEvent(e)
  playbackProgress.classList.add('dragging')

  const onMove = (moveEvent) => seekFromProgressEvent(moveEvent)
  const onUp = () => {
    playbackProgress.classList.remove('dragging')
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function timelineTracks() {
  return state.currentTracks.filter(track =>
    !track.isWWith &&
    !track.isMashupComponent &&
    !track.noTimestamp &&
    typeof track.cueSeconds === 'number' &&
    Number.isFinite(track.cueSeconds)
  )
}

function playbackSegmentData() {
  const duration = state.playbackDuration
  if (!Number.isFinite(duration) || duration <= 0) return []

  const tracks = timelineTracks()
    .map(track => ({
      ...track,
      cueSeconds: Math.max(0, Math.min(duration, track.cueSeconds)),
    }))
    .filter(track => track.cueSeconds < duration)
    .sort((a, b) => a.cueSeconds - b.cueSeconds)

  return tracks
    .map((track, i) => {
      const nextTrack = tracks.slice(i + 1).find(candidate => candidate.cueSeconds > track.cueSeconds)
      const end = nextTrack ? nextTrack.cueSeconds : duration
      return end > track.cueSeconds ? { track, start: track.cueSeconds, end } : null
    })
    .filter(Boolean)
}

function segmentTitle(track) {
  if (track.isId) return 'ID - ID'
  return track.title || track.raw || '?'
}

function updateProgressSegmentTooltipPosition(e) {
  const rect = playbackProgress.getBoundingClientRect()
  const tooltipWidth = playbackProgressTooltip.offsetWidth || 260
  const rawX = e.clientX - rect.left
  const paddedHalfWidth = (tooltipWidth / 2) + 8
  const x = Math.max(paddedHalfWidth, Math.min(rect.width - paddedHalfWidth, rawX))
  playbackProgressTooltip.style.left = `${x}px`
}

function showProgressSegmentTooltip(e, track) {
  const hasArt = !!track.artUrl
  playbackProgressTooltipArt.toggleAttribute('hidden', !hasArt)
  if (hasArt) playbackProgressTooltipArt.src = track.artUrl
  else playbackProgressTooltipArt.removeAttribute('src')
  playbackProgressTooltipTitle.textContent = segmentTitle(track)
  playbackProgressTooltipArtist.textContent = track.artist || ''
  playbackProgressTooltip.classList.add('visible')
  playbackProgressTooltip.setAttribute('aria-hidden', 'false')
  updateProgressSegmentTooltipPosition(e)
}

function hideProgressSegmentTooltip() {
  playbackProgressTooltip.classList.remove('visible')
  playbackProgressTooltip.setAttribute('aria-hidden', 'true')
}

function renderPlaybackSegments(force = false) {
  const segments = playbackSegmentData()
  const duration = state.playbackDuration
  const key = segments.length
    ? `${Math.round(duration)}:${segments.map(({ track, start, end }) => [
        Math.round(start),
        Math.round(end),
        track.trackNum || '',
        track.title || track.raw || '',
        track.artist || '',
        track.artUrl || '',
      ].join('|')).join('~')}`
    : ''

  if (!force && key === progressSegmentKey) return
  progressSegmentKey = key
  playbackProgressSegments.innerHTML = ''
  playbackProgress.classList.toggle('has-segments', segments.length > 1)
  hideProgressSegmentTooltip()

  if (!segments.length) return

  const fragment = document.createDocumentFragment()
  segments.forEach(({ track, start, end }) => {
    const segment = document.createElement('div')
    segment.className = 'playback-progress-segment'
    segment.style.left = `${(start / duration) * 100}%`
    segment.style.width = `${((end - start) / duration) * 100}%`
    segment.addEventListener('mouseenter', (e) => showProgressSegmentTooltip(e, track))
    segment.addEventListener('mousemove', updateProgressSegmentTooltipPosition)
    segment.addEventListener('mouseleave', hideProgressSegmentTooltip)
    fragment.appendChild(segment)
  })
  playbackProgressSegments.appendChild(fragment)
}

function seekRelativeTrack(direction) {
  const tracks = timelineTracks()
  if (!tracks.length) return
  const now = state.playbackCurrentTime || 0
  let target = null
  if (direction < 0) {
    for (const track of tracks) {
      if (track.cueSeconds < now - 3) target = track
      else break
    }
    target = target || tracks[0]
  } else {
    target = tracks.find(track => track.cueSeconds > now + 0.75) || tracks[tracks.length - 1]
  }
  if (target) window.api.playerSeek(target.cueSeconds)
}

// ── Search ──────────────────────────────────────────────────────────────────

const SOURCE_URLS = {
  youtube: q => q ? `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}` : 'https://www.youtube.com',
}

function navigateToSearch(query = '') {
  document.body.classList.remove('has-active-set')
  hideOverlays()
  clearTracklist()
  const sourceUrl = SOURCE_URLS[state.source] || SOURCE_URLS.youtube
  navigateTo(sourceUrl(query))
}

function doSearch() {
  const q = searchInput.value.trim()
  hideSearchDropdown()
  if (q) saveSearchQuery(q)
  navigateToSearch(q)
}

// ── Search autocomplete ───────────────────────────────────────────────────────

let dropdownFocusIdx = -1

function selectSearchSuggestion(query) {
  if (!query) return
  searchInput.value = query
  hideSearchDropdown()
  doSearch()
}

function showSearchDropdown(matches) {
  dropdownFocusIdx = -1
  searchDropdown.innerHTML = ''
  matches.forEach((q) => {
    const item = document.createElement('div')
    item.className = 'search-dropdown-item'
    item.dataset.query = q
    item.textContent = q
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
    searchInput.value = focused.dataset.query || focused.textContent
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
      case 'player-loading':      showPlayerStatus(); break
      case 'no-tracklist':        showNoTracklist(); break
      case 'no-tracklist-prompt': showNoTracklistPrompt(status.url); break
      case 'network-error':       showNetworkError(status.url, status.message); break
      case 'player-ready':        hidePlayerStatus(); break
      case 'hide-overlay':        hideOverlays(); break
    }
  })

  window.api.on('tracklist-loaded', ({ url, title, thumbnailUrl, isFallback, providerId, tracklistUrl, lookupError }) => {
    // Don't update set state or history while the user is deciding in the dialog.
    if (isResumeDialogOpen()) return
    document.body.classList.add('has-active-set')
    document.body.classList.remove('is-browsing')
    state.tracklistUnavailable = !!isFallback
    state.currentSetTitle      = title
    state.currentSetUrl        = url
    state.currentThumbnailUrl  = thumbnailUrl || null
    state.currentTracklistUrl  = tracklistUrl || null
    state.currentTracklistProvider = providerId || null

    if (isFallback) {
      state.currentTracks  = []   // prevent stale count leaking into bookmark
      state.currentSource  = 'youtube'
      npSet.textContent     = title
      npSource.textContent  = 'youtube (no tracklist yet)'
      tracklistUnavailableTitle.textContent = lookupError ? 'Tracklist lookup paused' : 'Tracklist not yet available'
      tracklistUnavailableSub.textContent = lookupError?.message ||
        'No tracklist was found for this DJ set. It may become available later — opening it again will retry automatically.'
      // Show the below-video area with the unavailable message
      tracklistUnavailableEl.classList.remove('hidden')
      tracklistList.innerHTML = ''
      tracklistCompactList.innerHTML = ''
      mainContent.classList.add('has-tracklist')
      // Clear any stale track info from a previous set
      state.nowPlaying       = null
      state.isTrackPlaying   = false
      npTrackText.textContent = ''
      npArtist.textContent   = ''
      npTracknum.textContent = ''
      ppIcon.innerHTML      = icon(ICON.play, 16)
      btnPlayPause.classList.remove('playing')
    } else {
      state.currentSource  = 'youtube'
      npSet.textContent    = title
      npSource.textContent = providerId === '1001tracklists'
        ? 'tracklist courtesy of 1001tracklists'
        : 'youtube'
      tracklistUnavailableTitle.textContent = 'Tracklist not yet available'
      tracklistUnavailableSub.textContent = 'No tracklist was found for this DJ set. It may become available later — opening it again will retry automatically.'
      tracklistUnavailableEl.classList.add('hidden')
    }

    state.isIdTrack = false
    updateBookmarkBtn()
    refreshScrobbleBadge()
    addToHistory({
      title,
      url,
      source: state.currentSource,
      thumbnailUrl: state.currentThumbnailUrl,
      tracklistUrl: state.currentTracklistUrl,
      tracklistProvider: state.currentTracklistProvider,
    })
  })

  window.api.on('now-playing', (data) => {
    state.nowPlaying = data
    const playing = data.isPlaying !== false
    ppIcon.innerHTML = playing ? icon(ICON.pause, 16) : icon(ICON.play, 16)
    btnPlayPause.classList.toggle('playing', playing)
    state.isTrackPlaying = playing
    state.isIdTrack      = !!data.isId
    // Player-only events carry play/pause state, not track metadata.
    if (data.source !== 'youtube-player' && data.source !== 'youtube-fallback') {
      npTrackText.textContent = data.isId ? 'ID' : (data.title || data.raw || '—')
      npArtist.textContent   = data.isId ? '—' : (data.artist || '—')
      npTracknum.textContent = data.trackNum ? `#${data.trackNum}` : ''
      if (data.trackNum) highlightTracklistByNum(data.trackNum)
    }
    // Save playback progress so history/favorites items can show a progress bar
    if (data.trackNum && state.currentSetUrl && data.source !== 'youtube-player' && data.source !== 'youtube-fallback') {
      updateSetProgress(state.currentSetUrl, data.trackNum, data.cueSeconds)
    }
    refreshScrobbleBadge()
  })

  window.api.on('lfm-status', (status) => {
    state.lfmStatus = status
    refreshScrobbleBadge()
  })

  const handlePlaybackProgress = ({ currentTime, duration }) => {
    if (!duration) return
    hidePlayerStatus()
    state.playbackCurrentTime = currentTime || 0
    state.playbackDuration = duration || 0
    updatePlaybackProgress()
    if (!state.currentSetUrl) return
    // On first valid tick after a resume load, seek to the saved position then clear
    if (state.pendingResumeTime !== null) {
      const t = state.pendingResumeTime
      state.pendingResumeTime = null
      window.api.playerSeek(t)
      return  // progress bar will update on the next tick at the new position
    }
    const pct = Math.min(99, Math.round((currentTime / duration) * 100))
    if (pct < 1) return
    updateFallbackProgress(state.currentSetUrl, pct, currentTime)
  }
  window.api.on('playback-progress', handlePlaybackProgress)
  window.api.on('fallback-progress', handlePlaybackProgress)
  window.api.on('tl-progress', handlePlaybackProgress)

  window.api.on('tracklist-data', (payload) => {
    if (isResumeDialogOpen()) return
    const tracks = Array.isArray(payload) ? payload : (payload?.tracks || [])
    renderTracklist(tracks)
    state.currentTracks = tracks
    renderPlaybackSegments(true)
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
  })

  window.api.on('menu-toggle-sidebar', () => toggleSidebar())
  window.api.on('menu-reload', () => navigateToSearch())
  window.api.on('update-status', (update) => {
    updateDialogCopy(update)
    if (update.status === 'available' || update.status === 'downloaded' || update.status === 'downloading') {
      openUpdateDialog(update)
    } else if ((update.status === 'error' || update.status === 'not-available') && update.manual) {
      openUpdateDialog(update)
    } else if (!updateDialog.classList.contains('hidden')) {
      openUpdateDialog(update)
    }
    if (update.status === 'not-available') {
      updateSettingsStatus.textContent = `Up to date. Current version: v${update.currentVersion || appVersion}.`
    } else if (update.status === 'available') {
      updateSettingsStatus.textContent = `Version v${update.latestVersion} is available.`
    }
  })
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
  requestAnimationFrame(updateMiniPlayerMetrics)
}

function toggleSidebar() {
  if (isCompactLayout()) {
    sidebarAutoHidden = true
    sidebar.classList.add('collapsed')
  } else {
    sidebarAutoHidden = false
    sidebar.classList.toggle('collapsed')
  }
  if (sidebar.classList.contains('collapsed')) {
    if (currentVideoMode === 'mini') document.body.classList.add('sidebar-player-hidden')
  } else {
    document.body.classList.remove('sidebar-player-hidden')
  }
  setSidebarWidthVar()
  requestAnimationFrame(updateMiniPlayerMetrics)
}

function applyResponsiveSidebar() {
  const compact = isCompactLayout()
  document.body.classList.toggle('compact-layout', compact)

  if (compact) {
    if (!sidebar.classList.contains('collapsed')) {
      sidebarAutoHidden = true
      sidebar.classList.add('collapsed')
    }
  } else if (sidebarAutoHidden) {
    sidebarAutoHidden = false
    sidebar.classList.remove('collapsed')
  }

  if (sidebar.classList.contains('collapsed') && currentVideoMode === 'mini') {
    document.body.classList.add('sidebar-player-hidden')
  } else {
    document.body.classList.remove('sidebar-player-hidden')
  }
  setSidebarWidthVar()
  requestAnimationFrame(updateMiniPlayerMetrics)
}

function updateVolumeUI() {
  if (!btnVolume || !volumeSlider) return
  volumeSlider.value = String(playerVolume)
  volumeSlider.style.setProperty('--volume-pct', `${playerVolume}%`)
  btnVolume.classList.toggle('muted', playerVolume === 0)
  btnVolume.innerHTML = icon(playerVolume === 0
    ? ICON.volumeX
    : (playerVolume > 50 ? ICON.volume2 : ICON.volume), 15)
  btnVolume.setAttribute('aria-label', playerVolume === 0 ? 'Restore volume' : 'Mute')
}

function showVolumePopover() {
  clearTimeout(volumeHideTimer)
  volumeControl.classList.add('open')
}

function scheduleVolumePopoverClose() {
  clearTimeout(volumeHideTimer)
  volumeHideTimer = setTimeout(() => {
    if (!volumeControl.matches(':hover')) volumeControl.classList.remove('open')
  }, 1000)
}

async function applyPlayerVolume(volume, persistSetting = true) {
  const requestedVolume = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)))
  playerVolume = requestedVolume
  if (playerVolume > 0) previousPlayerVolume = playerVolume
  updateVolumeUI()
  await window.api.playerVolumeSet(requestedVolume)
  if (persistSetting) {
    if (!state.store.settings) state.store.settings = {}
    state.store.settings.playerVolume = playerVolume
    state.store.settings.previousPlayerVolume = previousPlayerVolume
    persist()
  }
}

async function togglePlayerMute() {
  const nextVolume = playerVolume === 0 ? previousPlayerVolume : 0
  await applyPlayerVolume(nextVolume, true)
}

function previewPlayerVolume(volume) {
  playerVolume = Math.max(0, Math.min(100, Math.round(Number(volume) || 0)))
  if (playerVolume > 0) previousPlayerVolume = playerVolume
  updateVolumeUI()
}

function adjustPlayerVolume(delta, commit = true) {
  showVolumePopover()
  const base = pendingKeyboardVolumeTarget ?? playerVolume
  const nextVolume = Math.max(0, Math.min(100, base + delta))
  if (commit) {
    applyPlayerVolume(nextVolume, true)
  } else {
    pendingKeyboardVolumeTarget = nextVolume
    previewPlayerVolume(nextVolume)
  }
}

function commitKeyboardVolume() {
  if (pendingKeyboardVolumeTarget == null) return
  const target = pendingKeyboardVolumeTarget
  pendingKeyboardVolumeTarget = null
  applyPlayerVolume(target, true)
}

function shouldIgnorePlayerShortcut(e) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return true
  if (!resumeDialog.classList.contains('hidden')) return true
  if (!supportDialog.classList.contains('hidden')) return true
  if (!updateDialog.classList.contains('hidden')) return true
  const target = e.target
  if (!target) return false
  if (typeof target.closest !== 'function') return false
  return !!target.closest('input, textarea, select, button, [contenteditable="true"]')
}

function handlePlayerShortcutKeydown(e) {
  if (shouldIgnorePlayerShortcut(e)) return
  if (e.key === 'ArrowLeft') {
    e.preventDefault()
    previewRelativeSeek(-5)
  } else if (e.key === 'ArrowRight') {
    e.preventDefault()
    previewRelativeSeek(5)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    adjustPlayerVolume(5, false)
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    adjustPlayerVolume(-5, false)
  }
}

function handlePlayerShortcutKeyup(e) {
  if (shouldIgnorePlayerShortcut(e)) return
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault()
    commitKeyboardSeek()
  } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault()
    commitKeyboardVolume()
  }
}

// ── Sidebar resize ────────────────────────────────────────────────────────────

function restoreSidebarWidth() {
  const w = clampSidebarWidth(state.store.settings?.sidebarWidth)
  sidebar.style.width = w + 'px'
  setSidebarWidthVar()
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
    sidebar.style.width = clampSidebarWidth(e.clientX) + 'px'
    setSidebarWidthVar()
    updateMiniPlayerMetrics()
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
      setSidebarWidthVar()
      updateMiniPlayerMetrics()
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
  if (histEntry.lastTrackCueSeconds != null) patch.lastTrackCueSeconds = histEntry.lastTrackCueSeconds
  if (histEntry.progressTimePct  != null) patch.progressTimePct  = histEntry.progressTimePct
  if (histEntry.progressTime     != null) patch.progressTime     = histEntry.progressTime
  if (histEntry.tracklistUrl     != null) patch.tracklistUrl     = histEntry.tracklistUrl
  if (histEntry.tracklistProvider != null) patch.tracklistProvider = histEntry.tracklistProvider
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
    lastTrackCueSeconds: existing.lastTrackCueSeconds,
    progressTimePct:  existing.progressTimePct,
    progressTime:     existing.progressTime,
    tracklistUrl:     existing.tracklistUrl,
    tracklistProvider: existing.tracklistProvider,
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

function wireOverflowMarquee(target, hoverTarget = target) {
  if (!target || target.dataset.marqueeWired === 'true') return
  target.dataset.marqueeWired = 'true'

  const start = () => {
    target._overflowMarqueeAnimation?.cancel()
    target.style.transition = 'none'
    target.style.transform = ''
    target.classList.remove('overflow-marquee')

    requestAnimationFrame(() => {
      const overflow = target.scrollWidth - target.clientWidth
      if (overflow <= 4) return
      const moveSecs = Math.max(1.5, overflow / 60)
      const pauseSecs = 1
      const totalSecs = moveSecs + (pauseSecs * 2)
      const startMoveOffset = pauseSecs / totalSecs
      const endMoveOffset = (pauseSecs + moveSecs) / totalSecs
      const dist = `-${overflow}px`
      target.classList.add('overflow-marquee')
      target._overflowMarqueeAnimation = target.animate([
        { transform: 'translateX(0)', offset: 0 },
        { transform: 'translateX(0)', offset: startMoveOffset },
        { transform: `translateX(${dist})`, offset: endMoveOffset },
        { transform: `translateX(${dist})`, offset: 1 },
      ], {
        duration: totalSecs * 1000,
        easing: 'linear',
        iterations: Infinity,
        direction: 'alternate',
      })
    })
  }

  const stop = () => {
    if (!target.classList.contains('overflow-marquee')) return
    const currentX = new DOMMatrix(getComputedStyle(target).transform).m41
    target._overflowMarqueeAnimation?.cancel()
    target._overflowMarqueeAnimation = null
    target.classList.remove('overflow-marquee')
    target.style.transform = `translateX(${currentX}px)`
    requestAnimationFrame(() => requestAnimationFrame(() => {
      target.style.transition = 'transform 0.5s ease'
      target.style.transform = 'translateX(0)'
    }))
  }

  hoverTarget.addEventListener('mouseenter', start)
  hoverTarget.addEventListener('mouseleave', stop)
  target.addEventListener('transitionend', () => {
    target.style.transition = ''
    target.style.transform = ''
  })
}

function wireSetItemMarquee(li) {
  wireOverflowMarquee(li.querySelector('.set-item-title'), li)
}

function wireFooterMarquees() {
  ;[npTrackText, npArtist, npSet, npSource, scrobbleLabel].forEach(el => wireOverflowMarquee(el))
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

function updateSetProgress(url, trackNum, cueSeconds) {
  const update = {
    progressTrackNum: trackNum,
    lastTrackCueSeconds: typeof cueSeconds === 'number' ? cueSeconds : null,
    lastTrackOnclick: null,
  }
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
  state.pendingResumeTime = resume
    ? (item.progressTime ?? item.lastTrackCueSeconds ?? null)
    : null
  if (isYouTubeSourceUrl(item.url)) {
    document.body.classList.add('has-active-set')
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
    const hasProgress = !!(item.progressTrackNum > 1 && item.lastTrackCueSeconds != null)
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
  wireSetItemMarquee(li)
  return li
}

// ── Tracklist panel ───────────────────────────────────────────────────────────

function createTrackItem(track, compact) {
  const li = document.createElement('li')
  li.className = 'track-item' +
    (track.isId             ? ' track-id'           : '') +
    (track.isWWith          ? ' track-with'         : '') +
    (track.isMashupComponent ? ' track-mashup'      : '') +
    (track.noTimestamp      ? ' track-no-timestamp' : '')
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

  // cue column: timestamp if available, warning icon if the track has no timestamp
  const cueHtml = track.cueDisplay
    ? `<span class="track-cue">${escHtml(track.cueDisplay)}</span>`
    : (track.noTimestamp
        ? `<span class="track-no-ts-icon">${icon(ICON.alertCircle, 11)}</span>`
        : '')

  li.innerHTML = `
    ${numHtml}
    ${artHtml}
    <div class="track-info">
      <span class="track-title">${titleText}</span>
      ${artistHtml}
    </div>
    ${cueHtml}
  `

  if (typeof track.cueSeconds === 'number' && !track.noTimestamp && !track.isMashupComponent && !track.isWWith) {
    li.addEventListener('click', () => window.api.playerSeek(track.cueSeconds))
  }

  return li
}

function renderTracklist(tracks) {
  tracklistList.innerHTML = ''
  tracklistCompactList.innerHTML = ''

  // Propagate noTimestamp to w/ and mashup sub-items that belong to a
  // no-timestamp parent.  Sub-items (isWWith / isMashupComponent) inherit
  // the flag from the most recent regular track so they render muted too.
  let parentNoTimestamp = false
  const annotated = tracks.map(t => {
    if (!t.isWWith && !t.isMashupComponent) parentNoTimestamp = !!t.noTimestamp
    return (t.isWWith || t.isMashupComponent) && parentNoTimestamp
      ? { ...t, noTimestamp: true }
      : t
  })

  annotated.forEach(track => {
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
  document.body.classList.remove('has-active-set')
  state.nowPlaying         = null
  state.currentSetTitle    = ''
  state.currentSetUrl      = ''
  state.currentSource      = ''
  state.currentTracklistUrl = null
  state.currentTracklistProvider = null
  state.currentThumbnailUrl = null
  state.currentTracks       = []
  state.playbackCurrentTime = 0
  state.playbackDuration    = 0
  updatePlaybackProgress(0, 0)
  document.body.classList.remove('is-browsing')
  state.isTrackPlaying     = false
  npTrackText.textContent = ''
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
  hidePlayerStatus()
  loadingMsg.textContent = msg
  loadingOverlay.classList.remove('hidden')
  noTracklistMsg.classList.add('hidden')
  noTracklistPrompt.classList.add('hidden')
  // A new search is starting — clear the unavailable state + stale tracklist
  state.tracklistUnavailable = false
  state.currentTracks = []
  clearTracklist()
  refreshScrobbleBadge()
}

function showNoTracklist() {
  noTracklistMsg.classList.remove('hidden')
  loadingOverlay.classList.add('hidden')
  noTracklistPrompt.classList.add('hidden')
}

function showNoTracklistPrompt(url) {
  hidePlayerStatus()
  pendingPlayUrl = url
  noTlPromptTitle.textContent = 'No tracklist found for this DJ set :('
  noTlPromptSub.textContent = 'This set might not have a tracklist yet.'
  btnRetryLoad.classList.add('hidden')
  btnPlayAnyway.textContent = 'Play set anyway'
  noTracklistPrompt.classList.remove('hidden')
  loadingOverlay.classList.add('hidden')
  noTracklistMsg.classList.add('hidden')
  resetNowPlaying()
  state.tracklistUnavailable = true
  refreshScrobbleBadge()
}

function showNetworkError(url, message) {
  hidePlayerStatus()
  pendingPlayUrl = url
  noTlPromptTitle.textContent = 'Connection problem'
  noTlPromptSub.textContent = message || 'Check your connection and try again.'
  btnRetryLoad.classList.remove('hidden')
  btnPlayAnyway.textContent = 'Play without tracklist'
  noTracklistPrompt.classList.remove('hidden')
  loadingOverlay.classList.add('hidden')
  noTracklistMsg.classList.add('hidden')
  state.tracklistUnavailable = true
  refreshScrobbleBadge()
}

function showPlayerStatus() {
  clearTimeout(playerStatusTimer)
  playerStatusTitle.textContent = 'Starting YouTube player...'
  playerStatusSub.textContent = 'Tracklist can load before video is ready.'
  playerStatusOverlay.classList.remove('hidden')
  playerStatusTimer = setTimeout(() => {
    if (playerStatusOverlay.classList.contains('hidden')) return
    playerStatusTitle.textContent = 'Still waiting for YouTube...'
    playerStatusSub.textContent = 'Playback may start once the connection catches up.'
  }, 6000)
}

function hidePlayerStatus() {
  clearTimeout(playerStatusTimer)
  playerStatusTimer = null
  playerStatusOverlay.classList.add('hidden')
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

  btnSC.disabled = true

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

  searchDropdown.addEventListener('mousedown', (e) => {
    const item = e.target.closest('.search-dropdown-item')
    if (!item || !searchDropdown.contains(item)) return
    e.preventDefault() // keep focus on input long enough to select the row
    selectSearchSuggestion(item.dataset.query || item.textContent)
  })

  searchInput.addEventListener('blur', () => {
    // Small delay so mousedown on an item fires before blur hides the list
    setTimeout(hideSearchDropdown, 150)
  })

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#search-box')) hideSearchDropdown()
  })
  document.addEventListener('keydown', handlePlayerShortcutKeydown)
  document.addEventListener('keyup', handlePlayerShortcutKeyup)

  btnDevtools.addEventListener('click', () => window.api.openDevTools())
  btnSidebarToggle.addEventListener('click', () => toggleSidebar())
  btnTracklistToggle.addEventListener('click', () => toggleRightPanel())
  btnVideoMode.addEventListener('click', cycleVideoMode)
  btnVideoDock.addEventListener('click', () => applyVideoMode(videoModePrimaryAction()))
  btnVideoFullscreen.addEventListener('click', () => applyVideoMode(btnVideoFullscreen.dataset.mode || 'fullscreen'))
  btnVideoHide.addEventListener('click', () => applyVideoMode('hidden'))
  videoControls.addEventListener('mousedown', startWindowDrag)
  window.addEventListener('resize', applyResponsiveSidebar)
  volumeControl.addEventListener('mouseenter', showVolumePopover)
  volumeControl.addEventListener('mouseleave', scheduleVolumePopoverClose)
  btnVolume.addEventListener('click', () => {
    showVolumePopover()
    togglePlayerMute()
  })
  volumeSlider.addEventListener('input', () => applyPlayerVolume(volumeSlider.value, false))
  volumeSlider.addEventListener('change', () => applyPlayerVolume(volumeSlider.value, true))

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
        tracklistUrl:     state.currentTracklistUrl || histEntry?.tracklistUrl || undefined,
        tracklistProvider: state.currentTracklistProvider || histEntry?.tracklistProvider || undefined,
        trackCount:       state.currentTracks.length || histEntry?.trackCount || undefined,
        progressTrackNum: histEntry?.progressTrackNum || undefined,
        lastTrackCueSeconds: histEntry?.lastTrackCueSeconds ?? undefined,
        progressTimePct:  histEntry?.progressTimePct || undefined,
        progressTime:     histEntry?.progressTime || undefined,
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
    if (!url.includes('1001tracklists.com')) {
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
  btnRetryLoad.addEventListener('click', () => {
    if (!pendingPlayUrl) return
    const url = pendingPlayUrl
    pendingPlayUrl = null
    window.api.loadSourceUrl(url)
  })

  btnPlayPause.addEventListener('click', () => window.api.playerToggle())
  btnPrevTrack.addEventListener('click', () => seekRelativeTrack(-1))
  btnNextTrack.addEventListener('click', () => seekRelativeTrack(1))
  playbackProgressTrack.addEventListener('mousedown', startProgressDrag)

  document.querySelectorAll('.theme-swatch').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.themeId))
  })

  sidebarFooter.addEventListener('click', (e) => {
    const link = e.target.closest('.sidebar-footer-link')
    if (link?.dataset.feedbackType) openSupportDialog(link.dataset.feedbackType)
    else if (link?.dataset.href) window.api.openExternal(link.dataset.href)
  })

  btnSupportGithub.addEventListener('click', () => {
    supportGithubUrl(supportType).then(url => window.api.openExternal(url))
    closeSupportDialog()
  })
  btnSupportEmail.addEventListener('click', () => {
    supportEmailUrl(supportType).then(url => window.api.openExternal(url))
    closeSupportDialog()
  })
  btnSupportClose.addEventListener('click', closeSupportDialog)
  supportDialog.addEventListener('click', (e) => {
    if (e.target === supportDialog) closeSupportDialog()
  })
  btnCheckUpdates.addEventListener('click', async () => {
    openUpdateDialog({ status: 'checking', currentVersion: appVersion })
    await window.api.updatesCheck()
  })
  btnUpdateDownload.addEventListener('click', async () => {
    if (latestUpdateState?.status === 'downloaded') {
      await window.api.updatesInstall()
    } else if (latestUpdateState?.status === 'error') {
      openUpdateDialog({ status: 'checking', currentVersion: appVersion })
      await window.api.updatesCheck()
    } else {
      await window.api.updatesDownload()
    }
  })
  btnUpdateLater.addEventListener('click', closeUpdateDialog)
  btnUpdateClose.addEventListener('click', closeUpdateDialog)
  updateDialog.addEventListener('click', (e) => {
    if (e.target === updateDialog) closeUpdateDialog()
  })
  updatesDisableNotifications.addEventListener('change', () => {
    setUpdateNotificationsDisabled(updatesDisableNotifications.checked)
  })
  updateDisableNotifications.addEventListener('change', () => {
    setUpdateNotificationsDisabled(updateDisableNotifications.checked)
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
