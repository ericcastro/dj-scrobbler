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
  currentTracklistProviderName: null,
  currentTracklistProviderFooter: null,
  currentTracklistOptions: [],
  currentContributeUrl: null,
  currentAltProvider: null,   // { id, name, label, prompt, note } offered in the fallback panel
  currentThumbnailUrl: null,
  nowPlaying: null,
  playbackCurrentTime: 0,
  playbackDuration: 0,
  lfmStatus: 'unconfigured',
  isTrackPlaying: false,
  isIdTrack: false,
  tracklistUnavailable: false,
  store: { favorites: [], history: [], searchQueries: [], settings: {} },
  stats: { totalListenedSeconds: 0, totalTracksListened: 0, listenDays: [], firstListenDate: null },
  currentTracks: [],       // full track array from tracklist-data, used for progress lookups
  currentSetMetadata: null, // normalized provider metadata, delivered separately from track rows
  currentSourceStats: null, // public source age/plays plus the metadata-likelihood classification
  currentSetAvailability: null, // per-service lookup state and explicit source URLs
  automaticLookupDecisionPending: false, // wait for the player's duration before event lookup
  metadataEditMode: null, // null follows the default: open only when the set has no metadata
  metadataOverwriteOnSet79: false,
  metadataRemovedValues: [], // persisted per-value exclusions, also shown as restoration suggestions
  currentEventLookup: null, // async next-gig state for DJs in the metadata pills
  currentEventLookupKey: '',
  currentEventLookupRequest: 0,
  eventSuggestionsDismissedNotice: false,
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
const browseLoading      = document.getElementById('browse-loading')
const browseLoadingMsg   = document.getElementById('browse-loading-msg')
const introScreen        = document.getElementById('intro-screen')
const libraryScreen      = document.getElementById('library-screen')
const introGreeting      = document.getElementById('intro-greeting')
const loadingOverlay     = document.getElementById('loading-overlay')
const seekShield         = document.getElementById('seek-shield')
const loadingMsg         = document.getElementById('loading-msg')
const loadingHung        = document.getElementById('loading-hung')
const loadingHungMsg     = document.getElementById('loading-hung-msg')
const btnLoadingReport   = document.getElementById('btn-loading-report')
const btnLoadingRestart  = document.getElementById('btn-loading-restart')
const btnLoadingDismiss  = document.getElementById('btn-loading-dismiss')
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
const librarySearchInput = document.getElementById('library-search-input')
const libraryViewOptions = document.querySelectorAll('[data-library-view]')
const libraryOverview    = document.getElementById('library-overview')
const djLibraryGrid      = document.getElementById('dj-library-grid')
const libraryEmpty       = document.getElementById('library-empty')
const eventVenueLibrarySearchInput = document.getElementById('event-venue-library-search-input')
const eventVenueLibraryViewOptions = document.querySelectorAll('[data-event-venue-view]')
const eventVenueLibraryTypeOptions = document.querySelectorAll('[data-event-venue-type]')
const eventVenueLibraryGrid = document.getElementById('event-venue-library-grid')
const eventVenueLibraryEmpty = document.getElementById('event-venue-library-empty')
const libraryDjDetail    = document.getElementById('library-dj-detail')
const libraryDjName      = document.getElementById('library-dj-name')
const libraryDjCount     = document.getElementById('library-dj-count')
const libraryDjSets      = document.getElementById('library-dj-sets')
const btnLibraryBack     = document.getElementById('btn-library-back')
const libraryBackLabel   = document.getElementById('library-back-label')
const sidebarDjList      = document.getElementById('sidebar-dj-list')
const sidebarDjEmpty     = document.getElementById('sidebar-dj-empty')
const sidebarEventList = document.getElementById('sidebar-event-list')
const sidebarEventEmpty = document.getElementById('sidebar-event-empty')
const sidebarVenueList = document.getElementById('sidebar-venue-list')
const sidebarVenueEmpty = document.getElementById('sidebar-venue-empty')
const favoritesList      = document.getElementById('favorites-list')
const historyList        = document.getElementById('history-list')
const favEmpty           = document.getElementById('fav-empty')
const histEmpty          = document.getElementById('hist-empty')
const mainContent              = document.getElementById('main-content')
const tracklistBelowVideo      = document.getElementById('tracklist-below-video')
const tracklistScrollRegion    = document.getElementById('tracklist-scroll-region')
const setMetadataHeader        = document.getElementById('set-metadata-header')
const setMetadataTags          = document.getElementById('set-metadata-tags')
const btnSetMetadataRefresh    = document.getElementById('btn-set-metadata-refresh')
const btnSetMetadataEdit       = document.getElementById('btn-set-metadata-edit')
const setEventLookup           = document.getElementById('set-event-lookup')
const eventCityInput           = document.getElementById('event-city')
const eventCountrySelect       = document.getElementById('event-country')
const eventCountryOtherGroup   = document.getElementById('event-country-other-group')
const eventCountryOtherInput   = document.getElementById('event-country-other')
const btnSaveEventLocation     = document.getElementById('btn-save-event-location')
const eventLocationStatus      = document.getElementById('event-location-status')
const eventSuggestionsEnabledInput = document.getElementById('event-suggestions-enabled')
const eventLocationSetup       = document.getElementById('event-location-setup')
const tracklistProviderChoice  = document.getElementById('tracklist-provider-choice')
const tracklistList            = document.getElementById('tracklist-list')
const tracklistUnavailableEl      = document.getElementById('tracklist-unavailable')
const tracklistUnavailableTitle   = document.getElementById('tracklist-unavailable-title')
const tracklistUnavailableSub     = document.getElementById('tracklist-unavailable-sub')
const tlContributeActions         = document.getElementById('tl-contribute-actions')
const btnAltProvider              = document.getElementById('btn-alt-provider')
const btnContributeTracklist      = document.getElementById('btn-contribute-tracklist')
const tlContributeNote            = document.getElementById('tl-contribute-note')
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
const npArtistSeparator  = document.getElementById('np-artist-separator')
const npTitleRow         = document.getElementById('np-title-row')
const npTitleContent     = document.getElementById('np-title-content')
const npInfo             = document.getElementById('np-info')
const npArtwork          = document.getElementById('np-artwork')
const npArtworkImage     = document.getElementById('np-artwork-image')
const npSet              = document.getElementById('np-set')
const npSource           = document.getElementById('np-source')
const resumeDialog        = document.getElementById('resume-dialog')
const resumeCountdownNum  = document.getElementById('resume-countdown-num')
const resumeDontAsk       = document.getElementById('resume-dont-ask')
const btnResumeDismiss    = document.getElementById('btn-resume-dismiss')
const btnResumeStart      = document.getElementById('btn-resume-start')
const btnResumeResume     = document.getElementById('btn-resume-resume')
const btnViewHome         = document.getElementById('btn-view-home')
const btnViewLibrary      = document.getElementById('btn-view-library')
const btnViewNowplaying   = document.getElementById('btn-view-nowplaying')
const btnViewSearch       = document.getElementById('btn-view-search')
const btnClearHistory     = document.getElementById('btn-clear-history')
const historyClearStatus  = document.getElementById('history-clear-status')
const contributeDialog      = document.getElementById('contribute-dialog')
const contributeDialogTitle = document.getElementById('contribute-dialog-title')
const contributeDialogSub   = document.getElementById('contribute-dialog-sub')
const contributeDialogNote  = document.getElementById('contribute-dialog-note')
const btnContributeClose    = document.getElementById('btn-contribute-close')
const btnContributeOpen     = document.getElementById('btn-contribute-open')
const btnContributeDismiss  = document.getElementById('btn-contribute-dismiss')
const aboutDialog         = document.getElementById('about-dialog')
const aboutVersion        = document.getElementById('about-version')
const btnAboutClose       = document.getElementById('btn-about-close')
const btnAboutChangelog   = document.getElementById('btn-about-changelog')
const btnAboutFeature     = document.getElementById('btn-about-feature')
const btnAboutBug         = document.getElementById('btn-about-bug')
const btnAboutWebsite     = document.getElementById('btn-about-website')
const supportDialog       = document.getElementById('support-dialog')
const supportDialogTitle  = document.getElementById('support-dialog-title')
const supportDialogSub    = document.getElementById('support-dialog-sub')
const btnSupportGithub    = document.getElementById('btn-support-github')
const btnSupportEmail     = document.getElementById('btn-support-email')
const btnSupportClose     = document.getElementById('btn-support-close')
const btnCheckUpdates     = document.getElementById('btn-check-updates')
const updateSettingsStatus = document.getElementById('update-settings-status')
const btnClearTracklistCache  = document.getElementById('btn-clear-tracklist-cache')
const tracklistCacheStatus    = document.getElementById('tracklist-cache-status')
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
const sepListenTime      = document.getElementById('sep-listen-time')
const sepSetsCount       = document.getElementById('sep-sets-count')
const sepTracksCount     = document.getElementById('sep-tracks-count')
const sepListenTooltip   = document.getElementById('sep-listen-tooltip')
const tlListFooter       = document.getElementById('tl-list-footer')
const tlCompactFooter    = document.getElementById('tl-compact-footer')
const introSearchInput   = document.getElementById('intro-search-input')
const introResumeSection  = document.getElementById('intro-resume')
const introResumeGrid     = document.getElementById('intro-resume-grid')
const historyPanelTitle   = document.querySelector('#panel-history .panel-title')
const djPanelTitle        = document.querySelector('#panel-djs .panel-title')
const eventPanelTitle = document.querySelector('#panel-events .panel-title')
const venuePanelTitle = document.querySelector('#panel-venues .panel-title')

// ── Icons (Lucide MIT) ────────────────────────────────────────────────────────

function icon(paths, size = 14) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
}

function spectrumBarsHtml(className = '') {
  return `<span class="spectrum-bars${className ? ` ${className}` : ''}" aria-hidden="true">
    <span class="spectrum-bar"></span><span class="spectrum-bar"></span>
    <span class="spectrum-bar"></span><span class="spectrum-bar"></span>
  </span>`
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

const MIN_SIDEBAR_W              = 270
const MAX_SIDEBAR_W              = 480
const DEFAULT_SIDEBAR_W          = 360
const COMPACT_SIDEBAR_BREAKPOINT = DEFAULT_SIDEBAR_W * 2

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

const ID_SUB = "You can help out and complete what's missing!"

// The contribute prompts assume 1001Tracklists' community model. Other
// providers (set79) have no public edit flow, so they only get an attribution.
function tracklistProviderName() {
  return state.currentTracklistProviderName || '1001Tracklists'
}

function tracklistProviderNote() {
  const name = tracklistProviderName()
  return name === '1001Tracklists'
    ? 'Tracklist metadata is obtained from 1001Tracklists, where anyone with an account can contribute :-)'
    : `Tracklist metadata for this set came from ${name}.`
}

const CONTRIBUTE_CONFIGS = {
  'no-timestamp': {
    title: 'No timestamp for this track yet',
    sub:   "...so we can't seek to it. You can help adding it!",
  },
  'id': {
    btnLabel: 'do you know this track?',
    title:    'Do you know this track?',
    sub:      ID_SUB,
  },
  'id-title': {
    btnLabel: 'do you know the title?',
    title:    'Do you know the title for this track?',
    sub:      ID_SUB,
  },
  'id-artist': {
    btnLabel: 'do you know the artist?',
    title:    'Do you know the artist for this track?',
    sub:      ID_SUB,
  },
}

function openContributeDialog(type) {
  const cfg = CONTRIBUTE_CONFIGS[type] || CONTRIBUTE_CONFIGS['no-timestamp']
  contributeDialogTitle.textContent = cfg.title
  contributeDialogSub.textContent   = cfg.sub
  contributeDialogNote.textContent  = tracklistProviderNote()
  contributeDialogNote.classList.remove('hidden')
  btnContributeOpen.textContent = `Open on ${tracklistProviderName()}`
  // noAction types have no link to open — hide action buttons
  btnContributeOpen.classList.toggle('hidden', !!cfg.noAction)
  btnContributeDismiss.classList.toggle('hidden', !!cfg.noAction)
  contributeDialog.classList.remove('hidden')
}

function closeContributeDialog() {
  contributeDialog.classList.add('hidden')
}

function setNpArtwork(artUrl, artworkStatus = 'missing') {
  const url = String(artUrl || '').trim()
  const loading = !url && artworkStatus === 'loading'
  const showPlaceholder = !url && !loading && document.body.classList.contains('has-active-set')
  npArtwork.classList.toggle('hidden', !url && !loading && !showPlaceholder)
  npArtwork.classList.toggle('is-loading', loading)
  npArtwork.classList.toggle('is-empty', showPlaceholder)
  npArtworkImage.hidden = !url
  if (url) {
    if (npArtworkImage.src !== url) npArtworkImage.src = url
  } else {
    npArtworkImage.removeAttribute('src')
  }
}

npArtworkImage.addEventListener('error', () => setNpArtwork())

const PARTY_EVENT_COUNTRY_GROUPS = [
  { continent: 'North America', codes: ['US', 'CA', 'MX'] },
  { continent: 'Europe', codes: [
    'GB', 'FR', 'DE', 'NL', 'BE', 'ES', 'PT', 'IT', 'CH', 'AT', 'PL', 'CZ',
    'DK', 'SE', 'NO', 'FI', 'IE', 'GR', 'HR', 'HU', 'RO', 'RS', 'BG', 'SI', 'SK',
    'EE', 'LV', 'LT', 'IS', 'MT', 'CY', 'TR', 'UA',
  ] },
  { continent: 'South America', codes: ['BR', 'AR', 'CL', 'CO', 'PE', 'UY', 'EC', 'BO', 'PY', 'VE'] },
]

const PARTY_EVENT_COUNTRY_CODES = new Set(PARTY_EVENT_COUNTRY_GROUPS.flatMap(group => group.codes))

function countryName(code) {
  if (code === 'XK') return 'Kosovo'
  return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code
}

function populateEventCountries() {
  eventCountrySelect.innerHTML = ''
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = 'Choose a country'
  placeholder.disabled = true
  placeholder.selected = true
  eventCountrySelect.append(placeholder)
  PARTY_EVENT_COUNTRY_GROUPS.forEach(({ continent, codes }) => {
    const heading = document.createElement('option')
    heading.disabled = true
    heading.textContent = `— ${continent} —`
    eventCountrySelect.append(heading)
    codes.forEach(code => {
      const option = document.createElement('option')
      option.value = code
      option.textContent = countryName(code)
      eventCountrySelect.append(option)
    })
  })
  const otherHeading = document.createElement('option')
  otherHeading.disabled = true
  otherHeading.textContent = '──────────'
  eventCountrySelect.append(otherHeading)
  const other = document.createElement('option')
  other.value = 'OTHER'
  other.textContent = 'Other…'
  eventCountrySelect.append(other)
}

function syncOtherCountryField({ focus = false } = {}) {
  const isOther = eventCountrySelect.value === 'OTHER'
  eventCountryOtherGroup.classList.toggle('hidden', !isOther)
  if (isOther && focus) requestAnimationFrame(() => eventCountryOtherInput.focus())
}

function configuredEventLocation() {
  const location = state.store.settings?.eventLocation
  return location?.city && location?.country && location?.countryCode ? location : null
}

function eventSuggestionsEnabled() {
  return state.store.settings?.eventSuggestionsEnabled !== false
}

function renderEventLocationSettings() {
  const enabled = eventSuggestionsEnabled()
  eventSuggestionsEnabledInput.checked = enabled
  eventLocationSetup.classList.toggle('hidden', !enabled)
  const location = configuredEventLocation()
  eventCityInput.value = location?.city || ''
  const countryCode = location?.countryCode || ''
  const isOther = !!location && !PARTY_EVENT_COUNTRY_CODES.has(countryCode)
  eventCountrySelect.value = isOther ? 'OTHER' : countryCode
  eventCountryOtherInput.value = isOther ? location.country : ''
  syncOtherCountryField()
  eventLocationStatus.textContent = location ? `Current: ${location.city}, ${location.country}` : ''
}

function setEventSuggestionsEnabled(enabled) {
  if (!state.store.settings) state.store.settings = {}
  state.store.settings.eventSuggestionsEnabled = !!enabled
  if (enabled) state.eventSuggestionsDismissedNotice = false
  state.currentEventLookupRequest++
  state.currentEventLookupKey = ''
  state.currentEventLookup = null
  persist()
  renderEventLocationSettings()
  renderSetMetadataHeader()
  if (enabled) lookupNextDjEvents({ force: true })
}

function dismissEventSuggestions() {
  state.eventSuggestionsDismissedNotice = true
  setEventSuggestionsEnabled(false)
}

function openEventLocationSettings() {
  switchSidebarPanel('settings')
  sidebarAutoHidden = false
  sidebar.classList.remove('collapsed')
  document.body.classList.remove('sidebar-player-hidden')
  setSidebarWidthVar()
  requestAnimationFrame(() => {
    eventCityInput.focus()
    eventCityInput.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

function changeEventLocation() {
  openEventLocationSettings()
  eventCityInput.value = ''
  eventCountrySelect.value = ''
  eventCountryOtherInput.value = ''
  syncOtherCountryField()
  eventLocationStatus.textContent = 'Choose a new city and country.'
  requestAnimationFrame(() => eventCityInput.focus())
}

function eventLocationControlHtml(location) {
  return `<span class="set-event-location-control">
    <span>location: ${escHtml(location.city)}, ${escHtml(location.country)} <button type="button" class="set-event-change-location">change</button></span>
    <button type="button" class="set-event-dismiss"><span aria-hidden="true">×</span> stop suggesting events in my city</button>
  </span>`
}

async function saveEventLocation() {
  const city = eventCityInput.value.trim()
  const selection = eventCountrySelect.value
  const countryCode = selection === 'OTHER' ? '' : selection
  const country = selection === 'OTHER' ? eventCountryOtherInput.value.trim() : countryCode ? countryName(countryCode) : ''
  if (!city || !selection || !country) {
    eventLocationStatus.textContent = 'Enter a city and choose a country.'
    ;(selection === 'OTHER' ? eventCountryOtherInput : eventCityInput).focus()
    return
  }
  btnSaveEventLocation.disabled = true
  btnSaveEventLocation.textContent = 'Checking city…'
  eventLocationStatus.textContent = 'Matching the exact city with Resident Advisor…'
  try {
    const location = await window.api.resolveEventLocation({ city, country, countryCode })
    if (!state.store.settings) state.store.settings = {}
    state.store.settings.eventLocation = location
    await window.api.setStore(state.store)
    renderEventLocationSettings()
    state.currentEventLookupKey = ''
    renderSetMetadataHeader()
    lookupNextDjEvents({ force: true })
  } catch (error) {
    eventLocationStatus.textContent = error?.message || 'Could not verify that city. Try again.'
  } finally {
    btnSaveEventLocation.disabled = false
    btnSaveEventLocation.textContent = 'Save location'
  }
}

function renderNextDjEvents() {
  if (automaticEventLookupsBlocked()) {
    setEventLookup.innerHTML = ''
    setEventLookup.classList.add('hidden')
    return
  }
  if (!eventSuggestionsEnabled()) {
    if (!state.eventSuggestionsDismissedNotice) {
      setEventLookup.innerHTML = ''
      setEventLookup.classList.add('hidden')
      return
    }
    setEventLookup.classList.remove('hidden')
    setEventLookup.innerHTML = `<div class="set-event-dismissed-notice">You will not be informed about events in your city anymore. You can re-enable suggesting events from Settings anytime. <button type="button" class="set-event-dismiss-undo">undo</button></div>`
    setEventLookup.querySelector('.set-event-dismiss-undo')?.addEventListener('click', () => setEventSuggestionsEnabled(true))
    return
  }
  setEventLookup.classList.remove('hidden')
  const location = configuredEventLocation()
  if (!location) {
    setEventLookup.innerHTML = `<span><button type="button" class="set-event-location-cta">Add your location</button> info to find out when these DJs are playing in your city next</span>`
    setEventLookup.querySelector('.set-event-location-cta').addEventListener('click', openEventLocationSettings)
    return
  }

  const djNames = state.currentSetMetadata?.djNames || []
  if (!djNames.length) {
    setEventLookup.innerHTML = ''
    setEventLookup.classList.add('hidden')
    return
  }
  if (state.currentEventLookup?.status === 'checking') {
    const progress = state.currentEventLookup.progress
    const artist = progress?.artist || djNames[0]
    const sources = progress?.activeSourceNames?.join(' + ')
    const count = progress?.total ? ` · ${progress.completed}/${progress.total} sources checked` : ''
    const activity = sources
      ? `Checking ${escHtml(artist)} on ${escHtml(sources)}…${count}`
      : `Preparing the lookup for ${escHtml(artist)}…${count}`
    setEventLookup.innerHTML = `
      <div class="set-event-status-row">
        <span class="set-event-lookup-status"><span class="set-event-activity-dot" aria-hidden="true"></span>${activity}</span>
      </div>
      ${eventLocationControlHtml(location)}`
    wireEventLocationChange()
    return
  }
  const matches = (state.currentEventLookup?.results || []).filter(result => result.event)
  if (!matches.length) {
    const unavailable = (state.currentEventLookup?.results || []).some(result => result.unavailableSources?.length)
    setEventLookup.innerHTML = `
      <div class="set-event-status-row">
        <span class="set-event-lookup-status">${unavailable ? 'No date found; some event sources could not be checked.' : `No upcoming dates found in ${escHtml(location.city)}.`}</span>
      </div>
      ${eventLocationControlHtml(location)}`
    wireEventLocationChange()
    return
  }
  setEventLookup.innerHTML = matches.map((result, index) => `
    <div class="set-event-line">
      <div class="set-event-summary-clip"><span class="set-event-summary-text"><strong>${escHtml(result.artist)}</strong> — ${eventSummaryHtml(result)}</span></div>
      <button type="button" class="set-event-link" data-event-index="${index}">${escHtml(result.event.sourceName)} ↗</button>
    </div>
  `).join('') + eventLocationControlHtml(location)
  setEventLookup.querySelectorAll('.set-event-link').forEach(button => {
    button.addEventListener('click', () => {
      const url = matches[Number(button.dataset.eventIndex)]?.event?.url
      if (url) window.api.openExternal(url)
    })
  })
  setEventLookup.querySelectorAll('.set-event-line').forEach(line => {
    wireOverflowMarquee(line.querySelector('.set-event-summary-text'), line)
  })
  wireEventLocationChange()
}

function normalizedEventDisplayText(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').trim().toLowerCase()
}

function compactEventTitle(title, artist, venue) {
  const artistKey = normalizedEventDisplayText(artist)
  const parts = String(title || '')
    .split(/\s*(?::|\||—|–)\s*/)
    .map(part => part.trim())
    .filter(part => part && normalizedEventDisplayText(part) !== artistKey)
  const compact = parts.join(' — ')
  return normalizedEventDisplayText(compact) === normalizedEventDisplayText(venue) ? '' : compact
}

function eventSummaryHtml(result) {
  const event = result.event
  const title = compactEventTitle(event.title, result.artist, event.venue)
  const lead = [escHtml(event.dateLabel), ...(title ? [escHtml(title)] : [])].join(' · ')
  return `${lead} <span class="set-event-venue">@ ${escHtml(event.venue)}</span>`
}

function wireEventLocationChange() {
  setEventLookup.querySelector('.set-event-change-location')?.addEventListener('click', changeEventLocation)
  setEventLookup.querySelector('.set-event-dismiss')?.addEventListener('click', dismissEventSuggestions)
}

async function lookupNextDjEvents({ force = false } = {}) {
  if (automaticEventLookupsBlocked()) {
    state.currentEventLookup = null
    setEventLookup.classList.add('hidden')
    return
  }
  if (!eventSuggestionsEnabled()) {
    state.currentEventLookup = null
    setEventLookup.classList.add('hidden')
    return
  }
  const location = configuredEventLocation()
  const djNames = state.currentSetMetadata?.djNames || []
  if (!location || !state.currentSetUrl || !djNames.length) {
    state.currentEventLookup = null
    renderNextDjEvents()
    return
  }
  const key = [state.currentSetUrl, location.city, location.countryCode, ...djNames].join('|').toLowerCase()
  if (!force && key === state.currentEventLookupKey) return
  state.currentEventLookupKey = key
  const request = ++state.currentEventLookupRequest
  const sourceUrl = state.currentSetUrl
  state.currentEventLookup = { status: 'checking', results: [], progress: null }
  renderNextDjEvents()
  try {
    const payload = await window.api.lookupNextEvents({ sourceUrl, djNames, requestId: request })
    if (request !== state.currentEventLookupRequest || payload?.sourceUrl !== state.currentSetUrl) return
    state.currentEventLookup = { status: 'ready', results: payload.results || [] }
  } catch (error) {
    if (request !== state.currentEventLookupRequest) return
    state.currentEventLookup = { status: 'error', results: [], message: error?.message }
  }
  renderNextDjEvents()
}

const SET_SERVICE_ORDER = [
  { id: '1001tracklists', label: '1001Tracklists' },
  { id: 'set79', label: 'set79' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'soundcloud', label: 'SoundCloud' },
]

const SET_AVAILABILITY_LABELS = {
  checking: 'checking',
  available: 'available',
  unavailable: 'not found',
  error: 'error',
  skipped: 'not checked',
}

function mergeSetMetadata(existing, incoming) {
  const savedExisting = savedSetMetadata(existing)
  const savedIncoming = savedSetMetadata(incoming)
  return {
    ...(existing || {}),
    ...(incoming || {}),
    djNames: normalizedDjNames([...(savedExisting.djNames || []), ...(savedIncoming.djNames || [])]),
    venue: savedExisting.venue || savedIncoming.venue || null,
    event: savedExisting.event || savedIncoming.event || null,
    date: savedExisting.date || savedIncoming.date || null,
  }
}

function titleContainsLibraryValue(title, value) {
  const normalize = text => String(text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  const titleKey = normalize(title)
  const valueKey = normalize(value)
  return valueKey.length >= 3 && ` ${titleKey} `.includes(` ${valueKey} `)
}

function metadataLibraryValues(field) {
  const seen = new Map()
  ;[...(state.store.favorites || []), ...(state.store.history || [])].forEach(set => {
    const values = field === 'djNames' ? normalizedDjNames(set.djNames) : [normalizedMetadataText(set[field])].filter(Boolean)
    values.forEach(value => {
      const key = librarySearchKey(value)
      if (key && !seen.has(key)) seen.set(key, value)
    })
  })
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

function setMetadataSuggestions() {
  const metadata = state.currentSetMetadata || {}
  const suggestions = []
  const currentDjs = new Set(normalizedDjNames(metadata.djNames).map(name => librarySearchKey(name)))

  metadataLibraryValues('djNames').forEach(name => {
    if (!currentDjs.has(librarySearchKey(name)) && titleContainsLibraryValue(state.currentSetTitle, name)) {
      suggestions.push({ field: 'djNames', label: 'DJ', value: name })
    }
  })

  for (const field of ['event', 'venue', 'date']) {
    metadataLibraryValues(field).forEach(value => {
      if (!metadata[field] && titleContainsLibraryValue(state.currentSetTitle, value)) {
        suggestions.push({ field, label: field, value })
      }
    })
  }

  // A just-removed value is always a useful suggestion: unlike the broader
  // library matches, it has already been confirmed for this exact set.
  ;(state.metadataRemovedValues || []).forEach(removed => {
    const isPresent = removed.field === 'djNames'
      ? currentDjs.has(librarySearchKey(removed.value))
      : librarySearchKey(metadata[removed.field]) === librarySearchKey(removed.value)
    if (!isPresent) suggestions.push(removed)
  })

  const seen = new Set()
  return suggestions.filter(suggestion => {
    const key = `${suggestion.field}:${librarySearchKey(suggestion.value)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function formatCompactViews(value) {
  if (!Number.isFinite(value)) return null
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function hasNoSoundCloudMatch(waiting, services) {
  return !waiting && services.soundcloud?.status === 'unavailable'
}

function automaticSetLookupsSuppressed(services = state.currentSetAvailability?.services || {}) {
  return services.set79?.status === 'skipped'
}

function automaticEventLookupsBlocked() {
  return state.automaticLookupDecisionPending || automaticSetLookupsSuppressed()
}

function metadataOutlookCopy(waiting, services) {
  const outlook = state.currentSourceStats?.metadataOutlook
  if (automaticSetLookupsSuppressed(services)) {
    return 'This seems too short to be a DJ set. Cowardly refusing to look up any additional info on it. You can still try Auto.'
  }
  if (hasNoSoundCloudMatch(waiting, services)) {
    return "No SoundCloud match — set79 can't look this set up yet."
  }
  if (!waiting && services.soundcloud?.status === 'error') return "set79 couldn't be checked right now."
  if (waiting) return 'Attempting to get DJ set details from set79…'
  if (outlook?.kind === 'likely') return `Popular recent set (${formatCompactViews(outlook.viewCount)} plays) — metadata is likely to arrive soon.`
  if (outlook?.kind === 'unlikely') return 'Older, low-play set — more metadata is unlikely.'
  return 'No community metadata found yet.'
}

function applySetMetadataValue(field, rawValue) {
  const value = String(rawValue || '').trim()
  if (!value || !state.currentSetUrl) return
  const current = mergeSetMetadata(null, state.currentSetMetadata)
  if (field === 'djNames') current.djNames = normalizedDjNames([...(current.djNames || []), value])
  else if (field === 'event' || field === 'venue' || field === 'date') current[field] = value
  else return
  state.metadataRemovedValues = (state.metadataRemovedValues || []).filter(removed => (
    removed.field !== field || librarySearchKey(removed.value) !== librarySearchKey(value)
  ))
  state.currentSetMetadata = current
  tagSavedSetMetadata(state.currentSetUrl, current, { overwrite: true })
  state.currentEventLookupKey = ''
  renderSetMetadataHeader()
  lookupNextDjEvents()
}

function acceptSetMetadataSuggestions(suggestions) {
  if (!state.currentSetUrl || !suggestions.length) return
  const current = mergeSetMetadata(null, state.currentSetMetadata)
  const accepted = new Set()

  suggestions.forEach(({ field, value }) => {
    const key = `${field}:${librarySearchKey(value)}`
    if (field === 'djNames') {
      current.djNames = normalizedDjNames([...(current.djNames || []), value])
      accepted.add(key)
    } else if ((field === 'event' || field === 'venue' || field === 'date') && !current[field]) {
      current[field] = value
      accepted.add(key)
    }
  })

  if (!accepted.size) return
  state.metadataRemovedValues = (state.metadataRemovedValues || []).filter(removed => (
    !accepted.has(`${removed.field}:${librarySearchKey(removed.value)}`)
  ))
  state.currentSetMetadata = current
  state.metadataEditMode = null
  tagSavedSetMetadata(state.currentSetUrl, current, { overwrite: true })
  state.currentEventLookupKey = ''
  renderSetMetadataHeader()
  lookupNextDjEvents()
}

function removeSetMetadataValue(field, rawValue) {
  const value = String(rawValue || '').trim()
  if (!value || !state.currentSetUrl) return
  const current = mergeSetMetadata(null, state.currentSetMetadata)
  if (field === 'djNames') {
    current.djNames = normalizedDjNames(current.djNames).filter(name => librarySearchKey(name) !== librarySearchKey(value))
  } else if (field === 'event' || field === 'venue' || field === 'date') {
    current[field] = null
  } else {
    return
  }
  const label = field === 'djNames' ? 'DJ' : field
  state.metadataRemovedValues = [
    ...(state.metadataRemovedValues || []).filter(removed => (
      removed.field !== field || librarySearchKey(removed.value) !== librarySearchKey(value)
    )),
    { field, label, value },
  ]
  state.currentSetMetadata = current
  tagSavedSetMetadata(state.currentSetUrl, current, { overwrite: true, replace: true })
  state.currentEventLookupKey = ''
  renderSetMetadataHeader()
  lookupNextDjEvents()
}

function beginSetMetadataEdit(button, field) {
  state.metadataEditMode = true
  const form = document.createElement('form')
  form.className = 'set-metadata-editor'
  const input = document.createElement('input')
  input.type = 'text'
  input.autocomplete = 'off'
  input.placeholder = field === 'djNames' ? 'DJ name' : field
  input.setAttribute('aria-label', `Add ${field === 'djNames' ? 'DJ name' : field}`)
  const submit = document.createElement('button')
  submit.type = 'submit'
  submit.textContent = 'add'
  const autocomplete = document.createElement('div')
  autocomplete.className = 'set-metadata-autocomplete hidden'
  form.append(input, submit, autocomplete)
  button.replaceWith(form)
  input.focus()

  const renderAutocomplete = () => {
    const query = librarySearchKey(input.value)
    const selectedValues = new Set(
      (field === 'djNames' ? normalizedDjNames(state.currentSetMetadata?.djNames) : [])
        .map(librarySearchKey)
    )
    const matches = metadataLibraryValues(field)
      .filter(value => !selectedValues.has(librarySearchKey(value)))
      .filter(value => !query || librarySearchKey(value).includes(query))
      .sort((a, b) => {
        const aStarts = librarySearchKey(a).startsWith(query) ? 0 : 1
        const bStarts = librarySearchKey(b).startsWith(query) ? 0 : 1
        return aStarts - bStarts || a.localeCompare(b, undefined, { sensitivity: 'base' })
      })
      .slice(0, 6)
    autocomplete.innerHTML = matches.map((value, index) => `<button type="button" data-autocomplete-index="${index}">${escHtml(value)}</button>`).join('')
    autocomplete.classList.toggle('hidden', !matches.length)
    autocomplete.querySelectorAll('button').forEach(option => {
      option.addEventListener('mousedown', event => event.preventDefault())
      option.addEventListener('click', () => applySetMetadataValue(field, matches[Number(option.dataset.autocompleteIndex)]))
    })
  }
  renderAutocomplete()
  input.addEventListener('input', renderAutocomplete)
  form.addEventListener('submit', event => {
    event.preventDefault()
    if (input.value.trim()) applySetMetadataValue(field, input.value)
    else renderSetMetadataHeader()
  })
  input.addEventListener('keydown', event => {
    if (event.key === 'Escape') renderSetMetadataHeader()
  })
  input.addEventListener('blur', () => setTimeout(() => {
    if (form.isConnected && !form.contains(document.activeElement)) renderSetMetadataHeader()
  }, 0))
}

function openMetadataLibraryValue(field, value) {
  const key = librarySearchKey(value)
  document.body.classList.remove('is-browsing')
  showLibrary()
  if (field === 'djNames') {
    const entity = favoriteDjLibrary().find(dj => librarySearchKey(dj.name) === key)
    if (entity) showDjLibraryDetail(entity)
    else {
      showDjLibraryOverview()
      librarySearchInput.value = value
      renderDjLibrary()
    }
  } else if (field === 'event' || field === 'venue') {
    setEventVenueLibraryType(field)
    const entity = favoriteEventVenueLibrary(field).find(group => group.key === key)
    if (entity) showEventVenueLibraryDetail(entity)
    else {
      showDjLibraryOverview()
      eventVenueLibrarySearchInput.value = value
      renderEventVenueLibrary()
    }
  }
  updateViewTabs()
}

function wireSetMetadataActions(suggestions, facts) {
  setMetadataTags.querySelectorAll('.set-metadata-library-link').forEach(button => {
    button.addEventListener('click', () => {
      const fact = facts[Number(button.dataset.metadataIndex)]
      if (fact) openMetadataLibraryValue(fact.field, fact.value)
    })
  })
  setMetadataTags.querySelectorAll('.set-metadata-remove').forEach(button => {
    button.addEventListener('click', () => {
      const fact = facts[Number(button.dataset.metadataIndex)]
      if (fact) removeSetMetadataValue(fact.field, fact.value)
    })
  })
  setMetadataTags.querySelectorAll('.set-metadata-add').forEach(button => {
    button.addEventListener('click', () => beginSetMetadataEdit(button, button.dataset.metadataField))
  })
  setMetadataTags.querySelectorAll('.set-metadata-suggestion').forEach(button => {
    button.addEventListener('click', () => {
      const suggestion = suggestions[Number(button.dataset.suggestionIndex)]
      if (suggestion) applySetMetadataValue(suggestion.field, suggestion.value)
    })
  })
  setMetadataTags.querySelector('.set-metadata-accept-suggestions')?.addEventListener('click', () => {
    acceptSetMetadataSuggestions(suggestions)
  })
  setMetadataTags.querySelector('.set-metadata-complete')?.addEventListener('click', event => {
    beginSetMetadataEdit(event.currentTarget, 'djNames')
  })
}

function renderSetMetadataHeader() {
  if (!state.currentSetUrl) {
    setMetadataHeader.classList.add('hidden')
    return
  }

  const metadata = state.currentSetMetadata || {}
  const services = state.currentSetAvailability?.services || {}
  const suggestions = setMetadataSuggestions()
  const facts = [
    ...(metadata.djNames || []).map(value => ({ field: 'djNames', label: 'DJ', value })),
    ...(metadata.venue ? [{ field: 'venue', label: 'venue', value: metadata.venue }] : []),
    ...(metadata.event ? [{ field: 'event', label: 'event', value: metadata.event }] : []),
    ...(metadata.date ? [{ field: 'date', label: 'date', value: metadata.date }] : []),
  ]
  const waiting = services.set79?.status === 'checking'
  const noSoundCloudMatch = hasNoSoundCloudMatch(waiting, services)
  const automaticLookupsSuppressed = automaticSetLookupsSuppressed(services)
  const editMode = state.metadataEditMode == null
    ? facts.length === 0 && !noSoundCloudMatch && !automaticLookupsSuppressed
    : state.metadataEditMode
  const set79Checking = services.set79?.status === 'checking'
  const metadataRefreshing = state.metadataOverwriteOnSet79 || set79Checking
  setMetadataHeader.classList.toggle('is-editing', editMode)
  btnSetMetadataEdit.textContent = editMode ? 'done' : 'edit'
  btnSetMetadataEdit.setAttribute('aria-pressed', String(editMode))
  btnSetMetadataRefresh.classList.toggle('is-refreshing', metadataRefreshing)
  btnSetMetadataRefresh.setAttribute('aria-busy', String(metadataRefreshing))
  if (!state.metadataOverwriteOnSet79) {
    btnSetMetadataRefresh.disabled = !services.set79 || set79Checking
  }

  const factPills = facts.map(({ field, label, value }, index) => editMode ? `
      <span class="set-metadata-pill is-editing-value">
        <span class="set-metadata-pill-label">${escHtml(label)}</span>
        <span>${escHtml(value)}</span>
        <button type="button" class="set-metadata-remove" data-metadata-index="${index}" aria-label="Remove ${escHtml(label)} ${escHtml(value)}" title="Remove ${escHtml(value)}">×</button>
      </span>
    ` : field === 'date' ? `
      <span class="set-metadata-pill">
        <span class="set-metadata-pill-label">${escHtml(label)}</span>
        <span>${escHtml(value)}</span>
      </span>
    ` : `
      <button type="button" class="set-metadata-pill set-metadata-library-link" data-metadata-index="${index}" title="Open ${escHtml(value)} in Library">
        <span class="set-metadata-pill-label">${escHtml(label)}</span>
        <span>${escHtml(value)}</span>
      </button>
    `).join('')
  const suggestionPills = editMode ? suggestions.map((suggestion, index) => `
    <button type="button" class="set-metadata-suggestion" data-suggestion-index="${index}" title="Found in this set title">
      <span class="set-metadata-pill-label">+ ${escHtml(suggestion.label)}</span>
      <span>${escHtml(suggestion.value)}</span>
    </button>
  `).join('') : ''
  const addPills = editMode ? [
    { field: 'djNames', label: '+ DJ' },
    ...(!metadata.event ? [{ field: 'event', label: '+ event' }] : []),
    ...(!metadata.venue ? [{ field: 'venue', label: '+ venue' }] : []),
    ...(!metadata.date ? [{ field: 'date', label: '+ date' }] : []),
  ].map(({ field, label }) => `<button type="button" class="set-metadata-add" data-metadata-field="${field}">${label}</button>`).join('') : ''
  const acceptSuggestionsAction = editMode && suggestions.length
    ? '<button type="button" class="set-metadata-recovery-action set-metadata-accept-suggestions">accept suggestions</button>'
    : ''
  const recoveryAction = facts.length === 0 && noSoundCloudMatch && !editMode && !suggestions.length
    ? '<button type="button" class="set-metadata-recovery-action set-metadata-complete">complete metadata</button>'
    : ''
  const recoveryCopy = noSoundCloudMatch && !suggestions.length
    ? `${metadataOutlookCopy(waiting, services)} You can complete the metadata yourself if you like.`
    : metadataOutlookCopy(waiting, services)

  if (facts.length) {
    setMetadataTags.innerHTML = factPills + suggestionPills + acceptSuggestionsAction + addPills
  } else {
    setMetadataTags.innerHTML = `
      <div class="set-metadata-recovery">
        <span class="set-metadata-empty-detail">${escHtml(recoveryCopy)}</span>
        ${recoveryAction}
      </div>
      ${suggestionPills}${acceptSuggestionsAction}${addPills}`
  }

  wireSetMetadataActions(suggestions, facts)

  renderNextDjEvents()
  setMetadataHeader.classList.remove('hidden')
}

function renderSetSources() {
  if (!state.currentSetUrl) {
    npSource.innerHTML = ''
    return
  }

  const services = state.currentSetAvailability?.services || {}
  const sourceItems = SET_SERVICE_ORDER.map(({ id, label }, index) => {
      const status = services[id]?.status || 'checking'
      const statusLabel = SET_AVAILABILITY_LABELS[status] || status
      const url = status === 'available' ? services[id]?.url : null
      const tag = url ? 'button' : 'span'
      const attrs = url ? ` type="button" data-service-index="${index}"` : ''
      const external = url ? '<span aria-hidden="true">↗</span>' : ''
      return `<${tag} class="set-availability-pill status-${escHtml(status)}${url ? ' is-clickable' : ''}" title="${escHtml(label)}: ${escHtml(statusLabel)}" aria-label="${escHtml(label)}: ${escHtml(statusLabel)}"${attrs}><span class="set-availability-dot" aria-hidden="true"></span>${escHtml(label)}${external}</${tag}>`
    })
  npSource.innerHTML = [sourceItems.slice(0, 2), sourceItems.slice(2)]
    .map(row => `<div class="np-source-row">${row.join('')}</div>`)
    .join('')
  npSource.querySelectorAll('.set-availability-pill.is-clickable').forEach(button => {
    button.addEventListener('click', () => {
      const service = SET_SERVICE_ORDER[Number(button.dataset.serviceIndex)]
      const url = service && services[service.id]?.url
      if (url) window.api.openExternal(url)
    })
  })
}

function renderTracklistProviderChoice() {
  const options = state.currentTracklistOptions || []
  const selectedId = state.currentTracklistProvider
  const selected = options.find(option => option.id === selectedId)

  if (!selected) {
    tracklistProviderChoice.classList.add('hidden')
    tracklistProviderChoice.innerHTML = ''
    return
  }

  if (options.length === 1) {
    tracklistProviderChoice.className = 'tracklist-provider-choice is-single'
    tracklistProviderChoice.innerHTML = `
      <span class="tracklist-provider-label">tracklist source</span>
      <span class="tracklist-provider-value">${escHtml(selected.name)}</span>
    `
    return
  }

  tracklistProviderChoice.className = 'tracklist-provider-choice'
  tracklistProviderChoice.innerHTML = `
    <span class="tracklist-provider-label">tracklist source</span>
    <div class="tracklist-provider-pills" role="radiogroup" aria-label="Tracklist provider">
      ${options.map((option, index) => `
        <button type="button" class="tracklist-provider-pill${option.id === selectedId ? ' active' : ''}"
          role="radio" aria-checked="${option.id === selectedId}" data-provider-index="${index}">
          ${escHtml(option.name)}
        </button>
      `).join('')}
    </div>
  `

  tracklistProviderChoice.querySelectorAll('.tracklist-provider-pill').forEach(button => {
    button.addEventListener('click', async () => {
      const option = options[Number(button.dataset.providerIndex)]
      if (!option || option.id === state.currentTracklistProvider) return
      const buttons = tracklistProviderChoice.querySelectorAll('.tracklist-provider-pill')
      buttons.forEach(item => { item.disabled = true })
      try {
        await window.api.selectTracklistProvider(option.id)
      } finally {
        buttons.forEach(item => { item.disabled = false })
      }
    })
  })
}

async function autoSetMetadata() {
  if (!state.currentSetUrl || btnSetMetadataRefresh.disabled) return
  const sourceUrl = state.currentSetUrl
  btnSetMetadataRefresh.disabled = true
  btnSetMetadataRefresh.classList.add('is-refreshing')
  state.metadataOverwriteOnSet79 = true
  state.metadataRemovedValues = []
  tagSavedSetMetadata(sourceUrl, state.currentSetMetadata, { overwrite: true, replace: true })
  state.currentEventLookupKey = ''
  state.currentEventLookup = null
  try {
    await window.api.autoSetMetadata()
  } finally {
    state.metadataOverwriteOnSet79 = false
    if (state.currentSetUrl === sourceUrl) {
      renderSetMetadataHeader()
    }
  }
}

function openAboutDialog() {
  if (appVersion) aboutVersion.textContent = `v${appVersion}`
  aboutDialog.classList.remove('hidden')
}

function closeAboutDialog() {
  aboutDialog.classList.add('hidden')
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
let browserHasContent = false
let hasEverPlayed = false
let browseLoadingTimer = null

function updateViewTabs() {
  const browsing = document.body.classList.contains('is-browsing')
  const introVisible = !introScreen.classList.contains('hidden')
  const libraryVisible = !libraryScreen.classList.contains('hidden')
  btnViewHome.classList.toggle('active', introVisible)
  btnViewLibrary.classList.toggle('active', libraryVisible)
  btnViewNowplaying.classList.toggle('active', !introVisible && !libraryVisible && !browsing)
  btnViewSearch.classList.toggle('active', !introVisible && !libraryVisible && browsing)
  btnViewNowplaying.classList.toggle('tab-disabled', !hasEverPlayed)
  btnViewSearch.classList.toggle('tab-disabled', !browserHasContent)
}

function setTrackPlaying(playing) {
  state.isTrackPlaying = playing
  document.body.classList.toggle('is-track-playing', playing)
}

function showNowPlayingTrack() {
  if (!state.currentSetUrl) return
  hideIntro()
  document.body.classList.remove('is-browsing')
  updateViewTabs()
  const trackNum = state.nowPlaying?.trackNum
  if (trackNum) requestAnimationFrame(() => highlightTracklistByNum(trackNum))
}

// Reusable edge mask for a scrolling layer. At rest it leaves content untouched;
// once moving, content becomes fully transparent at the edge and fades in below.
function wireScrollEdgeFade(container, { size = 24, threshold = 1, wheelSurface = null } = {}) {
  if (!container) return
  container.classList.add('scroll-edge-fade')
  container.style.setProperty('--scroll-fade-size', `${size}px`)
  const update = () => container.classList.toggle('is-scrolled', container.scrollTop >= threshold)
  container.addEventListener('scroll', update, { passive: true })
  wheelSurface?.addEventListener('wheel', event => {
    container.scrollTop += event.deltaY
    event.preventDefault()
  }, { passive: false })
  update()
}

function hideBrowseLoading(reason) {
  if (!browseLoading.classList.contains('hidden')) {
    console.log('[browser-wv] hideBrowseLoading via=' + reason)
  }
  clearTimeout(browseLoadingTimer)
  browseLoadingTimer = null
  browseLoading.classList.add('hidden')
}

function navigateTo(url, loadingLabel) {
  console.log('[browser-wv] navigateTo ready=' + browserWebviewReady + ' url=' + url)
  browserHasContent = true
  hideIntro()
  document.body.classList.add('is-browsing')
  updateViewTabs()
  browseLoadingMsg.textContent = loadingLabel || 'Loading…'
  browseLoading.classList.remove('hidden')
  // Fallback: force-hide after 12s in case did-stop-loading never fires (observed on Windows)
  clearTimeout(browseLoadingTimer)
  browseLoadingTimer = setTimeout(() => {
    console.warn('[browser-wv] browse loading timeout — force-hiding spinner')
    hideBrowseLoading('timeout')
  }, 12000)
  if (browserWebviewReady) {
    browserWebview.loadURL(url).catch(e => {
      console.error('[browser-wv] loadURL failed', e)
      hideBrowseLoading('loadURL-error')
    })
  } else {
    console.log('[browser-wv] not ready — queuing nav')
    pendingNav = url
  }
}

async function init() {
  // Register webview dom-ready listeners BEFORE any await — the about:blank src fires
  // dom-ready almost instantly, and any IPC await between here and the old listener site
  // was enough to miss the event, leaving playerWvContents unset and pendingSourceUrl
  // stuck forever (Searching tracklist… spinner hangs on startup).
  webview.addEventListener('dom-ready', () => {
    webviewReady = true
    window.api.registerWebviewRole(webview.getWebContentsId(), 'player')
  })

  browserWebview.addEventListener('dom-ready', () => {
    console.log('[browser-wv] dom-ready pendingNav=' + pendingNav)
    browserWebviewReady = true
    window.api.registerWebviewRole(browserWebview.getWebContentsId(), 'browser')
    if (pendingNav) {
      console.log('[browser-wv] flushing pendingNav=' + pendingNav)
      browserWebview.loadURL(pendingNav).catch(e => console.error('[browser-wv] pendingNav loadURL failed', e))
      pendingNav = null
    }
  })

  populateEventCountries()
  state.store = await window.api.getStore()
  renderEventLocationSettings()
  state.stats = await window.api.getStats()
  setLibraryViewMode(state.store.settings?.libraryViewMode || 'grid', false)
  setEventVenueLibraryType(state.store.settings?.eventVenueLibraryType || 'event', false)
  setEventVenueLibraryViewMode(state.store.settings?.eventVenueLibraryViewMode || 'grid', false)
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
  renderHistory()  // also calls renderIntroResume()
  updateListenTimeSep()
  updateViewTabs()
  wireFooterMarquees()

  // Restore which sidebar panel was open when the app was last closed
  const savedPanel = state.store.settings?.activeSidebarPanel
  const activePanel = savedPanel === 'event-venues' ? 'events' : savedPanel
  if (savedPanel === 'event-venues') state.store.settings.activeSidebarPanel = activePanel
  if (activePanel) applySidebarPanel(activePanel)

  state.lfmStatus = await window.api.lfmStatusGet()
  refreshScrobbleBadge()
  await loadSettings()
  syncResumeSettingUI()

  // did-finish-load fires when the main frame HTML is done — reliable on Windows even when
  // did-stop-loading never fires (YouTube background requests keep isLoading() true forever).
  browserWebview.addEventListener('did-finish-load', () => {
    console.log('[browser-wv] did-finish-load url=' + browserWebview.getURL())
    hideBrowseLoading('did-finish-load')
  })

  browserWebview.addEventListener('did-fail-load', (e) => {
    // errorCode -3 is ERR_ABORTED which fires on every redirect — not a real failure.
    if (e.errorCode === -3) return
    console.log('[browser-wv] did-fail-load code=' + e.errorCode + ' url=' + e.validatedURL)
    hideBrowseLoading('did-fail-load')
  })

  browserWebview.addEventListener('did-stop-loading', () => {
    console.log('[browser-wv] did-stop-loading url=' + browserWebview.getURL())
    hideBrowseLoading('did-stop-loading')
  })

  const resetBrowserWebview = (reason) => {
    console.warn('[browser-wv] renderer gone reason=' + reason + ' — resetting ready flag')
    browserWebviewReady = false
    hideBrowseLoading('renderer-gone')
  }
  browserWebview.addEventListener('render-process-gone', (e) => resetBrowserWebview(e.reason || 'unknown'))
  browserWebview.addEventListener('crashed', () => resetBrowserWebview('crashed'))

  wireScrollEdgeFade(tracklistScrollRegion, { size: 28, wheelSurface: setMetadataHeader })
  wireEvents()
  wireMainEvents()
  // No default navigation — show intro screen
}

// ── Intro screen ──────────────────────────────────────────────────────────────

function hideIntro() {
  introScreen.classList.add('hidden')
  libraryScreen.classList.add('hidden')
}

function showIntro() {
  libraryScreen.classList.add('hidden')
  introScreen.classList.remove('hidden')
  // Re-render after layout so we can measure the actual available width
  requestAnimationFrame(renderIntroResume)
}

function showLibrary() {
  introScreen.classList.add('hidden')
  libraryScreen.classList.remove('hidden')
  requestAnimationFrame(() => {
    renderDjLibrary()
    renderEventVenueLibrary()
  })
}

// Must match the CSS --item width and gap for the resume grid
const RESUME_ITEM_W = 155
const RESUME_ITEM_GAP = 8

function countResumeSlots() {
  // Use the full intro-screen width minus horizontal padding (16px × 2 = 32px)
  const screenW = introScreen.offsetWidth
  const avail = screenW > 0
    ? Math.max(280, screenW - 32)
    : mainContent ? Math.max(280, mainContent.offsetWidth - 32) : 468
  return Math.max(2, Math.floor((avail + RESUME_ITEM_GAP) / (RESUME_ITEM_W + RESUME_ITEM_GAP)))
}

function renderIntroResume() {
  const totalSlots = countResumeSlots()
  const maxHistory = totalSlots - 1 // last slot is always the ghost "browse history" card

  // Only YouTube sets that have meaningful progress (5–94%)
  const items = state.store.history.filter(item => {
    const pct = getProgressPct(item)
    return pct >= 5 && pct < 95 && isYouTubeSourceUrl(item.url)
  }).slice(0, maxHistory)

  introResumeSection.classList.toggle('hidden', items.length === 0)
  introResumeGrid.innerHTML = ''

  items.forEach(item => {
    const pct = getProgressPct(item)
    const fav = isFavorited(item.url)
    const thumbHtml = item.thumbnailUrl
      ? `<img class="intro-resume-thumb" src="${escHtml(item.thumbnailUrl)}" alt="" loading="lazy" />`
      : `<div class="intro-resume-thumb intro-resume-thumb-empty"></div>`
    const heartHtml = fav
      ? `<span class="intro-resume-heart" aria-hidden="true"><svg viewBox="0 0 24 24" width="8" height="8" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></span>`
      : ''
    const card = document.createElement('div')
    card.className = 'intro-resume-item'
    card.innerHTML = `
      ${thumbHtml}
      <div class="intro-resume-title-row">
        ${heartHtml}
        <div class="intro-resume-title-wrap">
          <span class="intro-resume-title-text">${escHtml(item.title || item.url)}</span>
        </div>
      </div>
      <div class="intro-resume-bar"><div class="intro-resume-bar-fill" style="width:${pct}%"></div></div>
    `
    // Always resume from where left off — no dialog for home screen quick-resume
    card.addEventListener('click', () => loadSet(item, true))
    wireOverflowMarquee(card.querySelector('.intro-resume-title-text'), card)
    introResumeGrid.appendChild(card)
  })

  // Ghost "browse history" card — single unified block, no split sections
  const ghost = document.createElement('div')
  ghost.className = 'intro-resume-item intro-resume-ghost'
  ghost.innerHTML = `
    <div class="intro-resume-ghost-thumb">
      <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span class="intro-resume-ghost-label">browse history</span>
    </div>
  `
  ghost.addEventListener('click', () => {
    document.querySelector('.nav-btn[data-panel="history"]')?.click()
  })
  introResumeGrid.appendChild(ghost)
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
let loadingWatchdogTimer = null
const LOADING_WATCHDOG_MS = 15_000
let pendingKeyboardSeekTarget = null
let pendingKeyboardVolumeTarget = null

function setSidebarWidthVar() {
  const w = sidebar.offsetWidth || DEFAULT_SIDEBAR_W
  document.documentElement.style.setProperty('--sidebar-w-current', `${w}px`)
  sidebar.classList.toggle('sidebar-narrow', w < DEFAULT_SIDEBAR_W)
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
  if (next === 'inline' && persistSetting) {
    hideIntro()
    document.body.classList.remove('is-browsing')
    updateViewTabs()
  }
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

// ── Lifetime listening stats ──────────────────────────────────────────────────

function formatListenTime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h === 0) return m <= 1 ? '<1m' : `${m}m`
  return `${h}h ${m}m`
}

function updateListenTimeSep() {
  const listenSec  = state.stats.totalListenedSeconds  || 0
  const tracks     = state.stats.totalTracksListened   || 0
  const sets       = state.store.history
    ? state.store.history.filter(item => getProgressPct(item) >= 5).length
    : 0

  if (sepListenTime)   sepListenTime.textContent  = formatListenTime(listenSec)
  if (sepSetsCount)    sepSetsCount.textContent    = sets
  if (sepTracksCount)  sepTracksCount.textContent  = tracks

  if (sepListenTooltip) {
    if (listenSec === 0 && sets === 0 && tracks === 0) {
      sepListenTooltip.innerHTML = '<div>Start listening to track your stats</div>'
    } else {
      const h = Math.floor(listenSec / 3600)
      const m = Math.floor((listenSec % 3600) / 60)
      const timePart = h > 0 ? `${h}h ${m}m` : `${m || '<1'}m`
      sepListenTooltip.innerHTML = [
        `<div class="stat-detail">Total listening time: ${timePart}</div>`,
        `<div class="stat-detail">Total DJ sets played: ${sets}</div>`,
        `<div class="stat-detail">Total tracks played: ${tracks}</div>`,
      ].join('')
    }
  }
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

// ── Seek shield ───────────────────────────────────────────────────────────────
// Masks YouTube's native controls/buffering flash on every programmatic seek.
// The shield appears instantly (transition: none on .active) and fades out
// 1 s after the last seek event — drag seeks keep resetting the timer so the
// shield stays up for the full drag duration, then fades once released.

let _seekShieldTimer  = null
let _seekPersistTimer = null

function flashSeekShield() {
  seekShield.classList.add('active')
  clearTimeout(_seekShieldTimer)
  _seekShieldTimer = setTimeout(() => seekShield.classList.remove('active'), 1000)
}

function playerSeek(seconds) {
  flashSeekShield()
  window.api.playerSeek(seconds)
  // Persist seek position soon — debounced so rapid seeks (held arrow key,
  // dragging progress bar) collapse into one write.
  if (state.currentSetUrl && state.playbackDuration > 0) {
    const pct = Math.min(99, Math.round((seconds / state.playbackDuration) * 100))
    if (pct >= 1) {
      // Update in-memory store immediately so the resume section is always current
      ;['history', 'favorites'].forEach(key => {
        state.store[key] = state.store[key].map(item =>
          item.url === state.currentSetUrl
            ? { ...item, progressTimePct: pct, progressTime: seconds }
            : item
        )
      })
      paintProgressBars(state.currentSetUrl, pct)
      clearTimeout(_seekPersistTimer)
      _seekPersistTimer = setTimeout(() => {
        _seekPersistTimer = null
        persist()
      }, 600)
    }
  }
}

function seekFromProgressEvent(e) {
  if (!state.playbackDuration) return
  const rect = playbackProgressTrack.getBoundingClientRect()
  if (!rect.width) return
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const seconds = pct * state.playbackDuration
  state.playbackCurrentTime = seconds
  updatePlaybackProgress(seconds, state.playbackDuration)
  playerSeek(seconds)
}

function seekRelativeSeconds(deltaSeconds) {
  const current = Math.max(0, Number(state.playbackCurrentTime) || 0)
  const duration = Math.max(0, Number(state.playbackDuration) || 0)
  const target = Math.max(0, duration
    ? Math.min(duration, current + deltaSeconds)
    : current + deltaSeconds)
  state.playbackCurrentTime = target
  updatePlaybackProgress(target, state.playbackDuration)
  playerSeek(target)
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
  playerSeek(target)
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
  if (target) playerSeek(target.cueSeconds)
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
  const sourceName = state.source === 'soundcloud' ? 'SoundCloud' : 'YouTube'
  navigateTo(sourceUrl(query), `Searching ${sourceName}…`)
}

function doSearch() {
  const q = searchInput.value.trim()
  console.log('[search] doSearch q=' + JSON.stringify(q))
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

  window.api.on('tracklist-loaded', ({ url, title, thumbnailUrl, isFallback, providerId, providerName, providerFooterLabel, tracklistUrl, lookupError, contributeLabel, contributeNote, contributeUrl, alternateProviders, sourcePublishedAt, sourceViewCount, metadataOutlook }) => {
    // Don't update set state or history while the user is deciding in the dialog.
    if (isResumeDialogOpen()) return
    document.body.classList.add('has-active-set')
    document.body.classList.remove('is-browsing')
    hasEverPlayed = true
    updateViewTabs()
    const isNewSet = url !== state.currentSetUrl
    if (isNewSet) {
      state.currentSetMetadata = null
      state.currentSourceStats = null
      state.currentSetAvailability = null
      state.automaticLookupDecisionPending = true
      state.currentTracklistOptions = []
      state.metadataEditMode = null
      state.metadataOverwriteOnSet79 = false
      state.eventSuggestionsDismissedNotice = false
    }
    state.tracklistUnavailable = !!isFallback
    state.currentSetTitle      = title
    state.currentSetUrl        = url
    state.currentSetMetadata   = state.currentSetMetadata || savedMetadataForUrl(url)
    if (isNewSet) state.metadataRemovedValues = savedIgnoredMetadataValuesForUrl(url)
    state.currentSourceStats   = {
      publishedAt: sourcePublishedAt || null,
      viewCount: sourceViewCount ?? null,
      metadataOutlook: metadataOutlook || null,
    }
    state.currentThumbnailUrl  = thumbnailUrl || null
    state.currentTracklistUrl  = tracklistUrl || null
    state.currentTracklistProvider = providerId || null
    state.currentTracklistProviderName   = providerName || null
    state.currentTracklistProviderFooter = providerFooterLabel || null
    // The header and empty tracklist are the stable shell for an active set.
    // Keep them visible while provider results are still arriving.
    mainContent.classList.add('has-tracklist')
    renderSetMetadataHeader()
    renderSetSources()
    renderTracklistProviderChoice()

    if (isFallback) {
      state.currentTracks  = []   // prevent stale count leaking into bookmark
      state.currentSource  = 'youtube'
      state.currentContributeUrl = contributeUrl || null
      npSet.textContent     = title
      tracklistUnavailableTitle.textContent = lookupError ? 'Tracklist lookup paused' : 'Tracklist not yet available'

      // An untried alternate provider is the better offer, so it takes the
      // panel's single action slot; contributing is what's left once every
      // alternate has been tried and come up empty too.
      const alt = (alternateProviders || [])[0] || null
      const showContribute = !alt && !lookupError && contributeUrl && contributeLabel
      state.currentAltProvider = alt

      const subLines = [escHtml(lookupError?.message || 'It will retry automatically next time.')]
      if (alt?.prompt) subLines.push(escHtml(alt.prompt))
      else if (showContribute) subLines.push(' … or maybe create one yourself?')
      tracklistUnavailableSub.innerHTML = subLines.join('<br /><br />')

      btnAltProvider.classList.toggle('hidden', !alt)
      if (alt) {
        btnAltProvider.textContent = alt.label
        btnAltProvider.disabled = false
      }
      btnContributeTracklist.classList.toggle('hidden', !showContribute)
      if (showContribute) btnContributeTracklist.textContent = contributeLabel

      const note = alt ? alt.note : (showContribute ? contributeNote : null)
      tlContributeNote.textContent = note || ''
      tlContributeNote.classList.toggle('hidden', !note)
      tlContributeActions.classList.toggle('hidden', !alt && !showContribute)
      // Show the below-video area with the unavailable message
      tracklistUnavailableEl.classList.remove('hidden')
      tracklistList.innerHTML = ''
      tracklistCompactList.innerHTML = ''
      mainContent.classList.add('has-tracklist')
      // Clear any stale track info from a previous set
      state.nowPlaying       = null
      setTrackPlaying(false)
      npTrackText.textContent = ''
      npArtist.textContent   = ''
      npArtistSeparator.classList.add('hidden')
      npTracknum.textContent = ''
      setNpArtwork()
      ppIcon.innerHTML      = icon(ICON.play, 16)
      btnPlayPause.classList.remove('playing')
    } else {
      state.currentSource  = 'youtube'
      npSet.textContent    = title
      tracklistUnavailableTitle.textContent = 'Tracklist not yet available'
      tracklistUnavailableSub.textContent = 'No tracklist was found for this DJ set. It may become available later — opening it again will retry automatically.'
      tracklistUnavailableEl.classList.add('hidden')
      tlContributeActions.classList.add('hidden')
      state.currentContributeUrl = null
      state.currentAltProvider = null
    }

    state.isIdTrack = false
    updateBookmarkBtn()
    refreshScrobbleBadge()
    const metadata = savedSetMetadata(state.currentSetMetadata)
    addToHistory({
      title,
      url,
      source: state.currentSource,
      thumbnailUrl: state.currentThumbnailUrl,
      tracklistUrl: state.currentTracklistUrl,
      tracklistProvider: state.currentTracklistProvider,
      ...metadata,
    })
    renderFavorites()
  })

  window.api.on('now-playing', (data) => {
    state.nowPlaying = data
    const playing = data.isPlaying !== false
    ppIcon.innerHTML = playing ? icon(ICON.pause, 17) : icon(ICON.play, 18)
    btnPlayPause.classList.toggle('playing', playing)
    setTrackPlaying(playing)
    state.isIdTrack      = !!data.isId
    // Player-only events carry play/pause state, not track metadata.
    if (data.source !== 'youtube-player' && data.source !== 'youtube-fallback') {
      npTrackText.textContent = data.isId ? 'ID' : (data.title || data.raw || '—')
      npArtist.textContent   = data.isId ? '—' : (data.artist || '—')
      npArtistSeparator.classList.toggle('hidden', !npArtist.textContent || npArtist.textContent === '—')
      npTracknum.textContent = data.trackNum ? `#${data.trackNum}` : ''
      setNpArtwork(data.isId ? null : data.artUrl, data.isId ? 'missing' : data.artworkStatus)
      if (data.trackNum) highlightTracklistByNum(data.trackNum)
    }
    // Save playback progress so history/favorites items can show a progress bar
    if (data.trackNum && state.currentSetUrl && data.source !== 'youtube-player' && data.source !== 'youtube-fallback') {
      updateSetProgress(state.currentSetUrl, data.trackNum, data.cueSeconds)
    }
    refreshScrobbleBadge()
  })

  window.api.on('stats-updated', (stats) => {
    state.stats = stats
    updateListenTimeSep()
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
      playerSeek(t)
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

  window.api.on('track-artwork', (payload) => {
    if (
      isResumeDialogOpen() ||
      payload?.sourceUrl !== state.currentSetUrl ||
      payload?.providerId !== state.currentTracklistProvider ||
      payload?.tracklistUrl !== state.currentTracklistUrl
    ) return

    const ids = new Set(payload.providerTrackIds || [])
    if (!ids.size) return
    state.currentTracks = state.currentTracks.map(track => ids.has(track.providerTrackId)
      ? { ...track, artUrl: payload.artUrl || '', artworkStatus: payload.artworkStatus }
      : track
    )
    if (ids.has(state.nowPlaying?.providerTrackId)) {
      state.nowPlaying = {
        ...state.nowPlaying,
        artUrl: payload.artUrl || '',
        artworkStatus: payload.artworkStatus,
      }
      setNpArtwork(payload.artUrl, payload.artworkStatus)
    }

    for (const list of [tracklistList, tracklistCompactList]) {
      list.querySelectorAll('.track-item').forEach(item => {
        if (!ids.has(item.dataset.providerTrackId)) return
        const existing = item.querySelector('.track-art')
        if (!existing) return
        if (payload.artUrl) {
          const img = document.createElement('img')
          img.className = 'track-art'
          img.src = payload.artUrl
          img.loading = 'lazy'
          img.alt = ''
          img.addEventListener('error', () => {
            const empty = document.createElement('div')
            empty.className = 'track-art track-art-empty'
            img.replaceWith(empty)
          }, { once: true })
          existing.replaceWith(img)
        } else {
          existing.classList.remove('track-art-loading')
        }
      })
    }
    renderPlaybackSegments(true)
  })

  window.api.on('tracklist-options', (payload) => {
    if (isResumeDialogOpen() || payload?.sourceUrl !== state.currentSetUrl) return
    state.currentTracklistOptions = Array.isArray(payload.options) ? payload.options : []
    renderTracklistProviderChoice()
  })

  window.api.on('set-metadata', (metadata) => {
    if (isResumeDialogOpen() || metadata?.sourceUrl !== state.currentSetUrl) return
    const replaceFromSet79 = state.metadataOverwriteOnSet79 && metadata.providerId === 'set79'
    state.currentSetMetadata = replaceFromSet79
      ? mergeSetMetadata(null, metadata)
      : mergeSetMetadata(state.currentSetMetadata, metadata)
    ;(state.metadataRemovedValues || []).forEach(removed => {
      if (removed.field === 'djNames') {
        state.currentSetMetadata.djNames = normalizedDjNames(state.currentSetMetadata.djNames)
          .filter(name => librarySearchKey(name) !== librarySearchKey(removed.value))
      } else if (removed.field === 'event' || removed.field === 'venue' || removed.field === 'date') {
        state.currentSetMetadata[removed.field] = null
      }
    })
    tagSavedSetMetadata(metadata.sourceUrl, state.currentSetMetadata, {
      overwrite: replaceFromSet79,
      replace: replaceFromSet79,
    })
    if (replaceFromSet79) state.metadataEditMode = null
    renderSetMetadataHeader()
    lookupNextDjEvents()
  })

  window.api.on('source-metadata', (metadata) => {
    if (isResumeDialogOpen() || metadata?.sourceUrl !== state.currentSetUrl) return
    state.currentSourceStats = {
      publishedAt: metadata.sourcePublishedAt || null,
      viewCount: metadata.sourceViewCount ?? null,
      metadataOutlook: metadata.metadataOutlook || null,
    }
    renderSetMetadataHeader()
  })

  window.api.on('event-lookup-progress', (progress) => {
    if (!eventSuggestionsEnabled()) return
    if (progress?.sourceUrl !== state.currentSetUrl || progress?.requestId !== state.currentEventLookupRequest) return
    if (state.currentEventLookup?.status !== 'checking') return
    state.currentEventLookup.progress = progress
    renderNextDjEvents()
  })

  window.api.on('set-availability', (availability) => {
    if (isResumeDialogOpen() || availability?.sourceUrl !== state.currentSetUrl) return
    state.currentSetAvailability = {
      sourceUrl: availability.sourceUrl,
      services: {
        ...(state.currentSetAvailability?.services || {}),
        ...(availability.services || {}),
      },
    }
    state.automaticLookupDecisionPending = false
    renderSetMetadataHeader()
    renderSetSources()
    lookupNextDjEvents()
  })

  window.api.on('menu-open-about', () => openAboutDialog())
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
  scrobbleBadge.dataset.tooltip = cfg.label
  scrobbleBadge.title = cfg.label
  scrobbleBadge.setAttribute('aria-label', cfg.label)
  scrobbleLabel.textContent = cfg.label
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function applySidebarPanel(name) {
  navBtns.forEach((b) => b.classList.toggle('active', b.dataset.panel === name))
  panels.forEach((p) => p.classList.toggle('active', p.id === `panel-${name}`))
  requestAnimationFrame(updateMiniPlayerMetrics)
}

function switchSidebarPanel(name) {
  applySidebarPanel(name)
  if (!state.store.settings) state.store.settings = {}
  state.store.settings.activeSidebarPanel = name
  persist()
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
  if (!contributeDialog.classList.contains('hidden')) return true
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

let activeLibraryDjKey = null
let activeLibraryEventVenueKey = null
let libraryViewMode = 'grid'
let eventVenueLibraryViewMode = 'grid'
let eventVenueLibraryType = 'event'
const djLibraryCoverChoices = new Map()
const eventVenueLibraryCoverChoices = new Map()

function normalizedDjNames(djNames) {
  if (!Array.isArray(djNames)) return []
  const seen = new Set()
  return djNames
    .map(name => typeof name === 'string' ? name.trim() : '')
    .filter(name => {
      const key = name.toLocaleLowerCase()
      if (!name || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function normalizedMetadataText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function savedSetMetadata(metadata) {
  const djNames = normalizedDjNames(metadata?.djNames)
  const venue = normalizedMetadataText(metadata?.venue)
  const event = normalizedMetadataText(metadata?.event)
  const date = normalizedMetadataText(metadata?.date)
  return {
    ...(djNames.length ? { djNames } : {}),
    ...(venue ? { venue } : {}),
    ...(event ? { event } : {}),
    ...(date ? { date } : {}),
  }
}

function normalizedIgnoredMetadataValues(values) {
  if (!Array.isArray(values)) return []
  const seen = new Set()
  return values.flatMap(entry => {
    const field = entry?.field
    const value = normalizedMetadataText(entry?.value)
    if (!['djNames', 'venue', 'event', 'date'].includes(field) || !value) return []
    const key = `${field}:${librarySearchKey(value)}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ field, label: field === 'djNames' ? 'DJ' : field, value }]
  }).slice(0, 32)
}

function savedItemForUrl(url) {
  return state.store.history.find(item => item.url === url) || state.store.favorites.find(item => item.url === url)
}

function savedMetadataForUrl(url) {
  const saved = savedItemForUrl(url)
  const metadata = savedSetMetadata(saved)
  return Object.keys(metadata).length ? { sourceUrl: url, providerId: null, ...metadata } : null
}

function savedIgnoredMetadataValuesForUrl(url) {
  return normalizedIgnoredMetadataValues(savedItemForUrl(url)?.metadataIgnoredValues)
}

function tagSavedSetMetadata(url, metadata, { overwrite = false, replace = false } = {}) {
  const metadataPatch = savedSetMetadata(metadata)
  const ignoredValues = normalizedIgnoredMetadataValues(state.metadataRemovedValues)
    .map(({ field, value }) => ({ field, value }))
  if (!url) return
  let changed = false
  ;['history', 'favorites'].forEach(key => {
    state.store[key] = state.store[key].map(item => {
      if (item.url !== url) return item
      const next = { ...item }
      if (replace) {
        for (const field of ['djNames', 'venue', 'event', 'date']) delete next[field]
      }
      for (const [field, value] of Object.entries(metadataPatch)) {
        if (field === 'djNames' && !overwrite) {
          next.djNames = normalizedDjNames([...normalizedDjNames(next.djNames), ...value])
          continue
        }
        const missing = !normalizedMetadataText(next[field])
        if (overwrite || missing) next[field] = value
      }
      if (ignoredValues.length) next.metadataIgnoredValues = ignoredValues
      else delete next.metadataIgnoredValues
      if (JSON.stringify(next) === JSON.stringify(item)) return item
      changed = true
      return next
    })
  })
  if (!changed) return
  persist()
  renderFavorites()
  renderHistory()
}

function favoriteDjLibrary() {
  const djs = new Map()
  state.store.favorites.forEach(set => {
    const setDjNames = normalizedDjNames(set.djNames)
    setDjNames.forEach(name => {
      const key = name.toLocaleLowerCase()
      if (!djs.has(key)) djs.set(key, { key, name, sets: [], soloSets: [] })
      const dj = djs.get(key)
      if (!dj.sets.some(item => item.url === set.url)) dj.sets.push(set)
      if (setDjNames.length === 1 && !dj.soloSets.some(item => item.url === set.url)) dj.soloSets.push(set)
    })
  })
  return [...djs.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

function favoriteEventVenueLibrary(kind = eventVenueLibraryType) {
  const groups = new Map()
  state.store.favorites.forEach(set => {
    const field = kind === 'venue' ? 'venue' : 'event'
    const names = [normalizedMetadataText(set[field])].filter(Boolean)
    names.forEach(name => {
      const key = librarySearchKey(name)
      if (!groups.has(key)) groups.set(key, { key, kind: field, name, sets: [] })
      const group = groups.get(key)
      if (!group.sets.some(item => item.url === set.url)) group.sets.push(set)
    })
  })
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

function randomDjCover(dj) {
  const preferredSets = dj.soloSets.some(set => set.thumbnailUrl) ? dj.soloSets : dj.sets
  const candidates = [...new Set(preferredSets.map(set => set.thumbnailUrl).filter(Boolean))]
  if (!candidates.length) return null

  const existing = djLibraryCoverChoices.get(dj.key)
  if (candidates.includes(existing)) return existing
  const selected = candidates[Math.floor(Math.random() * candidates.length)]
  djLibraryCoverChoices.set(dj.key, selected)
  return selected
}

function randomEventVenueCover(group) {
  const candidates = [...new Set(group.sets.map(set => set.thumbnailUrl).filter(Boolean))]
  if (!candidates.length) return null

  const existing = eventVenueLibraryCoverChoices.get(group.key)
  if (candidates.includes(existing)) return existing
  const selected = candidates[Math.floor(Math.random() * candidates.length)]
  eventVenueLibraryCoverChoices.set(group.key, selected)
  return selected
}

function librarySearchKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .trim()
}

function libraryInitial(name) {
  const initial = librarySearchKey(name).charAt(0).toLocaleUpperCase()
  return /[A-Z]/.test(initial) ? initial : '#'
}

function setLibraryViewMode(mode, persistSetting = true) {
  libraryViewMode = mode === 'list' ? 'list' : 'grid'
  libraryViewOptions.forEach(option => {
    const active = option.dataset.libraryView === libraryViewMode
    option.classList.toggle('active', active)
    option.setAttribute('aria-pressed', String(active))
  })
  if (persistSetting) {
    if (!state.store.settings) state.store.settings = {}
    state.store.settings.libraryViewMode = libraryViewMode
    persist()
  }
  renderDjLibrary()
}

function setEventVenueLibraryViewMode(mode, persistSetting = true) {
  eventVenueLibraryViewMode = mode === 'list' ? 'list' : 'grid'
  eventVenueLibraryViewOptions.forEach(option => {
    const active = option.dataset.eventVenueView === eventVenueLibraryViewMode
    option.classList.toggle('active', active)
    option.setAttribute('aria-pressed', String(active))
  })
  if (persistSetting) {
    if (!state.store.settings) state.store.settings = {}
    state.store.settings.eventVenueLibraryViewMode = eventVenueLibraryViewMode
    persist()
  }
  renderEventVenueLibrary()
}

function setEventVenueLibraryType(type, persistSetting = true) {
  eventVenueLibraryType = type === 'venue' ? 'venue' : 'event'
  eventVenueLibraryTypeOptions.forEach(option => {
    const active = option.dataset.eventVenueType === eventVenueLibraryType
    option.classList.toggle('active', active)
    option.setAttribute('aria-pressed', String(active))
  })
  if (persistSetting) {
    if (!state.store.settings) state.store.settings = {}
    state.store.settings.eventVenueLibraryType = eventVenueLibraryType
    persist()
  }
  eventVenueLibrarySearchInput.placeholder = `filter ${eventVenueLibraryType}s…`
  eventVenueLibrarySearchInput.setAttribute('aria-label', `Filter saved ${eventVenueLibraryType}s`)
  activeLibraryEventVenueKey = null
  renderEventVenueLibrary()
}

function openStoredSet(item) {
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
}

function renderLibrarySetCard(item) {
  const pct = getProgressPct(item)
  const isCurrentSet = !!state.currentSetUrl && item.url === state.currentSetUrl
  const card = document.createElement('button')
  card.type = 'button'
  card.className = 'library-set-card'
  card.classList.toggle('is-current-set', isCurrentSet)
  card.title = isCurrentSet ? 'Return to Now Playing' : (item.title || item.url)
  card.innerHTML = `
    <div class="library-set-thumb-frame">
      ${item.thumbnailUrl
        ? `<img class="library-set-thumb" src="${escHtml(item.thumbnailUrl)}" alt="" loading="lazy" />`
        : '<div class="library-set-thumb library-set-thumb-empty"></div>'}
      ${spectrumBarsHtml('library-set-playing-indicator')}
    </div>
    <div class="library-set-title-row">
      <span class="library-set-heart" aria-hidden="true"><svg viewBox="0 0 24 24" width="9" height="9" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg></span>
      <div class="library-set-title-wrap">
        <span class="library-set-title-text">${escHtml(item.title || item.url)}</span>
      </div>
    </div>
    <div class="library-set-progress"><div class="library-set-progress-fill" style="width:${pct}%"></div></div>
  `
  card.addEventListener('click', () => {
    if (item.url === state.currentSetUrl) {
      showNowPlayingTrack()
      return
    }
    openStoredSet(item)
  })
  wireOverflowMarquee(card.querySelector('.library-set-title-text'), card)
  return card
}

function showLibraryEntityDetail(entity, scope) {
  activeLibraryDjKey = scope === 'dj' ? entity.key : null
  activeLibraryEventVenueKey = scope !== 'dj' ? entity.key : null
  libraryScreen.classList.add('is-detail')
  libraryOverview.classList.add('hidden')
  libraryDjDetail.classList.remove('hidden')
  libraryBackLabel.textContent = scope === 'dj' ? 'All DJs' : `All ${scope}s`
  libraryDjName.textContent = entity.name
  libraryDjCount.textContent = `${entity.sets.length} saved set${entity.sets.length === 1 ? '' : 's'}`
  libraryDjSets.innerHTML = ''
  entity.sets.forEach(set => libraryDjSets.appendChild(renderLibrarySetCard(set)))
  libraryScreen.scrollTop = 0
}

function showDjLibraryDetail(dj) {
  showLibraryEntityDetail(dj, 'dj')
}

function showEventVenueLibraryDetail(group) {
  showLibraryEntityDetail(group, group.kind)
}

function showDjLibraryOverview() {
  activeLibraryDjKey = null
  activeLibraryEventVenueKey = null
  libraryScreen.classList.remove('is-detail')
  libraryDjDetail.classList.add('hidden')
  libraryOverview.classList.remove('hidden')
  libraryScreen.scrollTop = 0
}

function renderDjLibrary() {
  const allDjs = favoriteDjLibrary()
  const query = librarySearchKey(librarySearchInput.value)
  const djs = query
    ? allDjs.filter(dj => librarySearchKey(dj.name).includes(query))
    : allDjs
  djLibraryGrid.className = `dj-library-grid is-${libraryViewMode}`
  djLibraryGrid.innerHTML = ''
  libraryEmpty.style.display = djs.length ? 'none' : ''
  libraryEmpty.textContent = query
    ? 'No saved DJs match that search.'
    : 'DJs from your saved sets will appear here.'

  let previousInitial = null
  djs.forEach(dj => {
    if (libraryViewMode === 'list') {
      const initial = libraryInitial(dj.name)
      if (initial !== previousInitial) {
        previousInitial = initial
        const heading = document.createElement('li')
        heading.className = 'dj-library-letter'
        heading.textContent = initial
        djLibraryGrid.appendChild(heading)
      }
    }
    const item = document.createElement('li')
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'dj-library-card'
    card.title = `View saved sets by ${dj.name}`
    const thumbnail = randomDjCover(dj)
    const coverKind = dj.soloSets.some(set => set.thumbnailUrl) ? 'solo set' : 'collaboration set'
    card.setAttribute('aria-label', `${dj.name}, ${dj.sets.length} saved set${dj.sets.length === 1 ? '' : 's'}, ${coverKind} artwork`)
    card.innerHTML = `
      <div class="dj-library-thumb-frame">
        ${thumbnail
          ? `<img class="dj-library-thumb" src="${escHtml(thumbnail)}" alt="" loading="lazy" />`
          : '<div class="dj-library-thumb dj-library-thumb-empty"></div>'}
      </div>
      <div class="dj-library-meta">
        <div class="dj-library-name">${escHtml(dj.name)}</div>
        <div class="dj-library-count">${dj.sets.length} saved set${dj.sets.length === 1 ? '' : 's'}</div>
      </div>
    `
    card.addEventListener('click', () => showDjLibraryDetail(dj))
    item.appendChild(card)
    djLibraryGrid.appendChild(item)
  })

  if (activeLibraryDjKey) {
    const activeDj = allDjs.find(dj => dj.key === activeLibraryDjKey)
    if (activeDj) showDjLibraryDetail(activeDj)
    else showDjLibraryOverview()
  }
}

function renderEventVenueLibrary() {
  const allGroups = favoriteEventVenueLibrary(eventVenueLibraryType)
  const query = librarySearchKey(eventVenueLibrarySearchInput.value)
  const groups = query
    ? allGroups.filter(group => librarySearchKey(group.name).includes(query))
    : allGroups
  eventVenueLibraryGrid.className = `dj-library-grid is-${eventVenueLibraryViewMode}`
  eventVenueLibraryGrid.innerHTML = ''
  eventVenueLibraryEmpty.style.display = groups.length ? 'none' : ''
  eventVenueLibraryEmpty.textContent = query
    ? `No saved ${eventVenueLibraryType}s match that search.`
    : `${eventVenueLibraryType === 'event' ? 'Events' : 'Venues'} from your saved sets will appear here.`

  let previousInitial = null
  groups.forEach(group => {
    if (eventVenueLibraryViewMode === 'list') {
      const initial = libraryInitial(group.name)
      if (initial !== previousInitial) {
        previousInitial = initial
        const heading = document.createElement('li')
        heading.className = 'dj-library-letter'
        heading.textContent = initial
        eventVenueLibraryGrid.appendChild(heading)
      }
    }
    const item = document.createElement('li')
    const card = document.createElement('button')
    card.type = 'button'
    card.className = 'dj-library-card'
    card.title = `View saved sets from ${group.name}`
    const thumbnail = randomEventVenueCover(group)
    card.setAttribute('aria-label', `${group.name}, ${group.sets.length} saved set${group.sets.length === 1 ? '' : 's'}`)
    card.innerHTML = `
      <div class="dj-library-thumb-frame">
        ${thumbnail
          ? `<img class="dj-library-thumb" src="${escHtml(thumbnail)}" alt="" loading="lazy" />`
          : '<div class="dj-library-thumb dj-library-thumb-empty"></div>'}
      </div>
      <div class="dj-library-meta">
        <div class="dj-library-name">${escHtml(group.name)}</div>
        <div class="dj-library-count">${group.sets.length} saved set${group.sets.length === 1 ? '' : 's'}</div>
      </div>
    `
    card.addEventListener('click', () => showEventVenueLibraryDetail(group))
    item.appendChild(card)
    eventVenueLibraryGrid.appendChild(item)
  })

  if (activeLibraryEventVenueKey) {
    const activeGroup = allGroups.find(group => group.key === activeLibraryEventVenueKey)
    if (activeGroup) showEventVenueLibraryDetail(activeGroup)
    else showDjLibraryOverview()
  }
}

function openLibraryEntityFromSidebar(entity, scope) {
  document.body.classList.remove('is-browsing')
  showLibrary()
  if (scope === 'dj') showDjLibraryDetail(entity)
  else {
    setEventVenueLibraryType(scope)
    showEventVenueLibraryDetail(entity)
  }
  updateViewTabs()
}

function makeLibraryQuickAccessItem(entity, scope) {
  const li = document.createElement('li')
  li.className = 'library-quick-item'
  const thumbnail = scope === 'dj' ? randomDjCover(entity) : randomEventVenueCover(entity)
  li.innerHTML = `
    ${thumbnail
      ? `<img class="library-quick-thumb" src="${escHtml(thumbnail)}" alt="" loading="lazy" />`
      : '<div class="library-quick-thumb library-quick-thumb-empty"></div>'}
    <div class="set-item-meta">
      <div class="set-item-title">${escHtml(entity.name)}</div>
      <div class="set-item-src">${entity.sets.length} saved set${entity.sets.length === 1 ? '' : 's'}</div>
    </div>
  `
  li.tabIndex = 0
  li.setAttribute('role', 'button')
  li.setAttribute('aria-label', `Open ${entity.name} in Library`)
  const open = () => openLibraryEntityFromSidebar(entity, scope)
  li.addEventListener('click', open)
  li.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    open()
  })
  wireSetItemMarquee(li)
  return li
}

function renderSidebarLibraryGroups(groups, { list, empty, panelTitle, title, scope }) {
  list.innerHTML = ''
  empty.style.display = groups.length ? 'none' : ''
  panelTitle.textContent = title
  let previousInitial = null
  groups.forEach((group, index) => {
    const initial = libraryInitial(group.name)
    if (initial !== previousInitial) {
      previousInitial = initial
      if (index === 0) {
        panelTitle.innerHTML = `${escHtml(title)}<span class="history-title-label">${escHtml(initial)}</span>`
      } else {
        const separator = document.createElement('li')
        separator.className = 'history-group-sep'
        separator.textContent = initial
        list.appendChild(separator)
      }
    }
    list.appendChild(makeLibraryQuickAccessItem(group, scope))
  })
}

function renderSidebarLibraryQuickAccess() {
  renderSidebarLibraryGroups(favoriteDjLibrary(), {
    list: sidebarDjList,
    empty: sidebarDjEmpty,
    panelTitle: djPanelTitle,
    title: 'DJs',
    scope: 'dj',
  })
  renderSidebarLibraryGroups(favoriteEventVenueLibrary('event'), {
    list: sidebarEventList,
    empty: sidebarEventEmpty,
    panelTitle: eventPanelTitle,
    title: 'Events',
    scope: 'event',
  })
  renderSidebarLibraryGroups(favoriteEventVenueLibrary('venue'), {
    list: sidebarVenueList,
    empty: sidebarVenueEmpty,
    panelTitle: venuePanelTitle,
    title: 'Venues',
    scope: 'venue',
  })
}

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
  if (histEntry.djNames?.length) patch.djNames = histEntry.djNames
  if (histEntry.venue) patch.venue = histEntry.venue
  if (histEntry.event) patch.event = histEntry.event
  if (histEntry.date) patch.date = histEntry.date
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

function removeFromHistory(url) {
  state.store.history = state.store.history.filter((h) => h.url !== url)
  persist()
  renderHistory()
}

function renderFavorites() {
  const favs = state.store.favorites
  favoritesList.innerHTML = ''
  favEmpty.style.display = favs.length ? 'none' : ''
  favs.forEach((item) => favoritesList.appendChild(makeSetListItem(item, () => removeFromFavorites(item.url))))
  renderDjLibrary()
  renderEventVenueLibrary()
  renderSidebarLibraryQuickAccess()
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
    djNames: existing.djNames,
    venue: existing.venue,
    event: existing.event,
    date: existing.date,
    metadataIgnoredValues: existing.metadataIgnoredValues,
  } : {}
  state.store.history = state.store.history.filter(h => h.url !== item.url)
  state.store.history.unshift({ ...preserved, ...item, playedAt: Date.now() })
  if (state.store.history.length > 100) state.store.history.pop()
  persist()
  renderHistory()
}

function historyGroupLabel(playedAt) {
  if (!playedAt) return 'earlier'
  const now     = new Date()
  const nowDay  = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const thenDay = new Date(new Date(playedAt).getFullYear(), new Date(playedAt).getMonth(), new Date(playedAt).getDate())
  const days    = Math.round((nowDay - thenDay) / 86_400_000)

  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30)  return `${days} days ago`

  const then   = new Date(playedAt)
  const months = (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth())

  if (months <= 1)  return 'last month'
  if (months < 12)  return `${months} months ago`

  const years = now.getFullYear() - then.getFullYear()
  if (years <= 1) return 'last year'
  return `${years} years ago`
}

function renderHistory() {
  const hist = state.store.history
  historyList.innerHTML = ''
  histEmpty.style.display = hist.length ? 'none' : ''

  let lastLabel = null
  let firstGroup = true
  hist.forEach((item) => {
    const label = historyGroupLabel(item.playedAt)
    if (label !== lastLabel) {
      lastLabel = label
      if (firstGroup) {
        // Embed the first label inline with the "History" panel title
        historyPanelTitle.innerHTML =
          `History<span class="history-title-label">${escHtml(label)}</span>`
        firstGroup = false
      } else {
        const sep = document.createElement('li')
        sep.className = 'history-group-sep'
        sep.textContent = label
        historyList.appendChild(sep)
      }
    }
    historyList.appendChild(makeSetListItem(item, () => removeFromHistory(item.url)))
  })

  // Reset title when history is empty
  if (hist.length === 0) historyPanelTitle.textContent = 'History'

  renderIntroResume()
}

function wireOverflowMarquee(target, hoverTarget = target, clipTarget = target) {
  if (!target || target.dataset.marqueeWired === 'true') return
  target.dataset.marqueeWired = 'true'

  const start = () => {
    target._overflowMarqueeAnimation?.cancel()
    target.style.transition = 'none'
    target.style.transform = ''
    target.classList.remove('overflow-marquee')

    requestAnimationFrame(() => {
      const overflow = target.scrollWidth - clipTarget.clientWidth
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
  wireOverflowMarquee(npTitleContent, npTitleRow, npTitleRow)
  ;[npSet, scrobbleLabel].forEach(el => wireOverflowMarquee(el))
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
  hasEverPlayed = true
  state.pendingResumeTime = resume
    ? (item.progressTime ?? item.lastTrackCueSeconds ?? null)
    : null
  if (isYouTubeSourceUrl(item.url)) {
    document.body.classList.add('has-active-set')
    setNpArtwork()
    hideIntro()
    showLoading('Searching tracklist…')
    state.tracklistUnavailable = false
    state.currentTracks = []
    state.currentSetTitle = item.title || item.url
    state.currentSetUrl = item.url
    state.currentThumbnailUrl = item.thumbnailUrl || null
    state.currentTracklistUrl = null
    state.currentTracklistProvider = null
    state.currentTracklistProviderName = null
    state.currentTracklistProviderFooter = null
    state.currentTracklistOptions = []
    state.eventSuggestionsDismissedNotice = false
    state.currentSetMetadata = savedMetadataForUrl(item.url)
    state.metadataRemovedValues = savedIgnoredMetadataValuesForUrl(item.url)
    state.currentSourceStats = null
    state.currentSetAvailability = {
      sourceUrl: item.url,
      services: {
        youtube: { status: 'available', url: item.url },
        soundcloud: { status: 'checking', url: null },
        '1001tracklists': { status: 'checking', url: null },
        set79: { status: 'checking', url: null },
      },
    }
    state.automaticLookupDecisionPending = true
    mainContent.classList.add('has-tracklist')
    renderSetMetadataHeader()
    renderSetSources()
    renderTracklistProviderChoice()
    window.api.loadSourceUrl(item.url)
    updateViewTabs()
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
  li.classList.toggle('is-current-set', !!state.currentSetUrl && item.url === state.currentSetUrl)
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
      <div class="set-item-src">
        <span>${item.trackCount != null ? `${item.trackCount} tracks` : 'tracklist unavailable'}</span>
        ${spectrumBarsHtml('set-playing-indicator')}
      </div>
    </div>
    ${onRemove ? '<button class="set-item-remove" title="Remove">✕</button>' : ''}
    ${progressHtml}
  `
  li.addEventListener('click', (e) => {
    if (e.target.classList.contains('set-item-remove')) return
    if (item.url === state.currentSetUrl) {
      showNowPlayingTrack()
      return
    }
    openStoredSet(item)
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
  li.dataset.providerTrackId = track.providerTrackId || ''

  const numHtml = track.isWWith
    ? `<span class="track-num track-num-with">w/</span>`
    : `<span class="track-num">${track.trackNum || ''}</span>`

  const artHtml = compact ? '' : (
    track.artUrl
      ? `<img class="track-art" src="${escHtml(track.artUrl)}" loading="lazy" alt="" />`
      : `<div class="track-art track-art-empty${track.artworkStatus === 'loading' ? ' track-art-loading' : ''}"></div>`
  )

  const titleText  = track.isId ? 'ID — ID' : escHtml(track.title || track.raw || '?')
  const artistHtml = (!track.isId && track.artist && !compact)
    ? `<span class="track-artist">${escHtml(track.artist)}</span>`
    : ''

  // Determine identify type — drives both button label and dialog content
  const needsIdentify = track.isId || track.title === 'ID' || track.artist === 'ID'
  let idDialogType = 'id'
  if (!track.isId && track.title === 'ID') idDialogType = 'id-title'
  else if (!track.isId && track.artist === 'ID') idDialogType = 'id-artist'
  const idBtnLabel = CONTRIBUTE_CONFIGS[idDialogType].btnLabel

  // When needsIdentify: wrap title + artist in a column so the button can
  // center vertically against the full text block, not just the title line.
  const trackInfoHtml = needsIdentify
    ? `<div class="track-info">
         <div class="track-title-row">
           <div class="track-text-col">
             <span class="track-title">${titleText}</span>
             ${artistHtml}
           </div>
           <button class="inline-track-btn track-id-btn">${idBtnLabel}</button>
         </div>
       </div>`
    : `<div class="track-info">
         <span class="track-title">${titleText}</span>
         ${artistHtml}
       </div>`

  // cue column: timestamp if available, inline button if no timestamp
  const cueHtml = track.cueDisplay
    ? `<span class="track-cue">${escHtml(track.cueDisplay)}</span>`
    : (track.noTimestamp
        ? `<button class="inline-track-btn track-no-ts-btn">no timestamp</button>`
        : '')

  li.innerHTML = `
    ${numHtml}
    ${artHtml}
    ${trackInfoHtml}
    ${spectrumBarsHtml('track-playing-indicator')}
    ${cueHtml}
  `

  // Wire inline contribute buttons — stop propagation so they don't trigger seek
  li.querySelector('.track-no-ts-btn')?.addEventListener('click', (e) => {
    e.stopPropagation()
    openContributeDialog('no-timestamp')
  })
  li.querySelector('.track-id-btn')?.addEventListener('click', (e) => {
    e.stopPropagation()
    openContributeDialog(idDialogType)
  })

  // A track is only seekable when it has a user-visible timestamp (cueDisplay).
  // cueSeconds alone is not enough — mashup components and w/ items can have
  // cueSeconds:0 as a placeholder with no real displayed timestamp.
  if (track.cueDisplay && typeof track.cueSeconds === 'number' && !track.noTimestamp) {
    // Has a real displayed timestamp — row click seeks
    li.addEventListener('click', (e) => {
      if (e.target.closest('.inline-track-btn')) return
      playerSeek(track.cueSeconds)
    })
  } else {
    // No visible timestamp — row click opens the no-timestamp dialog.
    // ID-button and no-ts-button clicks are already handled with stopPropagation.
    li.addEventListener('click', (e) => {
      if (e.target.closest('.inline-track-btn')) return
      openContributeDialog('no-timestamp')
    })
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

  // Tracklist footer — "found an error? edit on <provider>"
  const footerUrl = state.currentTracklistUrl
  const footerLabel = state.currentTracklistProviderFooter || 'edit on 1001Tracklists ↗'
  for (const footer of [tlListFooter, tlCompactFooter]) {
    if (footerUrl && tracks.length > 0) {
      footer.innerHTML = `found an error in this tracklist? <a class="tl-footer-link">${escHtml(footerLabel)}</a>`
      footer.querySelector('.tl-footer-link').addEventListener('click', () => {
        window.api.openExternal(footerUrl)
      })
      footer.classList.remove('hidden')
    } else {
      footer.classList.add('hidden')
    }
  }

  mainContent.classList.toggle('has-tracklist', tracks.length > 0)
  renderSetMetadataHeader()
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
  tlListFooter.classList.add('hidden')
  tlCompactFooter.classList.add('hidden')
  tracklistProviderChoice.classList.add('hidden')
  mainContent.classList.remove('has-tracklist')
  tracklistUnavailableEl.classList.add('hidden')
  setMetadataHeader.classList.add('hidden')
  // Reset scroll position so every new set starts from the top, then
  // highlightTracklistByNum will scroll to the resumed track once it fires.
  tracklistScrollRegion.scrollTop = 0
  const compactScroll = rightPanel.querySelector('.panel-items')
  if (compactScroll) compactScroll.scrollTop = 0
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
  state.currentTracklistProviderName = null
  state.currentTracklistProviderFooter = null
  state.currentAltProvider  = null
  state.currentThumbnailUrl = null
  state.currentTracks       = []
  state.currentSetMetadata  = null
  state.currentSourceStats  = null
  state.currentSetAvailability = null
  state.automaticLookupDecisionPending = false
  state.metadataEditMode = null
  state.metadataOverwriteOnSet79 = false
  state.metadataRemovedValues = []
  state.currentEventLookup = null
  state.currentEventLookupKey = ''
  state.currentEventLookupRequest++
  state.eventSuggestionsDismissedNotice = false
  state.playbackCurrentTime = 0
  state.playbackDuration    = 0
  updatePlaybackProgress(0, 0)
  document.body.classList.remove('is-browsing')
  setTrackPlaying(false)
  npTrackText.textContent = ''
  npArtist.textContent   = ''
  npArtistSeparator.classList.add('hidden')
  npTracknum.textContent = ''
  setNpArtwork()
  npSet.textContent      = ''
  renderSetSources()
  renderNextDjEvents()
  ppIcon.innerHTML       = icon(ICON.play, 16)
  btnPlayPause.classList.remove('playing')
  updateBookmarkBtn()
}

// ── Overlays ──────────────────────────────────────────────────────────────────

let pendingPlayUrl = null

function clearLoadingWatchdog() {
  clearTimeout(loadingWatchdogTimer)
  loadingWatchdogTimer = null
  loadingHung.classList.add('hidden')
}

function showLoading(msg = 'Loading…') {
  hidePlayerStatus()
  loadingMsg.textContent = msg
  loadingOverlay.classList.remove('hidden')
  noTracklistMsg.classList.add('hidden')
  noTracklistPrompt.classList.add('hidden')
  // A new search is starting — clear the unavailable state + stale tracklist
  const preserveSetShell = mainContent.classList.contains('has-tracklist') && !!state.currentSetUrl
  state.tracklistUnavailable = false
  state.currentTracks = []
  clearTracklist()
  if (preserveSetShell) {
    mainContent.classList.add('has-tracklist')
    renderSetMetadataHeader()
  }
  refreshScrobbleBadge()

  // Start watchdog: if we're still spinning after 30 s, prompt the user
  clearLoadingWatchdog()
  loadingWatchdogTimer = setTimeout(() => {
    loadingWatchdogTimer = null
    if (loadingOverlay.classList.contains('hidden')) return
    console.warn('[watchdog] loading spinner stuck after', LOADING_WATCHDOG_MS / 1000, 's — showing hung UI')
    loadingHungMsg.textContent = `Still searching after ${LOADING_WATCHDOG_MS / 1000} seconds — something may have stalled.`
    loadingHung.classList.remove('hidden')
  }, LOADING_WATCHDOG_MS)
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
  clearLoadingWatchdog()
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
  npInfo.addEventListener('click', showNowPlayingTrack)
  npInfo.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    showNowPlayingTrack()
  })
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
    btn.addEventListener('click', () => {
      if (btn.classList.contains('active')) {
        // Second click on the active panel — collapse it
        navBtns.forEach(b => b.classList.remove('active'))
        panels.forEach(p => p.classList.remove('active'))
        requestAnimationFrame(updateMiniPlayerMetrics)
        if (!state.store.settings) state.store.settings = {}
        state.store.settings.activeSidebarPanel = null
        persist()
      } else {
        switchSidebarPanel(btn.dataset.panel)
      }
    })
  )

  document.querySelectorAll('.panel-collapse-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      navBtns.forEach(b => b.classList.remove('active'))
      panels.forEach(p => p.classList.remove('active'))
      requestAnimationFrame(updateMiniPlayerMetrics)
      if (!state.store.settings) state.store.settings = {}
      state.store.settings.activeSidebarPanel = null
      persist()
    })
  )

  btnBookmark.addEventListener('click', () => {
    if (!state.currentSetUrl) return
    if (isFavorited(state.currentSetUrl)) {
      removeFromFavorites(state.currentSetUrl)
    } else {
      // Include whatever we already know at bookmark time — trackCount from the
      // current tracklist, plus progress if a track has played this session.
      const histEntry = state.store.history.find(h => h.url === state.currentSetUrl)
      const metadata = savedSetMetadata({
        djNames: state.currentSetMetadata?.djNames?.length ? state.currentSetMetadata.djNames : histEntry?.djNames,
        venue: state.currentSetMetadata?.venue || histEntry?.venue,
        event: state.currentSetMetadata?.event || histEntry?.event,
        date: state.currentSetMetadata?.date || histEntry?.date,
      })
      addToFavorites({
        title:            state.currentSetTitle || state.currentSetUrl,
        url:              state.currentSetUrl,
        source:           state.currentSource,
        thumbnailUrl:     state.currentThumbnailUrl,
        tracklistUrl:     state.currentTracklistUrl || histEntry?.tracklistUrl || undefined,
        tracklistProvider: state.currentTracklistProvider || histEntry?.tracklistProvider || undefined,
        ...metadata,
        metadataIgnoredValues: normalizedIgnoredMetadataValues(state.metadataRemovedValues)
          .map(({ field, value }) => ({ field, value })),
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
    setTrackPlaying(false)
    refreshScrobbleBadge()
  })

  webview.addEventListener('did-navigate', (e) => {
    const url = e.url || ''
    if (!url.includes('1001tracklists.com')) {
      hideOverlays()
      ppIcon.innerHTML = icon(ICON.play, 16)
      btnPlayPause.classList.remove('playing')
      npTracknum.textContent = ''
      setTrackPlaying(false)
      refreshScrobbleBadge()
    }
  })

  // Loading hung watchdog buttons
  btnLoadingReport.addEventListener('click', () => {
    clearLoadingWatchdog()
    loadingHung.classList.add('hidden')
    openSupportDialog('bug')
  })
  btnLoadingRestart.addEventListener('click', () => {
    window.api.appRestart()
  })
  btnLoadingDismiss.addEventListener('click', () => {
    clearLoadingWatchdog()
    loadingHung.classList.add('hidden')
  })

  btnPlayAnyway.addEventListener('click', () => {
    if (!pendingPlayUrl) return
    const url = pendingPlayUrl
    pendingPlayUrl = null
    hasEverPlayed = true
    navigateTo(url)
    updateViewTabs()
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
  eventSuggestionsEnabledInput.addEventListener('change', () => {
    setEventSuggestionsEnabled(eventSuggestionsEnabledInput.checked)
  })
  btnSaveEventLocation.addEventListener('click', saveEventLocation)
  eventCityInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveEventLocation()
  })
  eventCountrySelect.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveEventLocation()
  })
  eventCountrySelect.addEventListener('change', () => syncOtherCountryField({ focus: true }))
  eventCountryOtherInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveEventLocation()
  })

  sidebarFooter.addEventListener('click', (e) => {
    const link = e.target.closest('.sidebar-footer-link')
    if (!link) return
    if (link.dataset.action === 'about') openAboutDialog()
    else if (link.dataset.feedbackType) openSupportDialog(link.dataset.feedbackType)
    else if (link.dataset.href) window.api.openExternal(link.dataset.href)
  })

  btnAboutClose.addEventListener('click', closeAboutDialog)
  aboutDialog.addEventListener('click', (e) => { if (e.target === aboutDialog) closeAboutDialog() })
  btnAboutChangelog.addEventListener('click', () => { closeAboutDialog(); openUpdateDialog() })
  btnAboutFeature.addEventListener('click', () => { closeAboutDialog(); openSupportDialog('feature') })
  btnAboutBug.addEventListener('click', () => { closeAboutDialog(); openSupportDialog('bug') })
  btnAboutWebsite.addEventListener('click', () => window.api.openExternal('https://www.djscrobbler.com'))
  document.querySelectorAll('.about-link').forEach(a => {
    a.addEventListener('click', () => window.api.openExternal(a.dataset.href))
  })

  btnContributeTracklist.addEventListener('click', () => {
    if (state.currentContributeUrl) window.api.openExternal(state.currentContributeUrl)
  })

  btnSetMetadataRefresh.addEventListener('click', autoSetMetadata)
  btnSetMetadataEdit.addEventListener('click', () => {
    const currentMode = state.metadataEditMode == null
      ? setMetadataHeader.classList.contains('is-editing')
      : state.metadataEditMode
    state.metadataEditMode = !currentMode
    renderSetMetadataHeader()
  })

  // Ask main to re-run the lookup against an alternate provider. The reply
  // arrives as a fresh tracklist-loaded, which repaints this whole panel — the
  // button only has to stay busy until then.
  btnAltProvider.addEventListener('click', async () => {
    const alt = state.currentAltProvider
    if (!alt || btnAltProvider.disabled) return
    btnAltProvider.disabled = true
    btnAltProvider.textContent = `Searching ${alt.name}…`
    try {
      await window.api.tryTracklistProvider(alt.id)
    } finally {
      btnAltProvider.disabled = false
      if (state.currentAltProvider === alt) btnAltProvider.textContent = alt.label
    }
  })

  btnContributeClose.addEventListener('click', closeContributeDialog)
  btnContributeDismiss.addEventListener('click', closeContributeDialog)
  btnContributeOpen.addEventListener('click', () => {
    closeContributeDialog()
    window.api.openExternal(state.currentTracklistUrl || 'https://www.1001tracklists.com')
  })
  contributeDialog.addEventListener('click', (e) => {
    if (e.target === contributeDialog) closeContributeDialog()
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
  btnClearTracklistCache.addEventListener('click', async () => {
    btnClearTracklistCache.disabled = true
    const count = await window.api.tracklistCacheClear()
    tracklistCacheStatus.textContent = count > 0
      ? `Cleared ${count} cached tracklist/artwork item${count === 1 ? '' : 's'}.`
      : 'Cache was already empty.'
    btnClearTracklistCache.disabled = false
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
  btnResumeDismiss.addEventListener('click', () => closeResumeDialog())
  btnResumeStart.addEventListener('click',   () => doResumeChoice(false))
  btnResumeResume.addEventListener('click',  () => doResumeChoice(true))
  resumeDialog.addEventListener('click', (e) => {
    if (e.target === resumeDialog) closeResumeDialog()  // backdrop click = dismiss
  })

  // Full-workspace views
  btnViewHome.addEventListener('click', () => {
    document.body.classList.remove('is-browsing')
    showIntro()
    updateViewTabs()
  })
  btnViewLibrary.addEventListener('click', () => {
    document.body.classList.remove('is-browsing')
    showLibrary()
    updateViewTabs()
  })
  librarySearchInput.addEventListener('input', renderDjLibrary)
  libraryViewOptions.forEach(option => {
    option.addEventListener('click', () => setLibraryViewMode(option.dataset.libraryView))
  })
  eventVenueLibrarySearchInput.addEventListener('input', renderEventVenueLibrary)
  eventVenueLibraryViewOptions.forEach(option => {
    option.addEventListener('click', () => setEventVenueLibraryViewMode(option.dataset.eventVenueView))
  })
  eventVenueLibraryTypeOptions.forEach(option => {
    option.addEventListener('click', () => setEventVenueLibraryType(option.dataset.eventVenueType))
  })
  btnLibraryBack.addEventListener('click', () => {
    const focusEventVenueSearch = !!activeLibraryEventVenueKey
    showDjLibraryOverview()
    ;(focusEventVenueSearch ? eventVenueLibrarySearchInput : librarySearchInput).focus()
  })
  btnViewNowplaying.addEventListener('click', () => {
    hideIntro()
    document.body.classList.remove('is-browsing')
    updateViewTabs()
  })
  btnViewSearch.addEventListener('click', () => {
    hideIntro()
    document.body.classList.add('is-browsing')
    updateViewTabs()
  })

  // Intro screen — allow window drag from blank/non-interactive areas
  introScreen.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return
    if (e.target.closest('#intro-search, #intro-resume')) return
    startWindowDrag(e)
  })

  // Intro search bar
  introSearchInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return
    const q = introSearchInput.value.trim()
    if (q) navigateToSearch(q)
  })

  // Clear history
  btnClearHistory.addEventListener('click', () => {
    state.store.history = []
    persist()
    renderHistory()
    historyClearStatus.textContent = 'History cleared.'
    setTimeout(() => { historyClearStatus.textContent = 'Remove all played sets from history.' }, 3000)
  })

  // Resume behavior setting radio buttons
  document.querySelectorAll('input[name="resume-behavior"]').forEach(r => {
    r.addEventListener('change', () => {
      if (!state.store.settings) state.store.settings = {}
      state.store.settings.resumeBehavior = r.value
      persist()
    })
  })

  // Re-render resume thumbnails whenever the intro screen changes size
  // (covers both window resize and sidebar drag — no polling, fires on layout change)
  const introResizeObserver = new ResizeObserver(() => {
    if (!introScreen.classList.contains('hidden')) renderIntroResume()
  })
  introResizeObserver.observe(introScreen)

  // Flush any throttled progress persists so seek position survives an immediate quit
  window.addEventListener('beforeunload', () => {
    let needsPersist = false
    if (_fallbackPersistTimer) {
      clearTimeout(_fallbackPersistTimer)
      _fallbackPersistTimer = null
      needsPersist = true
    }
    if (_seekPersistTimer) {
      clearTimeout(_seekPersistTimer)
      _seekPersistTimer = null
      needsPersist = true
    }
    if (needsPersist) persist()
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
