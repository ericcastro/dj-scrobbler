// The hosted wrapper cannot style its cross-origin YouTube iframe. Electron can
// target that frame directly, leaving the video and YouTube's DOM intact.
const YOUTUBE_PLAYER_UI_CSS = `
  /* Current embed controls are siblings of the video; older players use ytp-*. */
  #player-control-overlay,
  #player-controls-a11y-toggle,
  .ytp-bezel,
  .ytp-bezel-text-wrapper,
  .ytp-chrome-top,
  .ytp-gradient-top,
  .ytp-pause-overlay,
  .ytp-pause-overlay-container {
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
    transition: none !important;
    animation: none !important;
  }
`

function isYouTubeEmbedUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      ['youtube.com', 'www.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(url.host) &&
      /^\/embed\/[a-zA-Z0-9_-]{11}$/.test(url.pathname) &&
      url.searchParams.get('controls') !== '1'
  } catch {
    return false
  }
}

function isYouTubePlayerUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      ['djscrobbler.com', 'www.djscrobbler.com'].includes(url.host) &&
      url.pathname.replace(/\/$/, '') === '/embed/youtube'
  } catch {
    return false
  }
}

// Older/cached versions of the hosted wrapper paint black masks above YouTube.
// Keep those nodes available to its scripts, but never let them cover the video.
const LEGACY_WRAPPER_UI_SCRIPT = `
  (() => {
    if (!(${isYouTubePlayerUrl.toString()})(location.href)) return false
    const parent = document.head || document.documentElement
    if (!parent) return false
    const id = 'dj-scrobbler-legacy-player-masks'
    let style = document.getElementById(id)
    if (!style) {
      style = document.createElement('style')
      style.id = id
      parent.appendChild(style)
    }
    style.textContent = '#yt-ov-top, #yt-ov-center, #yt-ov-end { opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; transition: none !important; animation: none !important; }'
    return true
  })()
`

const YOUTUBE_PLAYER_UI_SCRIPT = `
  (() => {
    // Recheck after asynchronous execution: the frame may have navigated.
    if (!(${isYouTubeEmbedUrl.toString()})(location.href)) return false
    const parent = document.head || document.documentElement
    if (!parent) return false
    const id = 'dj-scrobbler-youtube-player-ui'
    let style = document.getElementById(id)
    if (!style) {
      style = document.createElement('style')
      style.id = id
      parent.appendChild(style)
    }
    style.textContent = ${JSON.stringify(YOUTUBE_PLAYER_UI_CSS)}
    return true
  })()
`

function wireYouTubePlayerUi(contents, shouldStyle, onError = () => {}) {
  const watched = new Map()
  let active = true

  async function apply(frame) {
    try {
      if (!active || contents.isDestroyed() || !frame || frame.isDestroyed() ||
          !shouldStyle() || !isYouTubePlayerUrl(contents.getURL())) return
      if (frame === contents.mainFrame && isYouTubePlayerUrl(frame.url)) {
        await frame.executeJavaScript(LEGACY_WRAPPER_UI_SCRIPT)
      } else if (isYouTubeEmbedUrl(frame.url)) {
        await frame.executeJavaScript(YOUTUBE_PLAYER_UI_SCRIPT)
      }
    } catch (error) {
      // Removed/navigating subframes are normal when loading another set.
      if (active && !contents.isDestroyed() && frame && !frame.isDestroyed()) onError(error)
    }
  }

  function watch(frame) {
    if (!frame || frame.isDestroyed() || watched.has(frame)) return
    const onReady = () => apply(frame)
    watched.set(frame, onReady)
    frame.on('dom-ready', onReady)
  }

  function pruneFrames(all = false) {
    for (const [frame, onReady] of watched) {
      if (!all && !frame.isDestroyed() && !frame.detached) continue
      frame.removeListener('dom-ready', onReady)
      watched.delete(frame)
    }
  }

  function refresh() {
    if (!active || contents.isDestroyed()) return
    pruneFrames()
    for (const frame of contents.mainFrame.framesInSubtree) {
      watch(frame)
      apply(frame)
    }
  }

  function onFrameCreated(_event, { frame }) {
    if (active) {
      pruneFrames()
      watch(frame)
      apply(frame)
    }
  }

  contents.on('frame-created', onFrameCreated)
  contents.on('did-finish-load', refresh)
  contents.once('destroyed', () => {
    active = false
    contents.removeListener('frame-created', onFrameCreated)
    contents.removeListener('did-finish-load', refresh)
    pruneFrames(true)
  })
  refresh()
}

module.exports = {
  wireYouTubePlayerUi,
  isYouTubePlayerUrl,
  isYouTubeEmbedUrl,
  YOUTUBE_PLAYER_UI_CSS,
  YOUTUBE_PLAYER_UI_SCRIPT,
  LEGACY_WRAPPER_UI_SCRIPT,
}
