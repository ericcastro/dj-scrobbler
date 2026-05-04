/**
 * YouTube source plugin.
 * Detects youtube.com/watch URLs, intercepts clicks before SPA navigation,
 * and fetches metadata via the oEmbed API.
 */
const https = require('https')

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
    try {
      const u = new URL(watchUrl)
      canonicalUrl = `https://www.youtube.com/watch?v=${u.searchParams.get('v')}`
    } catch {}

    return new Promise((resolve) => {
      const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`
      const u = new URL(oembed)
      const req = https.request({
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'GET',
        headers: { 'User-Agent': 'dj-scrobbler/0.1' },
      }, (res) => {
        const chunks = []
        res.on('data', c => chunks.push(c))
        res.on('end', () => {
          try {
            const d = JSON.parse(Buffer.concat(chunks).toString())
            resolve({ title: d.title || null, channel: d.author_name || null, url: canonicalUrl })
          } catch { resolve({ title: null, channel: null, url: canonicalUrl }) }
        })
      })
      req.on('error', () => resolve({ title: null, channel: null, url: canonicalUrl }))
      req.end()
    })
  },
}
