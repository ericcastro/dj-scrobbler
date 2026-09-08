#!/usr/bin/env node
/**
 * POC: extract DJ name(s) from a YouTube DJ set URL.
 * No LLM — pure heuristic title parsing with optional yt-dlp / Playwright.
 *
 * Usage: node scripts/extract-dj-names.js <youtube-url> [options]
 *   --browser     Load page with Playwright to scrape description (fallback)
 *   --no-ytdlp    Skip yt-dlp
 *   --json        Machine-readable JSON output
 *   --debug       Extra diagnostics to stderr
 */

const { spawn } = require('child_process')

const FETCH_TIMEOUT_MS = 15000
const USER_AGENT = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  'AppleWebKit/537.36 (KHTML, like Gecko)',
  'Chrome/124.0.0.0 Safari/537.36',
].join(' ')

// ──────────────────────── utilities ────────────────────────

function canonicalYouTubeUrl(input) {
  const url = new URL(input)
  let videoId = null
  if (url.hostname === 'youtu.be') {
    videoId = url.pathname.split('/').filter(Boolean)[0]
  } else if (url.hostname.endsWith('youtube.com')) {
    if (url.pathname === '/watch') videoId = url.searchParams.get('v')
    else if (url.pathname.startsWith('/shorts/')) videoId = url.pathname.split('/').filter(Boolean)[1]
    else if (url.pathname.startsWith('/embed/')) videoId = url.pathname.split('/').filter(Boolean)[1]
  }
  if (!videoId) throw new Error(`Not a supported YouTube URL: ${input}`)
  return { videoId, url: `https://www.youtube.com/watch?v=${videoId}` }
}

async function fetchText(url, extraHeaders = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': USER_AGENT,
        ...extraHeaders,
      },
    })
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status })
    return res.text()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson(url) {
  const text = await fetchText(url, { Accept: 'application/json' })
  return JSON.parse(text)
}

function spawnJson(cmd, args, timeoutMs = 30000) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = []
    const timer = setTimeout(() => { child.kill('SIGTERM'); resolve(null) }, timeoutMs)
    child.stdout.on('data', c => chunks.push(c))
    child.on('error', () => { clearTimeout(timer); resolve(null) })
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0) return resolve(null)
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { resolve(null) }
    })
  })
}

function parseBalancedJson(text, start) {
  if (start < 0 || text[start] !== '{') return null
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (esc) { esc = false; continue }
    if (c === '\\') { esc = true; continue }
    if (c === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (c === '{') depth++
    else if (c === '}') {
      if (--depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

function extractYtPlayerResponse(html) {
  for (const needle of ['var ytInitialPlayerResponse =', 'ytInitialPlayerResponse =']) {
    const idx = html.indexOf(needle)
    if (idx >= 0) {
      const parsed = parseBalancedJson(html, html.indexOf('{', idx + needle.length))
      if (parsed) return parsed
    }
  }
  return null
}

// ──────────────────────── metadata fetching ────────────────────────

async function metaViaYtDlp(url) {
  const data = await spawnJson('yt-dlp', ['--dump-single-json', '--skip-download', '--no-warnings', url])
  if (!data?.title) return null
  return {
    title: data.title ?? null,
    channel: data.channel ?? data.uploader ?? null,
    description: data.description ?? null,
    tags: Array.isArray(data.tags) ? data.tags : [],
    videoId: data.id ?? null,
    source: 'yt-dlp',
  }
}

async function metaViaPage(url) {
  const { videoId, url: canonical } = canonicalYouTubeUrl(url)
  const meta = { title: null, channel: null, description: null, tags: [], videoId, source: 'youtube-page' }
  try {
    const html = await fetchText(canonical)
    const player = extractYtPlayerResponse(html)
    const vd = player?.videoDetails
    if (vd) {
      meta.title = vd.title ?? null
      meta.channel = vd.author ?? null
      meta.description = vd.shortDescription ?? null
    }
    const mf = player?.microformat?.playerMicroformatRenderer
    if (mf) {
      if (!meta.title) meta.title = mf.title?.simpleText ?? null
      if (!meta.channel) meta.channel = mf.ownerChannelName ?? null
    }
  } catch { meta.source = 'youtube-oembed' }

  if (!meta.title) {
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`
      const o = await fetchJson(oembedUrl)
      if (!meta.title) meta.title = o.title ?? null
      if (!meta.channel) meta.channel = o.author_name ?? null
      meta.source = 'youtube-oembed'
    } catch {}
  }
  return meta
}

async function metaViaPlaywright(url) {
  let pw
  try { pw = require('playwright') } catch { return null }
  const browser = await pw.chromium.launch({ headless: true })
  const page = await browser.newPage()
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    // Expand description if collapsed
    await page.locator('#expand').click({ timeout: 3000 }).catch(() => {})
    const title = await page.locator('h1.ytd-watch-metadata').first().textContent({ timeout: 5000 }).catch(() => null)
    const description = await page.locator('#description-inner').textContent({ timeout: 3000 }).catch(() =>
      page.locator('#description').textContent({ timeout: 3000 }).catch(() => null)
    )
    const channel = await page.locator('#channel-name').first().textContent({ timeout: 3000 }).catch(() => null)
    return {
      title: title?.trim() ?? null,
      channel: channel?.trim() ?? null,
      description: description?.trim() ?? null,
      tags: [],
      videoId: canonicalYouTubeUrl(url).videoId,
      source: 'playwright',
    }
  } finally {
    await browser.close()
  }
}

async function getYouTubeMeta(url, opts) {
  if (opts.ytdlp !== false) {
    const m = await metaViaYtDlp(url)
    if (m?.title) return m
  }
  const m = await metaViaPage(url)
  if (opts.browser && !m.description) {
    const pw = await metaViaPlaywright(url)
    if (pw?.description) m.description = pw.description
    if (pw?.title && !m.title) { m.title = pw.title; m.source = 'playwright' }
  }
  return m
}

// ──────────────────────── DJ extraction ────────────────────────

// Find the index where the "name region" ends — everything before the first
// context separator (venue, event name, other non-DJ info).
function findNameRegionEnd(title) {
  const checks = [
    /[|│]/,                    // pipe variants — most common
    / I (?=[A-Z])/,            // lone uppercase I used as separator: "b2b KUKO I UNREAL"
    / - /,                     // spaced dash
    / @ /,                     // at-sign: "DJ NAME @ VENUE"
    /\[/,                      // opening bracket: "DJ NAME [Event 2024]"
    / at (?=[A-Z])/,           // "at Venue": "Cattáneo at Cercle"
  ]
  let end = title.length
  for (const re of checks) {
    const m = re.exec(title)
    if (m && m.index < end) end = m.index
  }
  return end
}

// Ordered by specificity; first match wins for multi-DJ split
const MULTI_DJ_PATTERNS = [
  { re: /\s+b2b\s+/i,          rel: 'b2b' },
  { re: /\s+f2f\s+/i,          rel: 'f2f' },
  { re: /\s+back to back\s+/i, rel: 'b2b' },
  { re: /\s+face to face\s+/i, rel: 'f2f' },
  { re: /\s+&\s+/,             rel: 'and' },
  { re: / \/ /,                rel: 'and' },   // spaced slash: "Sasha / John Digweed"
  { re: /\s+feat\.?\s+/i,      rel: 'feat' },
  { re: /\s+ft\.?\s+/i,        rel: 'feat' },
  { re: /\s+vs\.?\s+/i,        rel: 'vs' },
]

// Terminal tokens like "WE2", "ST1" that indicate Tomorrowland weekend / stage,
// not part of the artist name.
const EDITION_SUFFIX_RE = /\s+[A-Z]{1,4}\d+$/

const LEADING_NOISE_RE = /^(dj|live|official)\s+/i
const TRAILING_NOISE_RE = /\s+(\(?(full set|full concert|full show|live set|hd|hq|4k)\)?|\b\d{4}\b)$/i

function cleanSegment(s) {
  s = s.trim()
  s = s.replace(LEADING_NOISE_RE, '')
  s = s.replace(EDITION_SUFFIX_RE, '')   // strip trailing "WE2", "ST1" etc.
  s = s.replace(TRAILING_NOISE_RE, '')
  return s.trim()
}

function extractDjsFromTitle(title) {
  const regionEnd = findNameRegionEnd(title)
  const region = title.slice(0, regionEnd).trim()

  for (const { re, rel } of MULTI_DJ_PATTERNS) {
    const parts = region.split(re)
    if (parts.length > 1) {
      const names = parts.map(cleanSegment).filter(n => n.length > 0)
      if (names.length > 1) return names.map(name => ({ name, relationship: rel }))
    }
  }

  const name = cleanSegment(region)
  return name ? [{ name }] : []
}

// Bonus: flag DJs whose names also appear in the yt-dlp description
function augmentFromDescription(djs, description) {
  if (!description) return djs
  const lower = description.toLowerCase()
  return djs.map(d =>
    lower.includes(d.name.toLowerCase()) ? { ...d, descriptionMatch: true } : d
  )
}

// ──────────────────────── public API ────────────────────────

async function extractDjNamesFromUrl(url, opts = {}) {
  const meta = await getYouTubeMeta(url, opts)
  if (opts.debug) {
    process.stderr.write(`[debug] title="${meta.title}" channel="${meta.channel}" source=${meta.source}\n`)
  }

  const result = {
    url: meta.videoId ? `https://www.youtube.com/watch?v=${meta.videoId}` : url,
    title: meta.title ?? null,
    channel: meta.channel ?? null,
    metaSource: meta.source,
    djs: [],
  }

  if (!meta.title) return result

  result.djs = extractDjsFromTitle(meta.title)
  result.djs = augmentFromDescription(result.djs, meta.description)
  return result
}

module.exports = { extractDjNamesFromUrl, extractDjsFromTitle }

// ──────────────────────── CLI ────────────────────────

function parseArgs(argv) {
  const opts = { browser: false, ytdlp: true, json: false, debug: false, url: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') opts.help = true
    else if (a === '--browser') opts.browser = true
    else if (a === '--no-ytdlp') opts.ytdlp = false
    else if (a === '--json') opts.json = true
    else if (a === '--debug') opts.debug = true
    else if (!opts.url && !a.startsWith('-')) opts.url = a
  }
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help || !opts.url) {
    console.log([
      'Usage: node scripts/extract-dj-names.js <youtube-url> [options]',
      '',
      'Options:',
      '  --browser     Load page with Playwright to scrape description (fallback)',
      '  --no-ytdlp    Skip yt-dlp',
      '  --json        Machine-readable JSON output',
      '  --debug       Extra diagnostics to stderr',
    ].join('\n'))
    process.exit(1)
  }

  const result = await extractDjNamesFromUrl(opts.url, opts)

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  console.log(`Title:  ${result.title ?? '(unknown)'}`)
  console.log(`Source: ${result.metaSource}`)
  if (result.djs.length === 0) {
    console.log('DJs:    (none found)')
  } else {
    const labels = result.djs.map(d => {
      const suffix = d.relationship ? ` [${d.relationship}]` : ''
      const desc = d.descriptionMatch ? ' ✓' : ''
      return `${d.name}${suffix}${desc}`
    })
    console.log(`DJs:    ${labels.join(', ')}`)
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err.message); process.exit(1) })
}
