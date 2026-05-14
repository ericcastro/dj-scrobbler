/**
 * 1001Tracklists tracklist plugin.
 *
 * Matching strategy:
 *   1. POST the source YouTube URL to the 1001tl search endpoint.
 *   2. For each search result (in order), fetch the tracklist page over HTTPS
 *      and look for the YouTube video ID in the embedded player markup.
 *   3. Return the first result whose embedded ID matches the source video ID.
 *   4. If no result matches → return [] so the caller falls back gracefully.
 *
 * This is more reliable than text similarity because:
 *   - The 1001tl search already ranks by URL relevance, so result #1 is
 *     almost always correct.
 *   - An exact video-ID match is unambiguous regardless of title formatting,
 *     special characters, diacritics, or version suffixes.
 */
const https = require('https')

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:150.0) Gecko/20100101 Firefox/150.0',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Cookie: 'guid=3dc62f90cce8f',
}

function providerError(code, message) {
  const err = new Error(message)
  err.code = code
  err.providerId = '1001tracklists'
  return err
}

function assertProviderResponse(html) {
  if (/access has been limited due to overuse/i.test(html || '')) {
    throw providerError(
      'provider_access_limited',
      '1001Tracklists temporarily limited access due to overuse. Wait a bit before retrying.'
    )
  }
  if (/challenges\.cloudflare\.com\/turnstile|turnstile-container|Please wait, you will be forwarded/i.test(html || '')) {
    throw providerError(
      'provider_challenge',
      '1001Tracklists requested a browser verification challenge.'
    )
  }
}

// Fetch a 1001tracklists page by path, following one level of redirect.
function fetchPage(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.1001tracklists.com',
      path,
      method: 'GET',
      headers: { ...COMMON_HEADERS, Referer: 'https://www.1001tracklists.com/' },
    }, (res) => {
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        try {
          const loc = new URL(res.headers.location, 'https://www.1001tracklists.com')
          if (loc.hostname === 'www.1001tracklists.com') {
            return fetchPage(loc.pathname + loc.search).then(resolve)
          }
        } catch {}
        return resolve('')
      }
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        try {
          const html = Buffer.concat(chunks).toString()
          assertProviderResponse(html)
          resolve(html)
        } catch (err) {
          reject(err)
        }
      })
    })
    req.setTimeout(10_000, () => { req.destroy(); resolve('') })
    req.on('error', () => resolve(''))
    req.end()
  })
}

// POST the YouTube URL to the search endpoint; return an ordered list of
// { path, url, title } for every tracklist result found.
function searchByUrl(sourceUrl) {
  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      main_search: sourceUrl,
      search_selection: '9',
      orderby: 'added',
    }).toString()

    const req = https.request({
      hostname: 'www.1001tracklists.com',
      path: '/search/result.php',
      method: 'POST',
      headers: {
        ...COMMON_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        Origin: 'https://www.1001tracklists.com',
        Referer: 'https://www.1001tracklists.com/search/result.php',
      },
    }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        try {
          const html = Buffer.concat(chunks).toString()
          assertProviderResponse(html)

          if (html.includes('returns nothing')) { resolve([]); return }

          const seen    = new Set()
          const results = []
          const re = /href="(\/tracklist\/[a-z0-9]+\/([^"]+)\.html)"/g
          let m
          while ((m = re.exec(html)) !== null) {
            const path = m[1]
            if (seen.has(path)) continue
            seen.add(path)
            // Derive a human-readable title from the URL slug for logging
            const title = m[2]
              .replace(/-\d{4}-\d{2}-\d{2}(-\d{4}-\d{2}-\d{2})?$/, '')
              .replace(/-/g, ' ')
              .trim()
            results.push({ path, url: 'https://www.1001tracklists.com' + path, title })
          }
          resolve(results)
        } catch (err) {
          reject(err)
        }
      })
    })
    req.setTimeout(10_000, () => { req.destroy(); resolve([]) })
    req.on('error', () => resolve([]))
    req.write(postData)
    req.end()
  })
}

// Extract the YouTube video ID embedded in a 1001tracklists page.
// Checks, in order of reliability:
//   1. YouTube / youtube-nocookie iframe src  (most common)
//   2. ytPlayer.idPlayer JS variable          (1001tl's own player API)
//   3. data-id / data-youtube-id attributes   (occasional markup variants)
function extractVideoIdFromHtml(html) {
  const m1 = html.match(/youtube(?:-nocookie)?\.com\/embed\/([a-zA-Z0-9_-]{11})/)
  if (m1) return m1[1]

  const m2 = html.match(/idPlayer\s*[:=]\s*["']([a-zA-Z0-9_-]{11})["']/)
  if (m2) return m2[1]

  const m3 = html.match(/data-(?:youtube-)?id=["']([a-zA-Z0-9_-]{11})["']/)
  if (m3) return m3[1]

  return null
}

module.exports = {
  id: '1001tracklists',
  name: '1001Tracklists',
  supportedSources: ['youtube'],

  matchUrl(url) {
    return url.includes('1001tracklists.com/tracklist/')
  },

  // Returns [{ url, title, confirmed: true }] when the video ID matches.
  // If 1001 returns a browser challenge while confirming the result page, keep
  // the search result as an unconfirmed candidate so the BrowserWindow loader
  // still gets a chance to resolve and extract it.
  async findTracklists(meta) {
    const { url: sourceUrl, videoId } = meta
    if (!videoId) return []

    const results = await searchByUrl(sourceUrl)
    if (results.length === 0) return []

    let confirmationBlocked = false
    for (const result of results) {
      let html
      try {
        html = await fetchPage(result.path)
      } catch (err) {
        if (err?.code === 'provider_challenge' || err?.code === 'provider_access_limited') {
          confirmationBlocked = true
          continue
        }
        throw err
      }
      const foundId   = extractVideoIdFromHtml(html)
      if (foundId === videoId) {
        return [{ url: result.url, title: result.title, confirmed: true }]
      }
    }

    if (confirmationBlocked) {
      return results.map(result => ({ ...result, confirmationBlocked: true }))
    }

    return []
  },

  // Dormant v0.4 playback fields. v0.5 keeps them here as reference only while
  // playback moves to the app-owned YouTube player.
  playerConfig: {
    finderScript: 'getYTPlayer(ytPlayer.idPlayer).player.g',
    selectors: ['#playerWidget', 'iframe[src*="youtube"]', 'iframe[src*="youtube-nocookie"]'],
  },

  autoplayDelay: 3000,
  autoplayScript: `
    if (typeof ytPlayer !== 'undefined' && ytPlayer.idPlayer) {
      try { getYTPlayer(ytPlayer.idPlayer).player.playVideo() } catch(e) {}
    }
  `,

  // Extracts the full tracklist from the #tlTab DOM.
  // Returns normalized-ish provider track objects; v0.5 uses cueSeconds for
  // app-owned seeking/highlighting instead of 1001tl's playPosition handlers.
  tracklistExtractScript: `(() => {
    const rows = Array.from(document.querySelectorAll('.tlpItem'))
    return rows.map((row, index) => {
      const trackNumEl   = row.querySelector('.fontXL')
      const trackNumText = trackNumEl ? trackNumEl.textContent.trim() : ''
      const isWWith      = /^w\\//.test(trackNumText)
      const trackNum     = isWWith ? null : (parseInt(trackNumText) || null)
      const isId         = !!row.querySelector('.trackValue.redTxt')
      const nameMeta     = row.querySelector('meta[itemprop="name"]')
      const artistMeta   = row.querySelector('meta[itemprop="byArtist"]')
      const rawName      = nameMeta   ? (nameMeta.getAttribute('content')   || '') : ''
      const artist       = artistMeta ? (artistMeta.getAttribute('content') || '') : ''
      const prefix       = artist ? artist + ' - ' : ''
      const title        = prefix && rawName.startsWith(prefix) ? rawName.substring(prefix.length) : rawName
      const cueInput     = row.querySelector('input[id$="_cue_seconds"]')
      const hasTimestamp = !!cueInput
      const cueSeconds   = hasTimestamp ? (parseInt(cueInput.value) || 0) : null
      const cueEl        = row.querySelector('.cue')
      const cueDisplay   = cueEl ? cueEl.textContent.trim() : ''
      const artImg       = row.querySelector('img.artM')
      const artUrl       = artImg ? (artImg.dataset.src || artImg.src || '') : ''
      const playEl    = row.querySelector('i[onclick*="playPosition"]')
      const onclickStr = playEl ? (playEl.getAttribute('onclick') || null) : null
      // Mashup component: a named sub-track with no play position and no track number.
      // These are the source songs blended into a mashup — display-only, not seekable.
      const isMashupComponent = !hasTimestamp && !onclickStr && !isWWith && trackNum === null
      // noTimestamp: a numbered track that exists in the tracklist but has no cue
      // time — 1001tl lists it but there's no position data to seek or track.
      const noTimestamp = !hasTimestamp && !isMashupComponent && !isWWith
      const providerTrackId = row.id || '1001tl-row-' + index
      return { providerTrackId, trackNum, trackNumText, isWWith, isMashupComponent, noTimestamp, isId, artist, title, raw: rawName, hasTimestamp, cueSeconds, cueDisplay, artUrl, onclickStr }
    }).filter(t => t.raw || t.hasTimestamp || t.onclickStr)
  })()`,

  nowPlayingScript: `(() => {
    const row = document.getElementsByClassName('cPlay')[0]
    if (!row) return null
    const isId     = !!row.querySelector('.trackValue.redTxt')
    const nameMeta   = row.querySelector('meta[itemprop="name"]')
    const artistMeta = row.querySelector('meta[itemprop="byArtist"]')
    // ID tracks often have no nameMeta — allow them through with a synthetic raw key
    if (!nameMeta && !isId) return null
    const fullName = nameMeta ? (nameMeta.getAttribute('content') || '') : ''
    const artist   = artistMeta ? (artistMeta.getAttribute('content') || '') : ''
    const prefix   = artist ? artist + ' - ' : ''
    const title    = prefix && fullName.startsWith(prefix)
      ? fullName.substring(prefix.length) : fullName
    const trackNumEl = row.querySelector('.fontXL')
    const trackNum   = trackNumEl ? parseInt(trackNumEl.textContent.trim()) : null
    const pauseBtn   = document.getElementById('playerWidgetPause')
    const isPlaying  = pauseBtn ? pauseBtn.classList.contains('fa-pause') : true
    // Give ID tracks a unique raw key so emitNowPlaying fires when entering one
    const raw = fullName || (isId ? ('__id__:' + (trackNum ?? '?')) : '')
    return { artist, title, raw, trackNum, isPlaying, isId, source: '1001tl' }
  })()`,

  // Returns { currentTime, duration } from the embedded YouTube player.
  // Used to track playback position for resume even when the tracklist has no
  // per-track timestamps (e.g. Boiler Room sets where .cPlay is never assigned).
  // 1001tl's wrapper exposes getCurrentTime/getDuration directly; the raw
  // IFrame API object is at .player.g — we check both layers for robustness.
  progressScript: `(() => {
    try {
      if (typeof ytPlayer === 'undefined' || !ytPlayer.idPlayer || typeof getYTPlayer !== 'function') return null
      const _w = getYTPlayer(ytPlayer.idPlayer)
      if (!_w || !_w.player) return null
      const _pl = (typeof _w.player.getCurrentTime === 'function')
        ? _w.player
        : (_w.player.g && typeof _w.player.g.getCurrentTime === 'function')
          ? _w.player.g
          : null
      if (!_pl) return null
      const cur = _pl.getCurrentTime()
      const dur = typeof _pl.getDuration === 'function' ? _pl.getDuration() : null
      if (typeof cur !== 'number' || !dur || dur <= 0) return null
      return { currentTime: cur, duration: dur }
    } catch(e) { return null }
  })()`,
}
