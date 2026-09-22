/**
 * YouTube comments tracklist provider.
 *
 * It uses the canonical watch-page response already fetched by the YouTube
 * source, then asks YouTube's own web continuation endpoint for comments. We
 * inspect one initial batch and, only when it has no credible tracklist, one
 * regular comments continuation. Reply continuations are explicitly ignored.
 */
const https = require('https')
const {
  continuationFromResponse,
  descriptionFromWatchPage,
  extractComments,
  extractWatchBootstrap,
  parseTimestampedTracks,
  rankCommentCandidates,
  isCredibleTimestampTracklist,
} = require('../../lib/youtube-comments')

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36'

function providerError(code, message) {
  const error = new Error(message)
  error.code = code
  error.providerId = 'youtube-comments'
  return error
}

function requestCommentBatch(bootstrap, continuation) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      context: {
        client: {
          clientName: bootstrap.clientName,
          clientVersion: bootstrap.clientVersion,
          ...(bootstrap.visitorData ? { visitorData: bootstrap.visitorData } : {}),
        },
      },
      continuation,
    })
    const req = https.request({
      hostname: 'www.youtube.com',
      path: `/youtubei/v1/next?prettyPrint=false&key=${encodeURIComponent(bootstrap.apiKey)}`,
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': USER_AGENT,
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': bootstrap.clientVersion,
      },
    }, response => {
      const chunks = []
      let size = 0
      response.on('data', chunk => {
        size += chunk.length
        if (size > 3 * 1024 * 1024) req.destroy(new Error('YouTube comments response was unexpectedly large.'))
        else chunks.push(chunk)
      })
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(providerError('provider_unavailable', `YouTube comments returned HTTP ${response.statusCode}.`))
          return
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch { reject(providerError('provider_unavailable', 'YouTube comments returned unreadable data.')) }
      })
    })
    req.setTimeout(7000, () => req.destroy(providerError('network_unavailable', 'YouTube comments timed out.')))
    req.on('error', error => reject(error.code ? error : providerError('network_unavailable', 'Could not reach YouTube comments.')))
    req.write(body)
    req.end()
  })
}

async function findCommentTracklist(meta, requestBatch = requestCommentBatch) {
  const watchPage = await meta?.watchPagePromise
  const descriptionTracks = parseTimestampedTracks(descriptionFromWatchPage(watchPage), 'description')
  if (isCredibleTimestampTracklist(descriptionTracks)) {
    return { type: 'description', author: '', tracks: descriptionTracks, score: Number.POSITIVE_INFINITY }
  }
  const bootstrap = extractWatchBootstrap(watchPage)
  if (!bootstrap) return null

  let response = await requestBatch(bootstrap, bootstrap.continuation)
  let candidates = rankCommentCandidates(extractComments(response), meta)
  if (!candidates.length) {
    // A single ordinary continuation is the hard limit. We do not emulate
    // scrolling, expand replies, or chase long comment threads.
    const continuation = continuationFromResponse(response)
    if (continuation) {
      response = await requestBatch(bootstrap, continuation)
      candidates = rankCommentCandidates(extractComments(response), meta)
    }
  }
  return candidates[0] || null
}

module.exports = {
  id: 'youtube-comments',
  name: 'YouTube',
  supportedSources: ['youtube'],
  footerLabel: 'view on YouTube ↗',
  externalHost: 'youtube.com',

  matchUrl() { return false },

  async findTracklists(meta) {
    const candidate = await findCommentTracklist(meta)
    if (!candidate) return []
    const label = candidate.type === 'description' ? 'YouTube description' : 'YouTube comments'
    const author = candidate.author ? ` · ${candidate.author}` : ''
    return [{
      url: meta.url,
      title: `${label}${author}`,
      confirmed: true,
      commentCandidate: candidate,
    }]
  },

  async extractTracklist(meta, best) {
    const candidate = best?.commentCandidate
    if (!candidate?.tracks?.length) return { title: null, tracks: [], metadata: null }
    return { title: meta.title || best.title, tracks: candidate.tracks, metadata: null }
  },

  _test: {
    findCommentTracklist,
    providerError,
    requestCommentBatch,
  },
}
