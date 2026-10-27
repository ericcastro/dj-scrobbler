const { extractInitialData, walk, displayText } = require('./youtube-page-data')

const MIN_TIMESTAMPED_ROWS = 3
const DASH_RE = /[-‐‑‒–—−]/g

function normalise(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function extractString(html, patterns) {
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern)
    if (match?.[1]) return match[1].replace(/\\u0026/g, '&')
  }
  return null
}

function isCommentsContinuation(token) {
  const decoded = (() => { try { return Buffer.from(token, 'base64url').toString('utf8') } catch { return '' } })()
  return /comments-section|comments_entry_point/i.test(decoded) && !/comment-replies/i.test(decoded)
}

function continuations(value) {
  const tokens = []
  walk(value, item => {
    const token = item?.continuationCommand?.token || item?.nextContinuationData?.continuation
    if (typeof token === 'string' && token) tokens.push(token)
  })
  return [...new Set(tokens)]
}

function extractWatchBootstrap(html) {
  const data = extractInitialData(html)
  if (!data) return null
  const candidates = continuations(data)
  const continuation = candidates.find(isCommentsContinuation) || null
  const apiKey = extractString(html, [/"INNERTUBE_API_KEY":"([^"]+)"/, /"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/])
  const clientVersion = extractString(html, [/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/])
  const visitorData = extractString(html, [/"VISITOR_DATA":"([^"]+)"/])
  if (!apiKey || !clientVersion || !continuation) return null
  return { apiKey, clientName: 'WEB', clientVersion, visitorData, continuation }
}

function parseTimestamp(value) {
  const pieces = String(value || '').split(':').map(Number)
  if (pieces.length === 2) {
    const [minutes, seconds] = pieces
    return Number.isInteger(minutes) && Number.isInteger(seconds) && minutes >= 0 && seconds >= 0 && seconds < 60
      ? minutes * 60 + seconds : null
  }
  if (pieces.length === 3) {
    const [hours, minutes, seconds] = pieces
    return Number.isInteger(hours) && Number.isInteger(minutes) && Number.isInteger(seconds) && hours >= 0 && minutes >= 0 && minutes < 60 && seconds >= 0 && seconds < 60
      ? hours * 3600 + minutes * 60 + seconds : null
  }
  return null
}

function cueDisplay(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`
}

function splitCommentTrackLine(line) {
  const text = String(line || '').trim()
  const separators = [...text.matchAll(DASH_RE)].map(match => match.index)
  if (separators.length === 1) {
    const at = separators[0]
    const artist = text.slice(0, at).trim()
    const title = text.slice(at + 1).trim()
    return artist && title ? { artist, title, ambiguousSplits: [] } : { artist: 'ID', title: text, ambiguousSplits: [] }
  }
  if (separators.length > 1) {
    const ambiguousSplits = separators.map(at => ({
      artist: text.slice(0, at).trim(),
      title: text.slice(at + 1).trim(),
    })).filter(candidate => candidate.artist && candidate.title)
    return { artist: 'ID', title: text, ambiguousSplits }
  }
  return { artist: 'ID', title: text, ambiguousSplits: [] }
}

function parseTimestampedTracks(content, commentId = 'comment') {
  const tracks = []
  const seen = new Set()
  String(content || '').split(/\r?\n/).forEach(line => {
    const match = line.match(/^\s*(\d{1,3}:\d{2}(?::\d{2})?)\b\s*(?:[-–—|•:]\s*)?(.+?)\s*$/)
    if (!match) return
    const cueSeconds = parseTimestamp(match[1])
    const title = match[2].replace(/^[-–—|•:]\s*/, '').trim()
    if (cueSeconds === null || !title || seen.has(cueSeconds)) return
    seen.add(cueSeconds)
    const parsed = splitCommentTrackLine(title)
    tracks.push({
      providerTrackId: `youtube-comment:${commentId}:${tracks.length + 1}`,
      trackNum: tracks.length + 1,
      cueSeconds,
      cueDisplay: cueDisplay(cueSeconds),
      hasTimestamp: true,
      noTimestamp: false,
      // One separator is unambiguous. With multiple separators do not guess:
      // retain the line for manual correction, but pass every possible split
      // to Deezer in order so a verified artwork match can resolve it.
      artist: parsed.artist,
      title: parsed.title,
      raw: title,
      commentTracklist: true,
      ...(parsed.ambiguousSplits.length ? { commentAmbiguousSplits: parsed.ambiguousSplits } : {}),
      artUrl: '',
    })
  })
  return tracks
}

function descriptionFromWatchPage(html) {
  const data = extractInitialData(html)
  let description = ''
  if (data) {
    walk(data, item => {
      if (description || !item?.videoSecondaryInfoRenderer) return
      const secondary = item.videoSecondaryInfoRenderer
      description = displayText(secondary.attributedDescription || secondary.description)
    })
  }
  if (description) return description

  // The player response retains this stable JSON-escaped field even when an
  // experiment omits the visible secondary-info renderer.
  const match = String(html || '').match(/"shortDescription":"((?:\\.|[^"\\])*)"/)
  if (!match) return ''
  try { return JSON.parse(`"${match[1]}"`) } catch { return '' }
}

function isCredibleTimestampTracklist(tracks) {
  return tracks.length >= MIN_TIMESTAMPED_ROWS && orderedTimestampRatio(tracks) >= 0.75
}

function orderedTimestampRatio(tracks) {
  const increasing = tracks.filter((track, index) => index === 0 || track.cueSeconds > tracks[index - 1].cueSeconds).length
  return tracks.length ? increasing / tracks.length : 0
}

function extractComments(payload) {
  const comments = []
  let position = 0
  walk(payload, item => {
    const legacy = item?.commentRenderer
    if (legacy) {
      comments.push({
        id: legacy.commentId || `legacy-${position}`,
        content: displayText(legacy.contentText),
        author: displayText(legacy.authorText),
        likes: Number(String(displayText(legacy.voteCount)).replace(/[^\d]/g, '')) || 0,
        owner: !!legacy.authorIsChannelOwner,
        position: position++,
      })
    }
    const modern = item?.commentEntityPayload
    const properties = modern?.properties
    if (properties?.content?.content) {
      comments.push({
        id: properties.commentId || modern?.key || `modern-${position}`,
        content: properties.content.content,
        author: properties.authorButtonA11y || '',
        likes: Number(properties.likeCount || 0),
        owner: !!properties.authorIsChannelOwner,
        position: position++,
      })
    }
  })
  return comments
}

function authorAffinity(comment, meta) {
  const author = normalise(comment.author)
  if (!author) return 0
  const channel = normalise(meta?.channel)
  const title = normalise(meta?.title)
  if (channel && (author.includes(channel) || channel.includes(author))) return 40
  // This is intentionally only a weak clue: commenters often use unrelated
  // handles, and a match to a title word is never an ownership assertion.
  const words = author.split(' ').filter(word => word.length > 2)
  return words.some(word => title.split(' ').includes(word)) ? 8 : 0
}

function rankCommentCandidates(comments, meta = {}) {
  return comments.map(comment => {
    const tracks = parseTimestampedTracks(comment.content, comment.id)
    const orderedRatio = orderedTimestampRatio(tracks)
    const credible = isCredibleTimestampTracklist(tracks)
    const score = (tracks.length * 130) + Math.min(60, Math.log2((comment.likes || 0) + 1) * 12) +
      (comment.owner ? 45 : 0) + authorAffinity(comment, meta) - Math.min(25, comment.position * 2)
    return { ...comment, tracks, orderedRatio, credible, score }
  }).filter(candidate => candidate.credible).sort((a, b) => b.score - a.score)
}

function continuationFromResponse(payload) {
  return continuations(payload).find(isCommentsContinuation) || null
}

module.exports = {
  MIN_TIMESTAMPED_ROWS,
  continuationFromResponse,
  descriptionFromWatchPage,
  extractComments,
  extractWatchBootstrap,
  parseTimestamp,
  parseTimestampedTracks,
  rankCommentCandidates,
  isCredibleTimestampTracklist,
  splitCommentTrackLine,
}
