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
  .ytp-gradient-bottom,
  .ytp-chrome-bottom,
  .ytp-settings-menu,
  .ytp-popup,
  [role="dialog"][aria-modal="true"],
  #movie_player [role="menu"],
  .ytp-pause-overlay,
  .ytp-pause-overlay-container,
  yt-player-settings-menu-view-model,
  yt-contextual-sheet-layout,
  yt-sheet-view-model,
  ytm-menu-popup-renderer,
  tp-yt-iron-dropdown {
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
      /^\/embed\/[a-zA-Z0-9_-]{11}$/.test(url.pathname)
  } catch {
    return false
  }
}

function isYouTubeControlsEmbedUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' &&
      ['youtube.com', 'www.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(url.host) &&
      /^\/embed\/[a-zA-Z0-9_-]{11}$/.test(url.pathname) &&
      url.searchParams.get('controls') === '1'
  } catch {
    return false
  }
}

function parseQualityHeight(value) {
  const match = String(value || '').trim().match(/^(\d{3,4})p(?:\s|$)/i)
  return match ? Number(match[1]) : null
}

function chooseYouTubeQuality(labels, targetHeight) {
  const options = (Array.isArray(labels) ? labels : [])
    .map(label => ({
      label: String(label || '').trim(),
      height: parseQualityHeight(label),
      premium: /\bpremium\b/i.test(String(label || '')),
    }))
    .filter(option => Number.isFinite(option.height))
    .sort((a, b) => a.height - b.height || Number(a.premium) - Number(b.premium))
  if (!options.length) return null
  const target = Math.max(1, Number(targetHeight) || 1080)
  const selected = options.find(option => option.height >= target) || options[options.length - 1]
  return { label: selected.label, height: selected.height }
}

// YouTube removed its supported playback-quality setters in 2019. Keep native
// controls in the DOM, suppress them visually above, then use the same quality
// menu a viewer would. This is intentionally scrape-first and must fail open:
// playback on YouTube's automatic quality is always better than a broken player.
function buildYouTubeQualityScript(minimumHeight = 1080) {
  const requestedHeight = Math.max(1, Math.min(2160, Math.round(Number(minimumHeight) || 1080)))
  return `
    (async () => {
      if (!(${isYouTubeControlsEmbedUrl.toString()})(location.href)) {
        return { status: 'ineligible' }
      }

      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
      const labelFor = element => String(
        element?.getAttribute?.('aria-label') || element?.textContent || ''
      ).replace(/\\s+/g, ' ').trim()
      const actionableFor = element => element?.closest?.(
        'button, [role="menuitem"], [role="menuitemradio"], .ytp-menuitem, [tabindex], yt-list-item-view-model, tp-yt-paper-item'
      ) || element
      const menuElements = () => [...document.querySelectorAll(
        'button, [role="menuitem"], [role="menuitemradio"], .ytp-menuitem, [aria-label], [tabindex], yt-list-item-view-model, tp-yt-paper-item'
      )]
      const findControl = predicate => menuElements()
        .map(element => ({ element: actionableFor(element), label: labelFor(element) }))
        .filter(candidate => candidate.label && predicate(candidate.label))
        .sort((left, right) => left.label.length - right.label.length)[0]?.element || null
      const dismissPlayerMenus = async () => {
        const expandedSettings = document.querySelector(
          '[aria-label="Playback settings"][aria-expanded="true"], .player-settings-icon[aria-expanded="true"], .ytp-settings-button[aria-expanded="true"]'
        )
        if (expandedSettings) expandedSettings.click()

        // Sheet-style controls do not consistently expose aria-expanded. Escape
        // closes their navigation stack without touching playback, while the
        // accessibility toggle collapses any remaining player chrome.
        if (typeof KeyboardEvent === 'function') {
          for (const type of ['keydown', 'keyup']) {
            const event = new KeyboardEvent(type, {
              key: 'Escape', code: 'Escape', keyCode: 27, which: 27,
              bubbles: true, cancelable: true,
            })
            document.dispatchEvent(event)
          }
        }
        const controlsToggle = document.querySelector('#player-controls-a11y-toggle')
        if (/^hide player controls$/i.test(labelFor(controlsToggle))) controlsToggle.click()
        await sleep(100)
      }
      const video = document.querySelector('video')
      if (!video) return { status: 'not-ready', stage: 'video' }

      const renderedHeight = Math.round(Math.max(
        video.clientHeight || 0,
        document.documentElement?.clientHeight || 0
      ) * Math.max(1, Number(devicePixelRatio) || 1))
      const targetHeight = Math.min(2160, Math.max(${requestedHeight}, renderedHeight))
      const beforeHeight = Number(video.videoHeight) || 0
      if (beforeHeight >= targetHeight) {
        return { status: 'already-sufficient', targetHeight, beforeHeight, afterHeight: beforeHeight }
      }

      let qualityItem = null
      // A prior best-effort run may have left a menu open. Reuse it instead of
      // clicking the settings button again and accidentally closing the sheet.
      qualityItem = findControl(label => /^quality(?:\\s|$)/i.test(label))
      if (!qualityItem) {
        // The modern player unmounts most controls while idle. Its accessibility
        // toggle remains and deterministically mounts them without pointer motion.
        const controlsToggle = document.querySelector('#player-controls-a11y-toggle')
        if (/^show player controls$/i.test(labelFor(controlsToggle))) controlsToggle.click()

        let settings = null
        for (let attempt = 0; attempt < 12 && !settings; attempt++) {
          settings = document.querySelector('[aria-label="Playback settings"], .player-settings-icon, .ytp-settings-button') ||
            findControl(label => /^playback settings$/i.test(label))
          if (!settings) await sleep(50)
        }
        if (!settings) return { status: 'not-ready', stage: 'settings', targetHeight, beforeHeight }
        settings.click()
      }

      for (let attempt = 0; attempt < 12 && !qualityItem; attempt++) {
        qualityItem = findControl(label => /^quality(?:\\s|$)/i.test(label))
        if (!qualityItem) await sleep(50)
      }
      if (!qualityItem) return { status: 'not-ready', stage: 'quality-menu', targetHeight, beforeHeight }
      qualityItem.click()

      const explicitChoices = () => {
        const unique = new Set()
        return menuElements()
          .map(element => ({ element: actionableFor(element), label: labelFor(element) }))
          .filter(option => {
            if (!option.element || unique.has(option.element)) return false
            unique.add(option.element)
            return true
          })
          .map(option => ({
            ...option,
            height: (${parseQualityHeight.toString()})(option.label),
            premium: /\\bpremium\\b/i.test(option.label),
          }))
          .filter(option => Number.isFinite(option.height))
          .sort((a, b) => a.height - b.height || Number(a.premium) - Number(b.premium))
      }

      let choices = []
      for (let attempt = 0; attempt < 12 && !choices.length; attempt++) {
        choices = explicitChoices()
        if (!choices.length) await sleep(50)
      }

      // YouTube's newer sheet-style player menu routes Quality through an
      // intermediate policy page. "Advanced" is the only route to explicit
      // resolutions; "Higher picture quality" still leaves selection to Auto.
      if (!choices.length) {
        const advanced = findControl(label => /^advanced(?:\\s|$)/i.test(label))
        if (advanced) {
          advanced.click()
          for (let attempt = 0; attempt < 12 && !choices.length; attempt++) {
            choices = explicitChoices()
            if (!choices.length) await sleep(50)
          }
        }
      }
      if (!choices.length) return { status: 'not-ready', stage: 'quality-options', targetHeight, beforeHeight }

      const selected = choices.find(option => option.height >= targetHeight) || choices[choices.length - 1]
      selected.element.click()
      await dismissPlayerMenus()

      let afterHeight = beforeHeight
      for (let attempt = 0; attempt < 20; attempt++) {
        afterHeight = Number(video.videoHeight) || 0
        if (afterHeight >= selected.height) break
        await sleep(250)
      }
      return {
        status: 'selected',
        targetHeight,
        selectedHeight: selected.height,
        selectedLabel: selected.label,
        beforeHeight,
        afterHeight,
        verified: afterHeight >= selected.height,
      }
    })()
  `
}

function buildYouTubeWrapperQualityMaskScript(active) {
  return `
    (() => {
      if (!(${isYouTubePlayerUrl.toString()})(location.href)) return false
      return window.setDjScrobblerQualityAutomationActive?.(${active === true}) ?? false
    })()
  `
}

async function forceYouTubePlaybackQuality(contents, options = {}) {
  const attempts = Math.max(1, Number(options.attempts) || 12)
  const retryDelayMs = Math.max(0, Number(options.retryDelayMs) || 250)
  const targetHeight = Math.max(1, Number(options.targetHeight) || 1080)
  let latest = { status: 'not-ready', stage: 'frame' }
  let wrapperMasked = false

  try {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (!contents || contents.isDestroyed()) return { status: 'destroyed' }
      if (!isYouTubePlayerUrl(contents.getURL())) return { status: 'ineligible' }
      const frame = contents.mainFrame.framesInSubtree.find(candidate =>
        !candidate.isDestroyed() && isYouTubeControlsEmbedUrl(candidate.url)
      )
      if (frame) {
        try {
          if (!wrapperMasked && typeof contents.executeJavaScript === 'function') {
            wrapperMasked = !!await contents.executeJavaScript(
              buildYouTubeWrapperQualityMaskScript(true),
              true
            ).catch(() => false)
          }
          latest = await frame.executeJavaScript(buildYouTubeQualityScript(targetHeight), true)
          if (latest?.status !== 'not-ready') return latest
        } catch (error) {
          latest = { status: 'not-ready', stage: 'execution', error: error?.message || String(error) }
        }
      }
      if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, retryDelayMs))
    }
    return latest
  } finally {
    if (wrapperMasked && contents && !contents.isDestroyed() && typeof contents.executeJavaScript === 'function') {
      await contents.executeJavaScript(
        buildYouTubeWrapperQualityMaskScript(false),
        true
      ).catch(() => {})
    }
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
  forceYouTubePlaybackQuality,
  buildYouTubeQualityScript,
  buildYouTubeWrapperQualityMaskScript,
  chooseYouTubeQuality,
  parseQualityHeight,
  isYouTubePlayerUrl,
  isYouTubeEmbedUrl,
  isYouTubeControlsEmbedUrl,
  YOUTUBE_PLAYER_UI_CSS,
  YOUTUBE_PLAYER_UI_SCRIPT,
  LEGACY_WRAPPER_UI_SCRIPT,
}
