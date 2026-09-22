const https = require('https')

const DEEZER_SEARCH_LIMIT = 10
const MAX_RESPONSE_BYTES = 1024 * 1024

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`]/g, "'")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

// set79 sometimes appends "(Mixed)" to the detected song even though it is
// only describing the DJ-set source. Other version markers (remix, edit,
// extended mix, etc.) remain significant and must match.
function normalizeTitle(value) {
  return normalizeText(value).replace(/\s+mixed(?:\s+version)?$/, '').trim()
}

function artistParts(value) {
  return String(value || '')
    .split(/\s+(?:&|and|x|vs\.?|feat\.?|ft\.?|featuring)\s+|\s*,\s*/i)
    .map(normalizeText)
    .filter(Boolean)
}

function isMeaningfulLabel(value) {
  const normalized = normalizeText(value)
  if (!normalized || /^(?:id|unknown|unknown artist|unknown track|tba|n a)$/.test(normalized)) return false
  return (normalized.match(/[\p{L}\p{N}]/gu) || []).length >= 2
}

function isArtworkLookupCandidate(track) {
  // Ambiguous YouTube-comment lines only reach Deezer when there are concrete
  // alternative splits to verify. No-dash lines stay editable IDs rather than
  // issuing an unbounded fuzzy search.
  if (track?.commentTracklist) {
    const hasVerifiedLabels = isMeaningfulLabel(track.artist) && isMeaningfulLabel(track.title)
    const hasAmbiguousSplits = Array.isArray(track.commentAmbiguousSplits) && track.commentAmbiguousSplits.length > 0
    return !!track && !String(track.artUrl || '').trim() && (hasVerifiedLabels || hasAmbiguousSplits)
  }
  return !!track &&
    !String(track.artUrl || '').trim() &&
    !track.isId &&
    isMeaningfulLabel(track.artist) &&
    isMeaningfulLabel(track.title)
}

function artworkLookupKey(track) {
  if (track?.commentTracklist) return `youtube-comment:${normalizeText(track?.raw || track?.title)}`
  return `${normalizeText(track?.artist)}\u001f${normalizeTitle(track?.title)}`
}

function deezerSearchUrl(track) {
  const artist = String(track?.artist || '').replace(/"/g, ' ').trim()
  const title = String(track?.title || '').replace(/"/g, ' ').trim()
  const url = new URL('https://api.deezer.com/search')
  url.searchParams.set('q', `artist:"${artist}" track:"${title}"`)
  url.searchParams.set('limit', String(DEEZER_SEARCH_LIMIT))
  return url
}

// Deezer's structured artist filter is unreliable for collaborative credits:
// it can return no rows when every credited artist is quoted, even when Deezer
// contains the exact track. Keep it as the preferred query, then use this
// broader search only when its results fail our existing exact title + artist
// validation below.
function deezerFallbackSearchUrl(track) {
  const artist = String(track?.artist || '').replace(/"/g, ' ').trim()
  const title = String(track?.title || '').replace(/"/g, ' ').trim()
  const url = new URL('https://api.deezer.com/search')
  url.searchParams.set('q', [artist, title].filter(Boolean).join(' '))
  url.searchParams.set('limit', String(DEEZER_SEARCH_LIMIT))
  return url
}

function artistMatches(requested, candidate) {
  const requestedNormalized = normalizeText(requested)
  const candidateNormalized = normalizeText(candidate)
  if (!requestedNormalized || !candidateNormalized) return false
  if (requestedNormalized === candidateNormalized) return true

  // Deezer search results name only the primary artist for some collaborations.
  // Accept it only as a complete credit component; title matching remains exact.
  const requestedParts = artistParts(requested)
  const candidateParts = artistParts(candidate)
  return candidateParts.length > 0 && candidateParts.every(part => requestedParts.includes(part))
}

function safeArtworkUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.dzcdn.net')) return null
    return url.toString()
  } catch {
    return null
  }
}

function chooseDeezerArtwork(track, results) {
  if (!isArtworkLookupCandidate(track) || !Array.isArray(results)) return null
  const wantedTitle = normalizeTitle(track.title)

  for (const candidate of results) {
    if (normalizeTitle(candidate?.title) !== wantedTitle) continue
    if (!artistMatches(track.artist, candidate?.artist?.name)) continue

    // 250px is already far larger than the 30px track-list presentation. Do
    // not retain Deezer's 500px/1000px variants or download image files.
    const artUrl = safeArtworkUrl(candidate?.album?.cover_medium)
    if (!artUrl) continue
    return {
      artUrl,
      deezerTrackId: candidate.id == null ? null : String(candidate.id),
    }
  }
  return null
}

function requestJson(url, { timeoutMs = 6000, userAgent = 'DJ-Scrobbler' } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent,
      },
    }, res => {
      const chunks = []
      let size = 0

      res.on('data', chunk => {
        size += chunk.length
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('Deezer artwork response was unexpectedly large.'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          const error = new Error(`Deezer artwork lookup returned HTTP ${res.statusCode}.`)
          error.statusCode = res.statusCode
          error.retryAfter = Number(res.headers['retry-after']) || null
          reject(error)
          return
        }
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (body?.error) {
            const error = new Error(body.error.message || 'Deezer artwork lookup failed.')
            error.statusCode = Number(body.error.code) || null
            reject(error)
            return
          }
          resolve(body)
        } catch {
          reject(new Error('Deezer artwork lookup returned unreadable data.'))
        }
      })
    })

    req.setTimeout(timeoutMs, () => req.destroy(new Error('Deezer artwork lookup timed out.')))
    req.on('error', reject)
    req.end()
  })
}

async function lookupDeezerArtwork(track, options) {
  const request = options?.requestJson || requestJson
  const requestOptions = { ...(options || {}) }
  delete requestOptions.requestJson
  const candidates = track?.commentTracklist
    ? track.commentAmbiguousSplits.map(candidate => ({ ...track, ...candidate, commentAmbiguousSplits: undefined }))
    : [track]
  for (const candidate of candidates) {
    const response = await request(deezerSearchUrl(candidate), requestOptions)
    const strictMatch = chooseDeezerArtwork(candidate, response?.data)
    if (strictMatch) return { ...strictMatch, ...(track?.commentTracklist ? { artist: candidate.artist, title: candidate.title } : {}) }

    const fallbackResponse = await request(deezerFallbackSearchUrl(candidate), requestOptions)
    const fallbackMatch = chooseDeezerArtwork(candidate, fallbackResponse?.data)
    if (fallbackMatch) return { ...fallbackMatch, ...(track?.commentTracklist ? { artist: candidate.artist, title: candidate.title } : {}) }
  }
  return null
}

module.exports = {
  DEEZER_SEARCH_LIMIT,
  artworkLookupKey,
  artistMatches,
  chooseDeezerArtwork,
  deezerFallbackSearchUrl,
  deezerSearchUrl,
  isArtworkLookupCandidate,
  lookupDeezerArtwork,
  normalizeText,
  normalizeTitle,
}
