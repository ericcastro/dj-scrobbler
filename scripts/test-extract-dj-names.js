#!/usr/bin/env node
/**
 * Test runner for extract-dj-names.js.
 *
 * 19 real DJ set URLs from the user's listening history, spanning 6 genres.
 * Expected DJ names were curated by Claude from the actual video titles.
 *
 * Usage: node scripts/test-extract-dj-names.js [--no-ytdlp] [--browser] [--debug]
 */

const { extractDjNamesFromUrl } = require('./extract-dj-names')

// Strip diacritics, lowercase, collapse whitespace — for fuzzy name comparison
function norm(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function namesMatch(actualDjs, expectedNames) {
  const actual = actualDjs.map(d => norm(d.name)).sort()
  const expected = expectedNames.map(norm).sort()
  return actual.length === expected.length && actual.every((n, i) => n === expected[i])
}

// ── Test cases ──────────────────────────────────────────────────────────────
//
// Genre          | YouTube ID   | Pattern      | Expected DJs
// ─────────────────────────────────────────────────────────────────────────────
// Techno         | ZntSKGNj0UY  | solo         | KUKO
// Schranz        | irI8ka6wqt0  | solo         | Cloudy
// Techno         | EgnAqsOU0ak  | solo @       | Cloudy
// Schranz        | iv9pfKw7Cas  | f2f          | CLOUDY, KUKO
// Schranz        | wO6DWfLwmtQ  | f2f          | CLOUDY, NIKOLINA
// Techno         | XrCLyO45AuE  | triple b2b   | ADRIÁN MILLS, CLOUDY, KUKO
// Techno         | Q5brz-L49PU  | solo         | NIKOLINA
// Techno         | z-8JELUcjMM  | solo (dash)  | I Hate Models
// Progressive    | Easqg4SUl2Q  | solo (at)    | Hernán Cattáneo
// Progressive    | wbU9P2DcKFs  | solo         | Sasha
// Progressive    | bgCSattouu8  | & duo        | Sasha, John Digweed
// Progressive    | OV-psKWWqGI  | / duo        | Sasha, John Digweed
// Techno         | 6yh2-IiuPNU  | solo         | Bart Skils
// Melodic Techno | D0MgHnTcYKc  | solo WE2     | Anyma
// Melodic        | hun1HqorhXc  | solo @       | Korolova
// House          | j6QqIbRPQ34  | b2b          | Marlon Hoffstadt, Malugi
// Electronic     | xTvkAzPVH2U  | b2b          | Wata Igarashi, Kangding Ray
// Festival       | Kk30nAVQr1M  | solo @       | The Chemical Brothers
// Techno         | Rm2I3OUw6Bs  | slash in name| KI/KI

const TEST_CASES = [
  // ── Techno / Schranz ──────────────────────────────────────────────────────
  { id: 'ZntSKGNj0UY', genre: 'Techno',         pattern: 'solo',          expected: ['KUKO'] },
  { id: 'irI8ka6wqt0', genre: 'Schranz',        pattern: 'solo',          expected: ['Cloudy'] },
  { id: 'EgnAqsOU0ak', genre: 'Techno',         pattern: 'solo @',        expected: ['Cloudy'] },
  { id: 'iv9pfKw7Cas', genre: 'Schranz',        pattern: 'f2f',           expected: ['CLOUDY', 'KUKO'] },
  { id: 'wO6DWfLwmtQ', genre: 'Schranz',        pattern: 'f2f',           expected: ['CLOUDY', 'NIKOLINA'] },
  { id: 'XrCLyO45AuE', genre: 'Techno',         pattern: 'triple b2b',    expected: ['ADRIÁN MILLS', 'CLOUDY', 'KUKO'] },
  { id: 'Q5brz-L49PU', genre: 'Techno',         pattern: 'solo',          expected: ['NIKOLINA'] },
  { id: 'z-8JELUcjMM', genre: 'Techno',         pattern: 'solo (dash)',   expected: ['I Hate Models'] },
  // ── Progressive / Trance ─────────────────────────────────────────────────
  { id: 'Easqg4SUl2Q', genre: 'Progressive',    pattern: 'solo (at)',     expected: ['Hernán Cattáneo'] },
  { id: 'wbU9P2DcKFs', genre: 'Progressive',    pattern: 'solo',          expected: ['Sasha'] },
  { id: 'bgCSattouu8', genre: 'Progressive',    pattern: '& duo',         expected: ['Sasha', 'John Digweed'] },
  { id: 'OV-psKWWqGI', genre: 'Progressive',    pattern: '/ duo',         expected: ['Sasha', 'John Digweed'] },
  // ── Melodic Techno / Progressive House ───────────────────────────────────
  { id: '6yh2-IiuPNU', genre: 'Techno',         pattern: 'solo',          expected: ['Bart Skils'] },
  { id: 'D0MgHnTcYKc', genre: 'Melodic Techno', pattern: 'solo (WE2)',    expected: ['Anyma'] },
  { id: 'hun1HqorhXc', genre: 'Melodic',        pattern: 'solo @',        expected: ['Korolova'] },
  // ── House / Tech-House ────────────────────────────────────────────────────
  { id: 'j6QqIbRPQ34', genre: 'House',          pattern: 'b2b',           expected: ['Marlon Hoffstadt', 'Malugi'] },
  // ── Electronic / Industrial ───────────────────────────────────────────────
  { id: 'xTvkAzPVH2U', genre: 'Electronic',     pattern: 'b2b',           expected: ['Wata Igarashi', 'Kangding Ray'] },
  // ── Festival / Big Room ───────────────────────────────────────────────────
  { id: 'Kk30nAVQr1M', genre: 'Festival',       pattern: 'solo @',        expected: ['The Chemical Brothers'] },
  // ── Techno (slash in artist name) ─────────────────────────────────────────
  { id: 'Rm2I3OUw6Bs', genre: 'Techno',         pattern: 'slash in name', expected: ['KI/KI'] },
]

async function runTests(opts) {
  let passed = 0
  let failed = 0
  const failures = []

  for (const tc of TEST_CASES) {
    const url = `https://www.youtube.com/watch?v=${tc.id}`
    const label = `[${tc.genre.padEnd(14)}] ${tc.id}  (${tc.pattern})`
    process.stdout.write(`  ${label.padEnd(58)} ... `)

    try {
      const result = await extractDjNamesFromUrl(url, opts)
      if (namesMatch(result.djs, tc.expected)) {
        passed++
        console.log('PASS')
      } else {
        failed++
        console.log('FAIL')
        failures.push({
          id: tc.id,
          pattern: tc.pattern,
          title: result.title,
          expected: tc.expected,
          actual: result.djs.map(d => d.name),
        })
      }
    } catch (err) {
      failed++
      console.log(`FAIL  (error: ${err.message})`)
      failures.push({ id: tc.id, pattern: tc.pattern, expected: tc.expected, actual: [], error: err.message })
    }
  }

  const total = TEST_CASES.length
  console.log(`\n${passed}/${total} passed`)

  if (failures.length > 0) {
    console.log('\nFailures:')
    for (const f of failures) {
      console.log(`  ${f.id}  (${f.pattern})`)
      if (f.title) console.log(`    title:    "${f.title}"`)
      console.log(`    expected: ${JSON.stringify(f.expected)}`)
      console.log(`    actual:   ${JSON.stringify(f.actual)}`)
      if (f.error) console.log(`    error:    ${f.error}`)
    }
  }

  return failed === 0
}

async function main() {
  const argv = process.argv.slice(2)
  const opts = {
    ytdlp:   !argv.includes('--no-ytdlp'),
    browser:  argv.includes('--browser'),
    json:     false,
    debug:    argv.includes('--debug'),
  }

  const metaDesc = opts.ytdlp
    ? 'yt-dlp (preferred) → page parse → oEmbed'
    : 'page parse → oEmbed'

  console.log(`DJ name extraction — ${TEST_CASES.length} test cases across 6 genres`)
  console.log(`Metadata: ${metaDesc}`)
  if (opts.browser) console.log('Playwright enabled for description fallback')
  console.log()

  const ok = await runTests(opts)
  process.exit(ok ? 0 : 1)
}

main().catch(err => { console.error(err.message); process.exit(1) })
