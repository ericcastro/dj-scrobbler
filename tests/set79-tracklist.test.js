const test = require('node:test')
const assert = require('node:assert/strict')

const set79 = require('../plugins/tracklists/set79')
const plugins = require('../plugins')

test('set79 constructs a tracklist URL from a SoundCloud path', async () => {
  const results = await set79.findTracklists({
    url: 'https://soundcloud.com/artist-name/set-title?si=ignored',
  })

  assert.deepEqual(results, [{
    url: 'https://set79.com/tracklist/soundcloud.com/artist-name/set-title',
    title: '',
  }])
})

test('set79 recognizes its own tracklist URLs', () => {
  assert.equal(set79.matchUrl('https://set79.com/tracklist/soundcloud.com/foo/bar'), true)
  assert.equal(set79.matchUrl('https://soundcloud.com/foo/bar'), false)
})

// ── Identity handling ─────────────────────────────────────────────────────────

test('set79 identities accept only two-segment SoundCloud track paths', () => {
  const { normaliseIdentity } = set79._test

  assert.equal(normaliseIdentity('soundcloud.com/artist/track'), 'soundcloud.com/artist/track')
  assert.equal(normaliseIdentity('/soundcloud.com/artist/track'), 'soundcloud.com/artist/track')
  assert.equal(normaliseIdentity('https://soundcloud.com/artist/track/'), 'soundcloud.com/artist/track')

  assert.equal(normaliseIdentity('soundcloud.com/artist'), null, 'profile URL is not a set')
  assert.equal(normaliseIdentity('soundcloud.com/artist/sets/name'), null, 'playlist is not a set')
  assert.equal(normaliseIdentity('mixcloud.com/artist/track'), null)
  assert.equal(normaliseIdentity(null), null)
})

test('only SoundCloud URLs short-circuit to a directly constructed tracklist', () => {
  const { soundcloudIdentity } = set79._test

  assert.equal(soundcloudIdentity('https://soundcloud.com/a/b'), 'soundcloud.com/a/b')
  assert.equal(soundcloudIdentity('https://m.soundcloud.com/a/b'), 'soundcloud.com/a/b')
  assert.equal(soundcloudIdentity('https://www.youtube.com/watch?v=abcdefghijk'), null)
  assert.equal(soundcloudIdentity('not a url'), null)
})

// ── Search queries ────────────────────────────────────────────────────────────

test('search tries the raw title first, then a de-noised variant', () => {
  const queries = set79._test.searchQueries({
    title: 'Ben Böhmer live above Cappadocia in Turkey for Cercle [4K]',
  })

  assert.equal(queries[0], 'Ben Böhmer live above Cappadocia in Turkey for Cercle [4K]')
  assert.equal(queries[1], 'Ben Böhmer live above Cappadocia in Turkey for Cercle')
})

test('a separator the indexed title lacks does not cost the match', () => {
  // Regression: set79 returns *zero* results for the raw title here — the "|"
  // is enough to sink it even though every word matches the indexed
  // "CLOUDY @ HIVE Festival 2026 TECHNO CASTLE - cloudy.mp3 (64k).mp3".
  const queries = set79._test.searchQueries({
    title: 'CLOUDY @ HIVE Festival 2026 | TECHNO CASTLE',
  })

  assert.ok(queries.includes('CLOUDY HIVE Festival 2026 TECHNO CASTLE'),
    `flattened query missing from ladder: ${JSON.stringify(queries)}`)
})

test('flattening drops separators but keeps hyphenated names intact', () => {
  const { flattenTitle } = set79._test
  assert.equal(flattenTitle('CLOUDY @ HIVE Festival 2026 | TECHNO CASTLE'),
    'CLOUDY HIVE Festival 2026 TECHNO CASTLE')
  assert.equal(flattenTitle('Fatboy Slim - All Night Long - Pacha Ibiza'),
    'Fatboy Slim All Night Long Pacha Ibiza')
  assert.equal(flattenTitle('Frieder & Jakob @ The Brooklyn Mirage'),
    'Frieder Jakob The Brooklyn Mirage')
  assert.equal(flattenTitle('Gravel Pit - Wu-Tang Clan'), 'Gravel Pit Wu-Tang Clan')
})

test('a title that needs no cleanup still gets a flattened rung', () => {
  assert.deepEqual(set79._test.searchQueries({ title: 'Fatboy Slim - Pacha Ibiza' }),
    ['Fatboy Slim - Pacha Ibiza', 'Fatboy Slim Pacha Ibiza'])
})

test('a title with nothing to flatten produces a single query', () => {
  assert.deepEqual(set79._test.searchQueries({ title: 'Cercle Ben Bohmer Cappadocia' }),
    ['Cercle Ben Bohmer Cappadocia'])
})

test('search is skipped entirely when the source has no title', () => {
  assert.deepEqual(set79._test.searchQueries({ title: '' }), [])
  assert.deepEqual(set79._test.searchQueries({}), [])
})

test('title de-noising keeps the identifying words', () => {
  const { simplifyTitle } = set79._test
  assert.equal(simplifyTitle('Solomun @ Boiler Room [Official Video] 4K'), 'Solomun @ Boiler Room')
  assert.equal(simplifyTitle('Artist - Set (Official Video)'), 'Artist - Set')
})

// ── Session bootstrap ─────────────────────────────────────────────────────────

test('the CSRF token is read from page markup, and from the session cookie as a fallback', () => {
  const { csrfTokenFromHtml, csrfTokenFromCookie } = set79._test

  assert.equal(
    csrfTokenFromHtml('<input type="hidden" name="csrf_token" value="abc123">'),
    'abc123'
  )
  assert.equal(csrfTokenFromHtml('<form></form>'), null)

  // Flask signs the session as <base64 payload>.<timestamp>.<signature>
  const payload = Buffer.from(JSON.stringify({ csrf_token: 'def456' })).toString('base64')
  assert.equal(csrfTokenFromCookie(`set79_session=${payload}.apatcA.sig`), 'def456')
  assert.equal(csrfTokenFromCookie('set79_session=not-base64'), null)
})

test('every query rung is searched, so one bad rung cannot hide the match', () => {
  // findTracklists must not stop at the first non-empty rung: the raw title can
  // return a single wrong set while the flattened rung holds the right one.
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../plugins/tracklists/set79.js'), 'utf8')
  const fn = src.slice(src.indexOf('async findTracklists'))
  assert.equal(/break/.test(fn.slice(0, 600)), false, 'findTracklists still breaks out of the query ladder')
})

// ── Tracklist extraction ──────────────────────────────────────────────────────

test('the extract script reads set79\'s server-rendered track rows', () => {
  const script = set79._test.TRACKLIST_EXTRACT_SCRIPT

  assert.match(script, /querySelectorAll\('tr\.track-row'\)/)
  assert.match(script, /data-track-start/)
  assert.match(script, /data-track-name/)
  // set79 names read "Title - Artist" — the reverse of 1001Tracklists
  assert.match(script, /lastIndexOf\(' - '\)/)
  assert.match(script, /const title\s*=\s*dashIdx > 0 \? raw\.slice\(0, dashIdx\)/)
  assert.match(script, /const artist\s*=\s*dashIdx > 0 \? raw\.slice\(dashIdx \+ 3\)/)
  // Fields the app-owned timeline needs to seek and highlight
  for (const field of ['providerTrackId', 'trackNum', 'cueSeconds', 'cueDisplay', 'hasTimestamp', 'noTimestamp']) {
    assert.match(script, new RegExp(`\\b${field}\\b`), `${field} missing from extract script`)
  }
})

// ── Registry wiring ───────────────────────────────────────────────────────────

test('set79 is registered as an alternate for YouTube, never the primary', () => {
  assert.equal(plugins.tracklistForSource('youtube').id, '1001tracklists')
  assert.deepEqual(
    plugins.alternateTracklistsForSource('youtube').map(p => p.id),
    ['set79']
  )
  assert.equal(plugins.tracklistById('set79'), set79)
})

test('an alternate is not offered twice for the same set', () => {
  assert.deepEqual(
    plugins.alternateTracklistsForSource('youtube', { exclude: ['set79'] }),
    []
  )
})

test('set79 raises the match bar because it matches on title alone', () => {
  // 1001Tracklists confirms by embedded video ID, so any positive score is safe;
  // set79 matches by title search and needs a real resemblance.
  assert.equal(typeof set79.minMatchScore, 'number')
  assert.ok(set79.minMatchScore > 1)
  assert.equal(plugins.tracklistForSource('youtube').minMatchScore, undefined)
})

test('set79 supplies the copy the no-tracklist panel offers it with', () => {
  assert.equal(set79.alternateInfo.prompt, 'You can also try fetching a tracklist from set79.com')
  assert.equal(set79.alternateInfo.label, 'Try set79.com instead (experimental)')
  assert.ok(set79.alternateInfo.note)
  assert.equal(set79.experimental, true)
})
