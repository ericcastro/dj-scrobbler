/**
 * 1001Tracklists tracklist plugin.
 * Finds tracklists by POSTing the source URL to the 1001tl search endpoint,
 * then monitors the active track via the .cPlay DOM row.
 */
const https = require('https')

function searchHttp(sourceUrl) {
  return new Promise((resolve) => {
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
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:150.0) Gecko/20100101 Firefox/150.0',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        Origin: 'https://www.1001tracklists.com',
        Referer: 'https://www.1001tracklists.com/search/result.php',
        Cookie: 'guid=3dc62f90cce8f',
      },
    }, (res) => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString()
        const seen = new Set()
        const results = []
        const re = /href="(\/tracklist\/[a-z0-9]+\/([^"]+)\.html)"/g
        let m
        while ((m = re.exec(html)) !== null) {
          const path = m[1]
          if (seen.has(path)) continue
          seen.add(path)
          const title = m[2]
            .replace(/-\d{4}-\d{2}-\d{2}(-\d{4}-\d{2}-\d{2})?$/, '')
            .replace(/-/g, ' ')
            .trim()
          results.push({ url: 'https://www.1001tracklists.com' + path, title })
        }
        resolve(results)
      })
    })
    req.on('error', () => resolve([]))
    req.write(postData)
    req.end()
  })
}

module.exports = {
  id: '1001tracklists',
  name: '1001Tracklists',
  supportedSources: ['youtube'],

  matchUrl(url) {
    return url.includes('1001tracklists.com/tracklist/')
  },

  async findTracklists(meta) {
    return searchHttp(meta.url)
  },

  // Ordered selectors tried in sequence; first rendered match wins.
  // #playerWidget is the outer container; iframe fallback catches edge cases.
  playerSelectors: ['#playerWidget', 'iframe[src*="youtube"]', 'iframe[src*="youtube-nocookie"]'],

  autoplayDelay: 3000,
  autoplayScript: `
    if (typeof ytPlayer !== 'undefined' && ytPlayer.idPlayer) {
      try { getYTPlayer(ytPlayer.idPlayer).player.playVideo() } catch(e) {}
    }
  `,

  nowPlayingScript: `(() => {
    const row = document.getElementsByClassName('cPlay')[0]
    if (!row) return null
    const nameMeta   = row.querySelector('meta[itemprop="name"]')
    const artistMeta = row.querySelector('meta[itemprop="byArtist"]')
    if (!nameMeta) return null
    const fullName = nameMeta.getAttribute('content') || ''
    const artist   = artistMeta ? (artistMeta.getAttribute('content') || '') : ''
    const prefix   = artist ? artist + ' - ' : ''
    const title    = prefix && fullName.startsWith(prefix)
      ? fullName.substring(prefix.length) : fullName
    const trackNumEl = row.querySelector('.fontXL')
    const trackNum   = trackNumEl ? parseInt(trackNumEl.textContent.trim()) : null
    const pauseBtn   = document.getElementById('playerWidgetPause')
    const isPlaying  = pauseBtn ? pauseBtn.classList.contains('fa-pause') : true
    return { artist, title, raw: fullName, trackNum, isPlaying, source: '1001tl' }
  })()`,
}
