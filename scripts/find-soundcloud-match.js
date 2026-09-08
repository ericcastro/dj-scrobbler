#!/usr/bin/env node

/**
 * POC: find likely SoundCloud mirrors for a YouTube DJ set URL.
 *
 * This intentionally avoids downloading media. It uses public page/oEmbed
 * metadata, SoundCloud search result pages, and optional Playwright DOM
 * inspection when `--browser` is passed and Playwright is available.
 */

const { spawn } = require('child_process')

const DEFAULT_LIMIT = 8
const FETCH_TIMEOUT_MS = 15000
const USER_AGENT = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/124.0.0.0 Safari/537.36',
].join(' ')

const SKIP_SOUNDCLOUD_PATHS = new Set([
  'you',
  'discover',
  'upload',
  'signin',
  'pages',
  'charts',
  'jobs',
  'imprint',
  'stream',
  'search',
  'terms-of-use',
  'privacy',
  'popular',
  'messages',
  'notifications',
])

const TOKEN_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'dj',
  'for',
  'from',
  'full',
  'hd',
  'in',
  'live',
  'mix',
  'music',
  'official',
  'on',
  'set',
  'sets',
  'the',
  'video',
  'with',
  'youtube',
])

function usage() {
  console.log(`Usage:
  node scripts/find-soundcloud-match.js <youtube-url> [options]

Options:
  --browser          Also inspect SoundCloud search pages with Playwright if installed
  --no-http         Skip direct HTTP SoundCloud search
  --no-ytdlp        Do not try yt-dlp for YouTube metadata
  --limit <n>       Number of ranked candidates to print (default: ${DEFAULT_LIMIT})
  --json            Print machine-readable JSON
  --debug           Print extra diagnostics to stderr

Examples:
  node scripts/find-soundcloud-match.js 'https://www.youtube.com/watch?v=...'
  node scripts/find-soundcloud-match.js 'https://youtu.be/...' --browser --limit 12
`)
}

function parseArgs(argv) {
  const args = {
    browser: false,
    debug: false,
    http: true,
    json: false,
    limit: DEFAULT_LIMIT,
    ytdlp: true,
    youtubeUrl: null,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      args.help = true
    } else if (arg === '--browser') {
      args.browser = true
    } else if (arg === '--debug') {
      args.debug = true
    } else if (arg === '--json') {
      args.json = true
    } else if (arg === '--no-http') {
      args.http = false
    } else if (arg === '--no-ytdlp') {
      args.ytdlp = false
    } else if (arg === '--limit') {
      args.limit = Number(argv[++i])
      if (!Number.isFinite(args.limit) || args.limit < 1) {
        throw new Error('--limit must be a positive number')
      }
    } else if (!args.youtubeUrl) {
      args.youtubeUrl = arg
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return args
}

function debugLog(args, ...parts) {
  if (args.debug && !args.json) console.error('[debug]', ...parts)
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(1, value))
}

function round(value, digits = 3) {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function canonicalYouTubeUrl(input) {
  const url = new URL(input)
  let videoId = null

  if (url.hostname === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0]
  } else if (url.hostname.endsWith('youtube.com')) {
    if (url.pathname === '/watch') videoId = url.searchParams.get('v')
    if (url.pathname.startsWith('/shorts/')) videoId = url.pathname.split('/').filter(Boolean)[1]
    if (url.pathname.startsWith('/embed/')) videoId = url.pathname.split('/').filter(Boolean)[1]
  }

  if (!videoId) throw new Error('Expected a youtube.com/watch, youtube.com/embed, youtube.com/shorts, or youtu.be URL')
  return { videoId, url: `https://www.youtube.com/watch?v=${videoId}` }
}

async function fetchText(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': USER_AGENT,
        ...(options.headers || {}),
      },
    })

    const body = await response.text()
    if (!response.ok) {
      const err = new Error(`HTTP ${response.status} for ${url}`)
      err.status = response.status
      err.body = body.slice(0, 1000)
      throw err
    }
    return body
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, {
    ...options,
    headers: {
      'Accept': 'application/json,text/plain,*/*',
      ...(options.headers || {}),
    },
  })
  return JSON.parse(text)
}

function runJsonCommand(command, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = []
    const errors = []
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      resolve(null)
    }, timeoutMs)

    child.stdout.on('data', c => chunks.push(c))
    child.stderr.on('data', c => errors.push(c))
    child.on('error', () => {
      clearTimeout(timeout)
      resolve(null)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code !== 0) return resolve(null)
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        resolve(null)
      }
    })
  })
}

async function getYouTubeMetaWithYtDlp(youtubeUrl) {
  const data = await runJsonCommand('yt-dlp', [
    '--dump-single-json',
    '--skip-download',
    '--no-warnings',
    youtubeUrl,
  ])
  if (!data) return null

  return compactMeta({
    title: data.title,
    channel: data.channel || data.uploader,
    durationSeconds: secondsOrNull(data.duration),
    url: data.webpage_url || youtubeUrl,
    videoId: data.id,
    source: 'yt-dlp',
  })
}

async function getYouTubeMetaDirect(youtubeUrl) {
  const canonical = canonicalYouTubeUrl(youtubeUrl)
  const meta = {
    title: null,
    channel: null,
    durationSeconds: null,
    url: canonical.url,
    videoId: canonical.videoId,
    source: 'youtube-page',
  }

  try {
    const html = await fetchText(canonical.url)
    const player = extractYouTubePlayerResponse(html)
    const details = player && player.videoDetails
    if (details) {
      meta.title = details.title || meta.title
      meta.channel = details.author || meta.channel
      meta.durationSeconds = secondsOrNull(details.lengthSeconds)
    }

    const microformat = player && player.microformat && player.microformat.playerMicroformatRenderer
    if (microformat) {
      meta.title = meta.title || microformat.title && microformat.title.simpleText
      meta.channel = meta.channel || microformat.ownerChannelName
    }

    if (!meta.durationSeconds) {
      const lengthMatch = html.match(/"lengthSeconds"\s*:\s*"?(?<duration>\d+)"?/)
      meta.durationSeconds = lengthMatch ? secondsOrNull(lengthMatch.groups.duration) : null
    }
  } catch {
    meta.source = 'youtube-oembed'
  }

  if (!meta.title || !meta.channel) {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical.url)}&format=json`
      const oembed = await fetchJson(oembedUrl)
      meta.title = meta.title || oembed.title
      meta.channel = meta.channel || oembed.author_name
    } catch {
      // oEmbed is best effort; the caller will still see partial metadata.
    }
  }

  return compactMeta(meta)
}

async function getYouTubeMeta(youtubeUrl, args) {
  if (args.ytdlp) {
    debugLog(args, 'trying yt-dlp metadata')
    const viaYtDlp = await getYouTubeMetaWithYtDlp(youtubeUrl)
    if (viaYtDlp && viaYtDlp.title) return viaYtDlp
  }

  debugLog(args, 'trying direct YouTube metadata')
  return getYouTubeMetaDirect(youtubeUrl)
}

function extractYouTubePlayerResponse(html) {
  const directNeedles = [
    'var ytInitialPlayerResponse =',
    'ytInitialPlayerResponse =',
  ]

  for (const needle of directNeedles) {
    const idx = html.indexOf(needle)
    if (idx !== -1) {
      const objectStart = html.indexOf('{', idx + needle.length)
      const parsed = parseBalancedJsonObject(html, objectStart)
      if (parsed) return parsed
    }
  }

  const inline = html.match(/"ytInitialPlayerResponse"\s*:\s*(\{)/)
  if (inline && inline.index !== undefined) {
    const objectStart = html.indexOf('{', inline.index)
    const parsed = parseBalancedJsonObject(html, objectStart)
    if (parsed) return parsed
  }

  return null
}

function parseBalancedJsonObject(text, startIndex) {
  if (startIndex < 0 || text[startIndex] !== '{') return null
  let depth = 0
  let inString = false
  let escape = false

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i]

    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue

    if (ch === '{') depth++
    if (ch === '}') depth--
    if (depth === 0) {
      try {
        return JSON.parse(text.slice(startIndex, i + 1))
      } catch {
        return null
      }
    }
  }

  return null
}

function compactMeta(meta) {
  return {
    title: stringOrNull(meta.title),
    channel: stringOrNull(meta.channel),
    durationSeconds: secondsOrNull(meta.durationSeconds),
    url: stringOrNull(meta.url),
    videoId: stringOrNull(meta.videoId),
    source: stringOrNull(meta.source),
  }
}

function secondsOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function stringOrNull(value) {
  if (value === null || value === undefined) return null
  const str = String(value).trim()
  return str || null
}

function decodeHtml(value) {
  if (!value) return value
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/g, '/')
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .trim()
}

function tokens(value) {
  const raw = normalizeText(value).split(/\s+/).filter(Boolean)
  return raw.filter(token => token.length > 1 && !TOKEN_STOPWORDS.has(token))
}

function simplifyTitleForQuery(title) {
  return String(title || '')
    .replace(/\b(official\s+)?(music\s+)?video\b/ig, ' ')
    .replace(/\b(full\s+)?(dj\s+)?set\b/ig, ' ')
    .replace(/\bHD|4K|HQ\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripBracketNoise(title) {
  return String(title || '')
    .replace(/\[[^\]]*(official|video|hd|4k|visualizer|lyrics)[^\]]*\]/ig, ' ')
    .replace(/\([^)]*(official|video|hd|4k|visualizer|lyrics)[^)]*\)/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildSearchQueries(youtubeMeta) {
  const title = youtubeMeta.title || ''
  const channel = youtubeMeta.channel || ''
  const simplified = simplifyTitleForQuery(stripBracketNoise(title))
  const noSeparators = simplified.replace(/\s+[-|]\s+/g, ' ')
  const queries = [
    title,
    simplified,
    noSeparators,
    channel && simplified ? `${channel} ${simplified}` : null,
    channel && title ? `${channel} ${title}` : null,
  ]
    .filter(Boolean)
    .map(q => q.replace(/\s+/g, ' ').trim())
    .filter(q => q.length >= 3)

  return [...new Set(queries)].slice(0, 5)
}

async function discoverSoundCloudCandidates(youtubeMeta, args) {
  const queries = buildSearchQueries(youtubeMeta)
  const found = new Map()

  debugLog(args, `queries: ${queries.join(' | ')}`)

  if (args.http) {
    for (const query of queries) {
      try {
        const candidates = await searchSoundCloudHttp(query, args)
        addDiscovered(found, candidates, 'http', query)
      } catch (err) {
        debugLog(args, `http search failed for "${query}": ${err.message}`)
      }
    }
  }

  if (args.browser) {
    for (const query of queries) {
      try {
        const candidates = await searchSoundCloudWithBrowser(query, args)
        addDiscovered(found, candidates, 'browser', query)
      } catch (err) {
        debugLog(args, `browser search failed for "${query}": ${err.message}`)
      }
    }
  }

  const enriched = []
  const urls = [...found.keys()].slice(0, Math.max(args.limit * 4, 20))
  for (const url of urls) {
    const discovery = found.get(url)
    try {
      const meta = await getSoundCloudTrackMeta(url)
      enriched.push({
        ...meta,
        url: meta.url || url,
        discoveredBy: discovery.methods,
        queries: discovery.queries,
        bestPosition: discovery.bestPosition,
      })
    } catch (err) {
      debugLog(args, `metadata failed for ${url}: ${err.message}`)
      enriched.push({
        title: null,
        user: null,
        durationSeconds: null,
        url,
        discoveredBy: discovery.methods,
        queries: discovery.queries,
        bestPosition: discovery.bestPosition,
      })
    }
  }

  return enriched
}

function addDiscovered(found, candidates, method, query) {
  for (const candidate of candidates) {
    const url = canonicalSoundCloudTrackUrl(candidate.url || candidate.permalink_url)
    if (!url) continue
    const existing = found.get(url) || {
      methods: [],
      queries: [],
      bestPosition: Number.POSITIVE_INFINITY,
    }
    if (!existing.methods.includes(method)) existing.methods.push(method)
    if (!existing.queries.includes(query)) existing.queries.push(query)
    if (Number.isFinite(candidate.position)) {
      existing.bestPosition = Math.min(existing.bestPosition, candidate.position)
    }
    found.set(url, existing)
  }
}

async function searchSoundCloudHttp(query) {
  const url = `https://soundcloud.com/search/sounds?q=${encodeURIComponent(query)}`
  const html = await fetchText(url, {
    headers: { Referer: 'https://soundcloud.com/' },
  })

  const fromHydration = collectSoundCloudTracksFromHydration(html)
  const fromAnchors = collectSoundCloudTrackLinks(html)

  return [...fromHydration, ...fromAnchors]
}

async function searchSoundCloudWithBrowser(query) {
  let chromium
  try {
    ;({ chromium } = await import('playwright'))
  } catch {
    throw new Error('Playwright is not installed. Run `npm install -D playwright` or omit --browser.')
  }

  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({
      userAgent: USER_AGENT,
      viewport: { width: 1280, height: 900 },
    })
    await page.goto(`https://soundcloud.com/search/sounds?q=${encodeURIComponent(query)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    await page.waitForTimeout(3500)

    const html = await page.content()
    const fromHydration = collectSoundCloudTracksFromHydration(html)
    const fromAnchors = await page.$$eval('a[href]', anchors => anchors
      .map((a, index) => ({ href: a.href, text: a.textContent || '', position: index + 1 }))
      .filter(a => a.href && a.href.includes('soundcloud.com/'))
      .map(a => ({ url: a.href, title: a.text.trim(), position: a.position })))

    return [...fromHydration, ...fromAnchors]
  } finally {
    await browser.close()
  }
}

function collectSoundCloudTrackLinks(html) {
  const links = []
  const seen = new Set()
  const anchorRegex = /<a\b[^>]*href=(["'])(?<href>.*?)\1[^>]*>(?<text>[\s\S]*?)<\/a>/gi
  let match
  let position = 0

  while ((match = anchorRegex.exec(html))) {
    const url = canonicalSoundCloudTrackUrl(decodeHtml(match.groups.href))
    if (!url || seen.has(url)) continue
    seen.add(url)
    position += 1
    links.push({
      url,
      title: stripTags(decodeHtml(match.groups.text)).trim() || null,
      position,
    })
  }

  return links
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ')
}

function collectSoundCloudTracksFromHydration(html) {
  const hydration = extractSoundCloudHydration(html)
  if (!hydration) return []

  const tracks = []
  const seen = new Set()
  walk(hydration, (node) => {
    const track = normalizeSoundCloudTrackObject(node)
    if (!track || !track.url || seen.has(track.url)) return
    seen.add(track.url)
    track.position = tracks.length + 1
    tracks.push(track)
  })

  return tracks
}

function extractSoundCloudHydration(html) {
  const marker = 'window.__sc_hydration = '
  const idx = html.indexOf(marker)
  if (idx === -1) return null

  const arrayStart = html.indexOf('[', idx + marker.length)
  if (arrayStart === -1) return null

  let depth = 0
  let inString = false
  let escape = false

  for (let i = arrayStart; i < html.length; i++) {
    const ch = html[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '[') depth++
    if (ch === ']') depth--
    if (depth === 0) {
      try {
        return JSON.parse(html.slice(arrayStart, i + 1))
      } catch {
        return null
      }
    }
  }

  return null
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return
  visit(value)
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
    return
  }
  for (const item of Object.values(value)) walk(item, visit)
}

function normalizeSoundCloudTrackObject(node) {
  if (!node || typeof node !== 'object') return null

  const url = canonicalSoundCloudTrackUrl(node.permalink_url || node.uri || node.url)
  const title = stringOrNull(node.title)
  const durationMs = Number(node.full_duration || node.duration || node.display_duration)
  const user = node.user && (node.user.username || node.user.permalink)

  const looksLikeTrack = url && title && (
    node.kind === 'track' ||
    node.media ||
    node.policy ||
    node.publisher_metadata ||
    Number.isFinite(durationMs)
  )

  if (!looksLikeTrack) return null

  return {
    title,
    user: stringOrNull(user),
    durationSeconds: Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : null,
    url,
  }
}

async function getSoundCloudTrackMeta(url) {
  const canonicalUrl = canonicalSoundCloudTrackUrl(url)
  if (!canonicalUrl) throw new Error(`Not a SoundCloud track URL: ${url}`)

  const html = await fetchText(canonicalUrl, {
    headers: { Referer: 'https://soundcloud.com/' },
  })

  const tracks = collectSoundCloudTracksFromHydration(html)
  const matching = tracks.find(track => sameUrlPath(track.url, canonicalUrl)) || tracks[0]
  if (matching) return matching

  const title = metaContent(html, 'og:title') || titleTag(html)
  const user = metaContent(html, 'soundcloud:creator') || null
  const durationSeconds = secondsOrNull(metaContent(html, 'music:duration'))

  return {
    title,
    user,
    durationSeconds,
    url: canonicalUrl,
  }
}

function metaContent(html, property) {
  const re = new RegExp(`<meta\\b(?=[^>]*(?:property|name)=["']${escapeRegExp(property)}["'])[^>]*content=["']([^"']+)["'][^>]*>`, 'i')
  const match = html.match(re)
  return match ? decodeHtml(match[1]) : null
}

function titleTag(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  return match ? decodeHtml(stripTags(match[1])).trim() : null
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sameUrlPath(a, b) {
  try {
    const aa = new URL(a)
    const bb = new URL(b)
    return aa.hostname === bb.hostname && aa.pathname.replace(/\/$/, '') === bb.pathname.replace(/\/$/, '')
  } catch {
    return false
  }
}

function canonicalSoundCloudTrackUrl(value) {
  if (!value) return null
  let url
  try {
    url = new URL(value, 'https://soundcloud.com')
  } catch {
    return null
  }

  if (url.hostname !== 'soundcloud.com' && url.hostname !== 'www.soundcloud.com') return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2) return null
  if (SKIP_SOUNDCLOUD_PATHS.has(parts[0])) return null
  if (parts[1].startsWith('sets/')) return null

  return `https://soundcloud.com/${parts[0]}/${parts[1]}`
}

function scoreCandidate(youtubeMeta, candidate) {
  const titleScore = textSimilarity(youtubeMeta.title, candidate.title)
  const creatorScore = textSimilarity(youtubeMeta.channel, candidate.user)
  const durationScore = durationSimilarity(youtubeMeta.durationSeconds, candidate.durationSeconds)
  const positionScore = Number.isFinite(candidate.bestPosition)
    ? clamp01(1 - ((candidate.bestPosition - 1) / 24))
    : 0.3

  const hasDuration = durationScore !== null
  let confidence
  if (hasDuration) {
    confidence =
      (durationScore * 0.50) +
      (titleScore * 0.36) +
      (creatorScore * 0.08) +
      (positionScore * 0.06)
  } else {
    confidence =
      (titleScore * 0.72) +
      (creatorScore * 0.18) +
      (positionScore * 0.10)
    confidence = Math.min(confidence, 0.72)
  }

  if (hasDuration && durationScore < 0.45) confidence = Math.min(confidence, 0.68)
  if (titleScore < 0.25 && creatorScore < 0.25) confidence = Math.min(confidence, hasDuration ? 0.64 : 0.38)
  if (!candidate.title && !candidate.durationSeconds) confidence = Math.min(confidence, 0.30)

  return {
    confidence: round(clamp01(confidence)),
    components: {
      title: round(titleScore),
      duration: durationScore === null ? null : round(durationScore),
      creator: round(creatorScore),
      searchPosition: round(positionScore),
    },
    reasons: buildReasons(youtubeMeta, candidate, {
      titleScore,
      creatorScore,
      durationScore,
      positionScore,
    }),
  }
}

function buildReasons(youtubeMeta, candidate, scores) {
  const reasons = []
  if (scores.durationScore !== null) {
    const diff = Math.abs(youtubeMeta.durationSeconds - candidate.durationSeconds)
    reasons.push(`${formatDurationDelta(diff)} duration delta`)
  } else {
    reasons.push('duration unavailable')
  }
  reasons.push(`${Math.round(scores.titleScore * 100)}% title similarity`)
  if (youtubeMeta.channel || candidate.user) {
    reasons.push(`${Math.round(scores.creatorScore * 100)}% uploader similarity`)
  }
  if (candidate.discoveredBy && candidate.discoveredBy.length) {
    reasons.push(`found via ${candidate.discoveredBy.join('+')}`)
  }
  return reasons
}

function textSimilarity(a, b) {
  const left = normalizeText(a)
  const right = normalizeText(b)
  if (!left || !right) return 0
  if (left === right) return 1

  const leftTokens = tokens(a)
  const rightTokens = tokens(b)
  const dice = tokenDice(leftTokens, rightTokens)
  const charScore = normalizedLevenshtein(left, right)
  const substringBonus = left.includes(right) || right.includes(left) ? 0.88 : 0

  return clamp01(Math.max(substringBonus, (dice * 0.68) + (charScore * 0.32)))
}

function tokenDice(a, b) {
  if (!a.length || !b.length) return 0
  const counts = new Map()
  for (const token of a) counts.set(token, (counts.get(token) || 0) + 1)

  let overlap = 0
  for (const token of b) {
    const count = counts.get(token) || 0
    if (count > 0) {
      overlap += 1
      counts.set(token, count - 1)
    }
  }

  return (2 * overlap) / (a.length + b.length)
}

function normalizedLevenshtein(a, b) {
  if (!a && !b) return 1
  if (!a || !b) return 0

  const maxLen = Math.max(a.length, b.length)
  const distance = levenshtein(a, b)
  return clamp01(1 - (distance / maxLen))
}

function levenshtein(a, b) {
  const prev = new Array(b.length + 1)
  const curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      )
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j]
  }

  return prev[b.length]
}

function durationSimilarity(a, b) {
  if (!a || !b) return null
  const diff = Math.abs(a - b)
  if (diff <= 2) return 1
  if (diff <= 10) return 0.96
  if (diff <= 30) return 0.86
  if (diff <= 60) return 0.72

  const tolerance = Math.max(300, a * 0.12)
  return clamp01(0.65 * (1 - (diff / tolerance)))
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return 'unknown'
  const rounded = Math.round(seconds)
  const hours = Math.floor(rounded / 3600)
  const minutes = Math.floor((rounded % 3600) / 60)
  const secs = rounded % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

function formatDurationDelta(seconds) {
  if (!Number.isFinite(seconds)) return 'unknown'
  return `${Math.round(seconds)}s`
}

function toSet79Url(soundCloudUrl) {
  const url = new URL(soundCloudUrl)
  return `https://set79.com/tracklist/soundcloud.com${url.pathname}`
}

function printTextReport(result) {
  const yt = result.youtube
  console.log('YouTube source')
  console.log(`  title:    ${yt.title || 'unknown'}`)
  console.log(`  channel:  ${yt.channel || 'unknown'}`)
  console.log(`  duration: ${formatDuration(yt.durationSeconds)}`)
  console.log(`  metadata: ${yt.source || 'unknown'}`)
  console.log('')

  if (!result.candidates.length) {
    console.log('No SoundCloud candidates found.')
    return
  }

  console.log('SoundCloud candidates')
  result.candidates.forEach((candidate, index) => {
    console.log(`${index + 1}. confidence ${candidate.confidence.toFixed(3)} - ${candidate.title || 'unknown title'}`)
    console.log(`   user:     ${candidate.user || 'unknown'}`)
    console.log(`   duration: ${formatDuration(candidate.durationSeconds)}`)
    console.log(`   url:      ${candidate.url}`)
    console.log(`   set79:    ${candidate.set79Url}`)
    console.log(`   scores:   title=${formatScore(candidate.components.title)} duration=${formatScore(candidate.components.duration)} uploader=${formatScore(candidate.components.creator)}`)
    console.log(`   why:      ${candidate.reasons.join('; ')}`)
    if (candidate.queries && candidate.queries.length) {
      console.log(`   query:    ${candidate.queries[0]}`)
    }
    console.log('')
  })
}

function formatScore(value) {
  return value === null || value === undefined ? 'n/a' : value.toFixed(3)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return
  }
  if (!args.youtubeUrl) {
    usage()
    process.exitCode = 1
    return
  }

  const youtube = await getYouTubeMeta(args.youtubeUrl, args)
  if (!youtube.title) {
    throw new Error('Could not resolve YouTube title; try checking the URL or installing yt-dlp.')
  }

  const candidates = await discoverSoundCloudCandidates(youtube, args)
  const ranked = candidates
    .map(candidate => {
      const score = scoreCandidate(youtube, candidate)
      return {
        ...candidate,
        ...score,
        durationSeconds: secondsOrNull(candidate.durationSeconds),
        set79Url: candidate.url ? toSet79Url(candidate.url) : null,
      }
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, args.limit)

  const result = { youtube, candidates: ranked }
  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    printTextReport(result)
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`)
  process.exitCode = 1
})
