/**
 * YouTube source plugin.
 * Detects youtube.com/watch URLs, intercepts clicks before SPA navigation,
 * and fetches metadata via the oEmbed API.
 */
const https = require('https')

function requestText(url, { timeoutMs = 4000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = https.request({
      hostname: target.hostname,
      path: target.pathname + target.search,
      method: 'GET',
      headers,
    }, (res) => {
      const chunks = []
      let byteLength = 0
      res.on('data', chunk => {
        byteLength += chunk.length
        if (byteLength <= 4 * 1024 * 1024) chunks.push(chunk)
      })
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`YouTube returned HTTP ${res.statusCode}`))
          return
        }
        resolve(Buffer.concat(chunks).toString())
      })
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('YouTube request timed out')))
    req.on('error', reject)
    req.end()
  })
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1]
  }
  return null
}

function parsePublicVideoStats(html) {
  const text = String(html || '')
  const rawViews = firstMatch(text, [
    /<meta[^>]+itemprop=["']interactionCount["'][^>]+content=["'](\d+)["']/i,
    /<meta[^>]+content=["'](\d+)["'][^>]+itemprop=["']interactionCount["']/i,
    /"videoDetails":\{[\s\S]{0,120000}?"viewCount":"(\d+)"/,
    /"viewCount":"(\d+)"/,
  ])
  const publishedAt = firstMatch(text, [
    /<meta[^>]+itemprop=["'](?:uploadDate|datePublished)["'][^>]+content=["'](\d{4}-\d{2}-\d{2})(?:T[^"']*)?["']/i,
    /<meta[^>]+content=["'](\d{4}-\d{2}-\d{2})(?:T[^"']*)?["'][^>]+itemprop=["'](?:uploadDate|datePublished)["']/i,
    /"uploadDate":"(\d{4}-\d{2}-\d{2})(?:T[^"]*)?"/,
    /"publishDate":"(\d{4}-\d{2}-\d{2})(?:T[^"]*)?"/,
  ])
  const viewCount = rawViews == null ? null : Number(rawViews)
  return {
    viewCount: Number.isSafeInteger(viewCount) ? viewCount : null,
    publishedAt,
  }
}

async function fetchOembed(canonicalUrl) {
  try {
    const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`
    const text = await requestText(url, {
      timeoutMs: 3000,
      headers: { 'User-Agent': 'dj-scrobbler/0.1' },
    })
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function fetchPublicVideoStats(canonicalUrl) {
  try {
    const html = await requestText(canonicalUrl, {
      headers: {
        'Accept-Language': 'en-US,en;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36',
      },
    })
    return parsePublicVideoStats(html)
  } catch {
    return { viewCount: null, publishedAt: null }
  }
}

module.exports = {
  id: 'youtube',
  name: 'YouTube',
  searchPlaceholder: 'Search YouTube for a DJ set…',
  searchBaseUrl: 'https://www.youtube.com',
  searchQueryUrl: q => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,

  matchUrl(url) {
    try {
      const u = new URL(url)
      return (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') &&
        u.pathname === '/watch' && u.searchParams.has('v')
    } catch { return false }
  },

  shouldInjectOn(url) {
    try { return new URL(url).hostname.includes('youtube.com') } catch { return false }
  },

  // Injected into YouTube pages — intercepts video link clicks in the capture
  // phase so YouTube's own SPA handler never sees them.
  interceptScript: `(function() {
    if (window.__djScrobblerIntercept) return
    window.__djScrobblerIntercept = true
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]')
      if (!a) return
      try {
        const u = new URL(a.href)
        if ((u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com') &&
             u.pathname === '/watch' && u.searchParams.has('v')) {
          e.preventDefault()
          e.stopImmediatePropagation()
          console.log('__INTERCEPT__youtube__' + a.href)
        }
      } catch {}
    }, true)
  })()`,

  parseIntercept(message) {
    const prefix = '__INTERCEPT__youtube__'
    return message.startsWith(prefix) ? message.slice(prefix.length) : null
  },

  async getMeta(watchUrl) {
    // Strip every parameter except `v` so 1001tracklists always gets the
    // canonical URL (e.g. no &list=, &start_radio=, &pp=, etc.)
    let canonicalUrl = watchUrl
    let videoId = null
    try {
      const u = new URL(watchUrl)
      videoId = u.searchParams.get('v')
      canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`
    } catch {}

    // Start the heavier watch-page scrape now, but do not make playback wait
    // for it. Main listens to this promise and updates the explanatory copy
    // when the public stats arrive.
    const publicStatsPromise = fetchPublicVideoStats(canonicalUrl)
    const oembed = await fetchOembed(canonicalUrl)
    return {
      title: oembed?.title || null,
      channel: oembed?.author_name || null,
      url: canonicalUrl,
      videoId,
      viewCount: null,
      publishedAt: null,
      publicStatsPromise,
    }
  },

  parsePublicVideoStats,
}
