/**
 * SoundCloud source plugin.
 * Detects soundcloud.com/<artist>/<track> URLs via will-navigate / did-navigate-in-page.
 * No click interception needed — SC uses real navigations.
 */
module.exports = {
  id: 'soundcloud',
  name: 'SoundCloud',
  searchPlaceholder: 'Search SoundCloud for a DJ set…',
  searchBaseUrl: 'https://soundcloud.com',
  searchQueryUrl: q => `https://soundcloud.com/search?q=${encodeURIComponent(q)}`,

  matchUrl(url) {
    try {
      const u = new URL(url)
      if (u.hostname !== 'soundcloud.com') return false
      const parts = u.pathname.split('/').filter(Boolean)
      const SKIP = ['you', 'discover', 'upload', 'signin', 'pages',
                    'charts', 'jobs', 'imprint', 'stream', 'search']
      return parts.length === 2 && !SKIP.includes(parts[0])
    } catch { return false }
  },

  // SoundCloud uses real navigations — no intercept script needed.
  interceptScript: null,
  shouldInjectOn() { return false },
  parseIntercept() { return null },

  async getMeta(url) {
    // SoundCloud oEmbed is available but title is usually enough from the URL slug
    return { title: null, channel: null, url }
  },
}
