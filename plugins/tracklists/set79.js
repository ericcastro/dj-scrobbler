/**
 * set79 tracklist plugin.
 * Constructs the tracklist URL directly from the SoundCloud track path
 * and monitors the active track via the .track-row.active element.
 */
module.exports = {
  id: 'set79',
  name: 'set79',
  supportedSources: ['soundcloud'],

  matchUrl(url) {
    return url.includes('set79.com/tracklist/')
  },

  async findTracklists(meta) {
    const u = new URL(meta.url)
    return [{ url: `https://set79.com/tracklist/soundcloud.com${u.pathname}`, title: '' }]
  },

  autoplayDelay: 0,
  autoplayScript: null,

  nowPlayingScript: `(() => {
    const activeRow = document.querySelector('.track-row.active')
    if (!activeRow) return null
    const ariaLabel = activeRow.getAttribute('aria-label') || ''
    const match = ariaLabel.match(/Track (\\d+): (.+?) at \\d/)
    if (!match) return null
    const trackNum = parseInt(match[1])
    const raw = match[2]
    const dashIdx = raw.lastIndexOf(' - ')
    return {
      artist: dashIdx > 0 ? raw.substring(0, dashIdx).trim() : '',
      title:  dashIdx > 0 ? raw.substring(dashIdx + 3).trim() : raw,
      raw, trackNum, isPlaying: true, source: 'set79',
    }
  })()`,
}
