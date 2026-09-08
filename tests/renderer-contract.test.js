const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
// Normalise CRLF: Windows checks the repo out with it and multi-line regexes
// below would silently stop matching in CI.
const readSource = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')

const appJs = readSource('renderer/app.js')
const preloadJs = readSource('preload.js')
const indexHtml = readSource('renderer/index.html')
const styleCss = readSource('renderer/style.css')

test('renderer app references only DOM IDs that exist in index.html', () => {
  const ids = [...appJs.matchAll(/document\.getElementById\('([^']+)'\)/g)]
    .map(match => match[1])
  const missing = ids.filter(id => !indexHtml.includes(`id="${id}"`))

  assert.deepEqual(missing, [])
})

test('critical player controls have matching markup and styles', () => {
  for (const id of [
    'player-status-overlay',
    'volume-control',
    'volume-slider',
    'np-track-text',
    'np-artwork',
    'np-artwork-image',
    'search-dropdown',
    'update-dialog',
  ]) {
    assert.equal(indexHtml.includes(`id="${id}"`), true, `${id} missing from index.html`)
  }

  for (const selector of [
    '#player-status-overlay',
    '#volume-control',
    '#volume-popover',
    '#np-track-text',
    '#np-artwork',
    '#np-artwork-image',
    '#search-dropdown',
    '#update-dialog',
  ]) {
    assert.equal(styleCss.includes(selector), true, `${selector} missing from style.css`)
  }
})

test('CSS custom properties are defined or supplied by renderer code', () => {
  const definitions = new Set([...styleCss.matchAll(/--([\w-]+)\s*:/g)].map(match => match[1]))
  const references = new Set([...styleCss.matchAll(/var\(--([\w-]+)/g)].map(match => match[1]))
  const rendererSupplied = new Set(['marquee-dist', 'scroll-fade-size'])
  const missing = [...references].filter(name => !definitions.has(name) && !rendererSupplied.has(name))

  assert.deepEqual(missing, [])
})

test('search autocomplete uses row-level suggestion selection', () => {
  assert.match(appJs, /searchDropdown\.addEventListener\('mousedown'/)
  assert.match(appJs, /closest\('\.search-dropdown-item'\)/)
  assert.match(styleCss, /\.search-dropdown-item\s*\{[^}]*width:\s*100%/s)
})

test('keyboard player shortcuts preview on keydown and commit on keyup', () => {
  assert.match(appJs, /document\.addEventListener\('keydown',\s*handlePlayerShortcutKeydown\)/)
  assert.match(appJs, /document\.addEventListener\('keyup',\s*handlePlayerShortcutKeyup\)/)
  assert.match(appJs, /previewRelativeSeek\(-5\)/)
  assert.match(appJs, /commitKeyboardSeek\(\)/)
})

test('listening totals have one owner and reach the renderer as snapshots', () => {
  assert.match(preloadJs, /'stats-updated'/)
  assert.match(appJs, /window\.api\.on\('stats-updated', \(stats\) =>/)
  assert.doesNotMatch(preloadJs, /setStats:/)
  assert.doesNotMatch(appJs, /state\.stats\.totalListenedSeconds\s*=/)
  assert.doesNotMatch(appJs, /state\.stats\.totalTracksListened\s*=/)
})

test('sidebar panel state is persisted by switchSidebarPanel but not by applySidebarPanel', () => {
  // switchSidebarPanel must write activeSidebarPanel and call persist()
  assert.match(appJs, /function switchSidebarPanel\(name\)/)
  assert.match(appJs, /state\.store\.settings\.activeSidebarPanel = name/)
  assert.match(appJs, /function applySidebarPanel\(name\)/)

  // Extract each function body by slicing between function declarations
  function extractFn(src, name) {
    const start = src.indexOf(`function ${name}(`)
    if (start === -1) return ''
    const next = src.indexOf('\nfunction ', start + 1)
    return next === -1 ? src.slice(start) : src.slice(start, next)
  }

  const applyFn = extractFn(appJs, 'applySidebarPanel')
  assert.equal(applyFn.includes('persist()'), false, 'applySidebarPanel must not call persist()')

  const switchFn = extractFn(appJs, 'switchSidebarPanel')
  assert.equal(switchFn.includes('persist()'), true, 'switchSidebarPanel must call persist()')
})

test('sidebar panel is restored on init using applySidebarPanel, not switchSidebarPanel', () => {
  // The init restore must read activeSidebarPanel from settings and call applySidebarPanel
  assert.match(appJs, /settings\?\.activeSidebarPanel/)
  assert.match(appJs, /if \(activePanel\) applySidebarPanel\(activePanel\)/)
})

test('sidebar panel collapse persists null to clear the active panel', () => {
  // Both the second-click toggle and the collapse button must clear activeSidebarPanel
  const nullAssignments = [...appJs.matchAll(/activeSidebarPanel\s*=\s*null/g)]
  assert.ok(nullAssignments.length >= 2, 'activeSidebarPanel should be set to null in at least two places (toggle + collapse btn)')
})

test('Library is a full-workspace view grouped by normalized favorite DJ tags', () => {
  assert.equal(indexHtml.includes('id="btn-view-library"'), true)
  assert.equal(indexHtml.includes('id="library-screen"'), true)
  assert.equal(indexHtml.includes('id="panel-library"'), false)
  assert.equal(indexHtml.includes('id="dj-library-grid"'), true)
  assert.equal(indexHtml.includes('id="library-empty"'), true)
  assert.match(appJs, /btnViewLibrary\.addEventListener\('click'/)
  assert.match(appJs, /function showLibrary\(\)/)
  assert.match(appJs, /function favoriteDjLibrary\(\)/)
  assert.match(appJs, /state\.store\.favorites\.forEach\(set =>/)
  assert.match(appJs, /normalizedDjNames\(set\.djNames\)/)
  assert.match(appJs, /dj\.sets\.length} saved set/)
  assert.match(styleCss, /#library-screen\s*\{[^}]*position:\s*absolute/s)
  assert.match(styleCss, /\.dj-library-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill,/s)
})

test('DJ covers are stable random picks that prefer solo-set artwork', () => {
  assert.match(appJs, /soloSets: \[\]/)
  assert.match(appJs, /setDjNames\.length === 1/)
  assert.match(appJs, /const preferredSets = dj\.soloSets\.some\(set => set\.thumbnailUrl\) \? dj\.soloSets : dj\.sets/)
  assert.match(appJs, /Math\.floor\(Math\.random\(\) \* candidates\.length\)/)
  assert.match(appJs, /djLibraryCoverChoices\.get\(dj\.key\)/)
  assert.doesNotMatch(appJs, /startDjLibrarySlideshow|slideshow\.image\.animate/)
  assert.match(styleCss, /\.dj-library-thumb-frame\s*\{[^}]*aspect-ratio:\s*16 \/ 9/s)
})

test('Library filters DJs and drills into large favorite set cards', () => {
  assert.equal(indexHtml.includes('id="library-search-input"'), true)
  assert.equal(indexHtml.includes('id="library-dj-detail"'), true)
  assert.equal(indexHtml.includes('id="btn-library-back"'), true)
  assert.match(appJs, /librarySearchInput\.addEventListener\('input', renderDjLibrary\)/)
  assert.match(appJs, /allDjs\.filter\(dj => librarySearchKey\(dj\.name\)\.includes\(query\)\)/)
  assert.match(appJs, /function showDjLibraryDetail\(dj\)/)
  assert.match(appJs, /className = 'library-set-card'/)
  assert.match(appJs, /card\.addEventListener\('click', \(\) => \{[\s\S]*openStoredSet\(item\)/)
  assert.match(styleCss, /#library-dj-sets\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill, minmax\(220px, 1fr\)\)/s)
  assert.match(styleCss, /\.library-set-card\s*\{[^}]*width:\s*100%[^}]*opacity:\s*\.82/s)
  const cardFn = appJs.slice(appJs.indexOf('function renderLibrarySetCard'), appJs.indexOf('function showDjLibraryDetail'))
  assert.doesNotMatch(cardFn, /intro-resume-/)
  for (const className of ['library-set-thumb', 'library-set-title-row', 'library-set-title-text', 'library-set-progress']) {
    assert.match(cardFn, new RegExp(className))
    assert.match(styleCss, new RegExp(`\\.${className}\\s*\\{`))
  }
})

test('Library supports persisted grid and alphabetical list browsing', () => {
  assert.equal(indexHtml.includes('data-library-view="grid"'), true)
  assert.equal(indexHtml.includes('data-library-view="list"'), true)
  assert.match(appJs, /settings\?\.libraryViewMode \|\| 'grid'/)
  assert.match(appJs, /state\.store\.settings\.libraryViewMode = libraryViewMode/)
  assert.match(appJs, /function libraryInitial\(name\)/)
  assert.match(appJs, /heading\.className = 'dj-library-letter'/)
  assert.match(appJs, /djLibraryGrid\.className = `dj-library-grid is-\$\{libraryViewMode\}`/)
  assert.match(styleCss, /\.dj-library-grid\.is-list\s*\{[^}]*display:\s*block/s)
  assert.match(styleCss, /\.dj-library-letter\s*\{/)
})

test('DJ grid cards use the larger Home card interaction language', () => {
  assert.match(styleCss, /\.dj-library-grid\s*\{[^}]*minmax\(220px, 1fr\)/s)
  assert.match(styleCss, /\.dj-library-card\s*\{[^}]*border:\s*1px solid var\(--border\)[^}]*opacity:\s*\.82/s)
  assert.match(styleCss, /\.dj-library-card:hover,[\s\S]*border-color:\s*var\(--accent\)[^}]*opacity:\s*1/)
  assert.match(styleCss, /\.dj-library-name\s*\{[^}]*font-size:\s*16px/s)
  const cardRule = styleCss.slice(styleCss.indexOf('.dj-library-card {'), styleCss.indexOf('.dj-library-card:hover'))
  assert.equal(cardRule.includes('transform:'), false)
})

test('Library cards are near-opaque without changing Home card restraint', () => {
  assert.match(styleCss, /\.intro-resume-item\s*\{[^}]*opacity:\s*0\.4/s)
  assert.match(styleCss, /\.dj-library-card\s*\{[^}]*opacity:\s*\.82/s)
  assert.match(styleCss, /\.library-set-card\s*\{[^}]*opacity:\s*\.82/s)
  assert.match(styleCss, /\.library-set-card:hover,[\s\S]*opacity:\s*1/)
})

test('mini player shows current track artwork and follows background enrichment', () => {
  assert.match(indexHtml, /id="np-artwork"[\s\S]*id="np-artwork-image"/)
  assert.match(appJs, /function setNpArtwork\(artUrl, artworkStatus = 'missing'\)/)
  assert.match(appJs, /setNpArtwork\(data\.isId \? null : data\.artUrl/)
  assert.match(appJs, /document\.body\.classList\.contains\('has-active-set'\)/)
  assert.match(appJs, /npArtwork\.classList\.toggle\('is-empty', showPlaceholder\)/)
  assert.match(appJs, /ids\.has\(state\.nowPlaying\?\.providerTrackId\)/)
  assert.match(styleCss, /#np-artwork\s*\{[^}]*width:\s*46px[^}]*height:\s*46px/s)
  assert.match(styleCss, /#np-artwork\.is-loading::after/)
})

test('normalized set metadata is persisted onto history and favorites', () => {
  assert.match(appJs, /function tagSavedSetMetadata\(url, metadata, \{ overwrite = false, replace = false \} = \{\}\)/)
  assert.match(appJs, /tagSavedSetMetadata\(metadata\.sourceUrl, state\.currentSetMetadata/)
  assert.match(appJs, /tagSavedSetMetadata\(state\.currentSetUrl, current, \{ overwrite: true \}\)/)
  assert.match(appJs, /function savedSetMetadata\(metadata\)/)
  assert.match(appJs, /const metadata = savedSetMetadata\(state\.currentSetMetadata\)/)
  for (const field of ['djNames', 'venue', 'event', 'date']) {
    assert.match(appJs, new RegExp(`histEntry\\.${field}`))
  }
})

test('Library gives events and venues an equal searchable grid/list catalog', () => {
  for (const id of [
    'library-event-venue-title',
    'event-venue-library-search-input',
    'event-venue-library-type-switch',
    'event-venue-library-view-switch',
    'event-venue-library-grid',
    'event-venue-library-empty',
  ]) assert.equal(indexHtml.includes(`id="${id}"`), true, `${id} missing from Library`)
  assert.equal(indexHtml.includes('data-event-venue-view="grid"'), true)
  assert.equal(indexHtml.includes('data-event-venue-view="list"'), true)
  assert.equal(indexHtml.includes('data-event-venue-type="event"'), true)
  assert.equal(indexHtml.includes('data-event-venue-type="venue"'), true)
  assert.match(indexHtml, /id="library-event-venue-title">Events &amp; Venues/)
  assert.match(appJs, /function favoriteEventVenueLibrary\(kind = eventVenueLibraryType\)/)
  assert.match(appJs, /function renderEventVenueLibrary\(\)/)
  assert.match(appJs, /eventVenueLibrarySearchInput\.addEventListener\('input', renderEventVenueLibrary\)/)
  assert.match(appJs, /state\.store\.settings\.eventVenueLibraryViewMode = eventVenueLibraryViewMode/)
  assert.match(appJs, /state\.store\.settings\.eventVenueLibraryType = eventVenueLibraryType/)
  assert.match(appJs, /showEventVenueLibraryDetail\(group\)/)
  assert.match(styleCss, /\.library-event-venue-catalog\s*\{[^}]*border-top:/s)
  assert.match(styleCss, /#library-overview\s*\{[^}]*grid-template-rows:\s*repeat\(2, minmax\(0, 1fr\)\)/s)
  assert.match(styleCss, /\.library-catalog\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s)
})

test('sidebar quick access lists DJs, events, and venues separately and alphabetically', () => {
  for (const panel of ['djs', 'events', 'venues']) {
    assert.equal(indexHtml.includes(`data-panel="${panel}"`), true)
    assert.equal(indexHtml.includes(`id="panel-${panel}"`), true)
  }
  for (const id of [
    'sidebar-dj-list',
    'sidebar-dj-empty',
    'sidebar-event-list',
    'sidebar-event-empty',
    'sidebar-venue-list',
    'sidebar-venue-empty',
  ]) assert.equal(indexHtml.includes(`id="${id}"`), true, `${id} missing from sidebar`)
  assert.match(appJs, /function renderSidebarLibraryGroups\(groups,/)
  assert.match(appJs, /const initial = libraryInitial\(group\.name\)/)
  assert.match(appJs, /separator\.className = 'history-group-sep'/)
  assert.match(appJs, /function makeLibraryQuickAccessItem\(entity, scope\)/)
  assert.match(appJs, /showDjLibraryDetail\(entity\)/)
  assert.match(appJs, /showEventVenueLibraryDetail\(entity\)/)
  assert.match(styleCss, /\.library-quick-thumb\s*\{[^}]*width:\s*72px[^}]*height:\s*41px/s)
  assert.match(appJs, /savedPanel === 'event-venues' \? 'events' : savedPanel/)
})

test('clearTracklist resets scroll on both tracklist containers', () => {
  assert.match(appJs, /function clearTracklist\(\)/)
  assert.match(appJs, /tracklistScrollRegion\.scrollTop\s*=\s*0/)
  assert.match(appJs, /compactScroll\.scrollTop\s*=\s*0/)
})

test('an active set exposes the tracklist shell before provider rows arrive', () => {
  const loadedHandler = appJs.slice(
    appJs.indexOf("window.api.on('tracklist-loaded'"),
    appJs.indexOf("window.api.on('now-playing'")
  )
  assert.match(loadedHandler, /mainContent\.classList\.add\('has-tracklist'\)/)

  const loadSet = appJs.slice(appJs.indexOf('function loadSet('), appJs.indexOf('// ── Resume dialog'))
  assert.match(loadSet, /state\.currentSetAvailability\s*=\s*\{/)
  assert.match(loadSet, /mainContent\.classList\.add\('has-tracklist'\)/)
  assert.match(loadSet, /renderSetMetadataHeader\(\)/)

  const showLoading = appJs.slice(appJs.indexOf('function showLoading('), appJs.indexOf('function showNoTracklist('))
  assert.match(showLoading, /const preserveSetShell =/)
  assert.match(showLoading, /if \(preserveSetShell\)/)
})

test('narrow sidebar hides sep-stat-label words and they exist in markup', () => {
  // CSS rule hides stat labels when sidebar is narrow
  assert.match(styleCss, /sidebar-narrow[^}]*\.sep-stat-label/s)
  // HTML has at least one sep-stat-label span
  assert.equal(indexHtml.includes('class="sep-stat-label"'), true, 'sep-stat-label span missing from index.html')
})

test('panel collapse buttons use SVG cross, not a text glyph', () => {
  // All panel-collapse-btn elements must contain an SVG
  const collapseButtons = [...indexHtml.matchAll(/<button class="panel-collapse-btn"[^>]*>([\s\S]*?)<\/button>/g)]
  assert.ok(collapseButtons.length >= 2, 'expected at least 2 panel-collapse-btn elements')
  for (const [, inner] of collapseButtons) {
    assert.equal(inner.includes('<svg'), true, 'panel-collapse-btn must use SVG, not a text character')
    assert.equal(inner.includes('✕'), false, 'panel-collapse-btn must not use ✕ text character')
  }
})

test('intro hover effect uses CSS :has() to fade unrelated elements', () => {
  assert.match(styleCss, /#intro-screen:has\(\.intro-resume-item:hover\)/)
  // Subtitle and search bar fade out; resume label fades in
  assert.match(styleCss, /#intro-subtitle.*opacity.*0/s)
  assert.match(styleCss, /#intro-search.*opacity.*0/s)
  assert.match(styleCss, /#intro-resume-label.*opacity.*1/s)
})

// ── Alternate tracklist provider ───────────────────────────────────────────────

test('the alternate-provider button has matching markup, styles and wiring', () => {
  assert.equal(indexHtml.includes('id="btn-alt-provider"'), true)
  assert.equal(styleCss.includes('#btn-alt-provider'), true)
  assert.match(appJs, /btnAltProvider\.addEventListener\('click'/)
  assert.match(appJs, /window\.api\.tryTracklistProvider\(alt\.id\)/)
})

test('an untried alternate replaces the contribute prompt, and yields to it once tried', () => {
  // The panel has one action slot: try another provider while one is left,
  // then fall back to contributing a tracklist to the primary provider.
  assert.match(appJs, /const alt = \(alternateProviders \|\| \[\]\)\[0\] \|\| null/)
  assert.match(appJs, /const showContribute = !alt && !lookupError && contributeUrl && contributeLabel/)
  assert.match(appJs, /btnAltProvider\.classList\.toggle\('hidden', !alt\)/)
  assert.match(appJs, /btnContributeTracklist\.classList\.toggle\('hidden', !showContribute\)/)
})

test('the alternate button stays busy until the reply repaints the panel', () => {
  assert.match(appJs, /btnAltProvider\.disabled = true/)
  assert.match(appJs, /btnAltProvider\.textContent = `Searching \$\{alt\.name\}…`/)
})

test('provider information remains payload-driven after mini-player attribution is removed', () => {
  assert.doesNotMatch(appJs, /setNpSource|tracklist obtained from \$\{providerName\}/)
  assert.match(appJs, /state\.currentTracklistProviderName\s*=\s*providerName \|\| null/)
  assert.match(appJs, /state\.currentTracklistProviderFooter \|\| 'edit on 1001Tracklists ↗'/)
  assert.match(appJs, /function tracklistProviderName/)
  assert.match(appJs, /function tracklistProviderNote/)
  // The old hardcoded contribute copy must not survive
  assert.equal(appJs.includes('const ID_COMMUNITY_NOTE'), false)
})

test('normalized set metadata arrives separately from tracklist rows', () => {
  assert.match(preloadJs, /'set-metadata'/)
  assert.match(appJs, /window\.api\.on\('set-metadata'/)
  assert.match(appJs, /mergeSetMetadata\(state\.currentSetMetadata, metadata\)/)
  assert.match(appJs, /mergeSetMetadata\(null, metadata\)/)
  assert.match(appJs, /metadata\?\.sourceUrl !== state\.currentSetUrl/)
})

test('missing metadata offers local edits and exact title suggestions without blocking provider enrichment', () => {
  assert.match(preloadJs, /'source-metadata'/)
  assert.match(appJs, /window\.api\.on\('source-metadata'/)
  assert.match(appJs, /No community metadata found yet/)
  assert.match(appJs, /No SoundCloud match — set79 can't look this set up yet/)
  assert.match(appJs, /function setMetadataSuggestions\(\)/)
  assert.match(appJs, /function metadataLibraryValues\(field\)/)
  assert.match(appJs, /titleContainsLibraryValue\(state\.currentSetTitle, name\)/)
  assert.match(appJs, /class="set-metadata-add"/)
  assert.match(appJs, /class="set-metadata-suggestion"/)
  assert.match(appJs, /data-metadata-field="\$\{field\}"/)
  assert.match(appJs, /function mergeSetMetadata\(existing, incoming\)/)
  assert.match(appJs, /normalizedDjNames\(\[\.\.\.\(savedExisting\.djNames/)
  assert.match(styleCss, /\.set-metadata-editor\s*\{/)
  assert.match(styleCss, /\.set-metadata-autocomplete\s*\{/)
  assert.match(styleCss, /\.set-metadata-editor input\s*\{[^}]*width:\s*min\(105px, 16vw\)/s)
})

test('background artwork updates are scoped to the active set and replace loading placeholders', () => {
  assert.match(preloadJs, /'track-artwork'/)
  assert.match(appJs, /window\.api\.on\('track-artwork'/)
  assert.match(appJs, /payload\?\.sourceUrl !== state\.currentSetUrl/)
  assert.match(appJs, /payload\?\.providerId !== state\.currentTracklistProvider/)
  assert.match(appJs, /item\.dataset\.providerTrackId/)
  assert.match(styleCss, /\.track-art-loading::after/)
  assert.match(styleCss, /prefers-reduced-motion: reduce/)
})

test('metadata header renders normalized facts as pills above the tracklist', () => {
  const headerAt = indexHtml.indexOf('id="set-metadata-header"')
  const tracklistAt = indexHtml.indexOf('id="tracklist-list"')
  const headerHtml = indexHtml.slice(headerAt, indexHtml.indexOf('</section>', headerAt))
  assert.ok(headerAt >= 0 && headerAt < tracklistAt)
  for (const id of ['set-metadata-tags', 'btn-set-metadata-edit', 'btn-set-metadata-refresh']) {
    assert.equal(indexHtml.includes(`id="${id}"`), true, `${id} missing from metadata header`)
  }
  assert.equal(headerHtml.includes('set-availability'), false)
  assert.equal(headerHtml.includes('set-metadata-bottom-row'), false)
  assert.equal(indexHtml.includes('experimental-badge'), false)
  assert.equal(indexHtml.includes('set-metadata-title'), false)
  assert.match(indexHtml, /class="set-metadata-facts-row">[\s\S]*id="set-metadata-tags"[\s\S]*id="btn-set-metadata-refresh"/)
  assert.match(styleCss, /\.set-metadata-pill\s*[,\{]/)
  assert.match(appJs, /metadata\.djNames/)
  assert.match(appJs, /metadata\.venue/)
  assert.match(appJs, /metadata\.event/)
  assert.match(appJs, /metadata\.date/)
})

test('metadata header stays fixed in its original flow while only tracklist content scrolls', () => {
  assert.match(indexHtml, /id="set-metadata-header"[\s\S]*id="tracklist-scroll-region"[\s\S]*id="tracklist-list"/)
  assert.match(styleCss, /#tracklist-below-video\s*\{[^}]*overflow:\s*hidden/s)
  assert.match(styleCss, /#tracklist-scroll-region\s*\{[^}]*overflow-y:\s*auto/s)
  assert.doesNotMatch(styleCss, /\.set-metadata-header\s*\{[^}]*position:\s*(?:fixed|absolute|sticky)/s)
})

test('scroll regions can reuse a parameterized true-transparency edge fade', () => {
  assert.match(appJs, /function wireScrollEdgeFade\(container, \{ size = 24, threshold = 1, wheelSurface = null \} = \{\}\)/)
  assert.match(appJs, /wireScrollEdgeFade\(tracklistScrollRegion, \{ size: 28, wheelSurface: setMetadataHeader \}\)/)
  assert.match(appJs, /container\.classList\.toggle\('is-scrolled', container\.scrollTop >= threshold\)/)
  assert.match(appJs, /container\.scrollTop \+= event\.deltaY/)
  assert.match(styleCss, /\.scroll-edge-fade\.is-scrolled\s*\{[^}]*mask-image:\s*linear-gradient\(to bottom,[^}]*transparent 0,[^}]*#000 var\(--scroll-fade-size, 24px\)/s)
  assert.doesNotMatch(styleCss, /scroll-fade-color/)
})

test('metadata pills open matching Library details outside edit mode', () => {
  assert.match(appJs, /function openMetadataLibraryValue\(field, value\)/)
  assert.match(appJs, /favoriteDjLibrary\(\)\.find/)
  assert.match(appJs, /favoriteEventVenueLibrary\(field\)\.find/)
  assert.match(appJs, /showDjLibraryDetail\(entity\)/)
  assert.match(appJs, /showEventVenueLibraryDetail\(entity\)/)
  assert.match(appJs, /class="set-metadata-pill set-metadata-library-link"/)
})

test('metadata edit mode removes persisted values and offers immediate restoration', () => {
  assert.match(appJs, /function removeSetMetadataValue\(field, rawValue\)/)
  assert.match(appJs, /class="set-metadata-remove"/)
  assert.match(appJs, /tagSavedSetMetadata\(state\.currentSetUrl, current, \{ overwrite: true, replace: true \}\)/)
  assert.match(appJs, /state\.metadataRemovedValues/)
  assert.match(appJs, /A just-removed value is always a useful suggestion/)
  assert.match(appJs, /next\.metadataIgnoredValues = ignoredValues/)
})

test('location settings and the next-gig metadata row are wired into the app', () => {
  for (const id of ['event-suggestions-enabled', 'event-location-setup', 'event-city', 'event-country', 'event-country-other', 'btn-save-event-location', 'event-location-status', 'set-event-lookup']) {
    assert.equal(indexHtml.includes(`id="${id}"`), true, `${id} missing`)
  }
  for (const continent of ['North America', 'Europe', 'South America']) assert.match(appJs, new RegExp(continent))
  assert.match(appJs, /other\.textContent = 'Other…'/)
  assert.doesNotMatch(appJs, /EVENT_COUNTRY_CODES = `AF AX/)
  assert.match(appJs, /function openEventLocationSettings\(\)/)
  assert.match(appJs, /function changeEventLocation\(\)/)
  assert.match(appJs, /eventCityInput\.focus\(\)/)
  assert.match(appJs, /window\.api\.resolveEventLocation/)
  assert.match(appJs, /window\.api\.lookupNextEvents/)
  assert.match(appJs, /window\.api\.openExternal\(url\)/)
  assert.match(styleCss, /\.set-event-location-cta[\s\S]*text-decoration:\s*underline/)
  assert.match(styleCss, /\.set-metadata-pill,[\s\S]*font-size:\s*13px/)
})

test('event lookup reports source-level progress and marquees long normalized summaries', () => {
  assert.match(preloadJs, /'event-lookup-progress'/)
  assert.match(appJs, /window\.api\.on\('event-lookup-progress'/)
  assert.match(appJs, /activeSourceNames/)
  assert.match(appJs, /sources checked/)
  assert.match(appJs, /function compactEventTitle\(/)
  assert.match(appJs, /wireOverflowMarquee\(line\.querySelector\('\.set-event-summary-text'\), line\)/)
  assert.match(styleCss, /\.set-event-summary-clip\s*\{[^}]*overflow:\s*hidden/s)
  assert.match(styleCss, /\.set-event-summary-text\s*\{[^}]*text-overflow:\s*ellipsis/s)
  assert.match(styleCss, /\.set-event-change-location/)
  assert.match(styleCss, /\.set-event-location-control\s*\{[^}]*align-self:\s*flex-start/s)
  assert.match(appJs, /location: \$\{escHtml\(location\.city\)\}, \$\{escHtml\(location\.country\)\}/)
  assert.match(appJs, />change<\/button>/)
})

test('local event suggestions can be dismissed from the header and re-enabled in Settings', () => {
  assert.match(indexHtml, /id="event-suggestions-enabled"> Suggest DJ events in my city/)
  assert.match(appJs, /function eventSuggestionsEnabled\(\)/)
  assert.match(appJs, /state\.store\.settings\?\.eventSuggestionsEnabled !== false/)
  assert.match(appJs, /function setEventSuggestionsEnabled\(enabled\)/)
  assert.match(appJs, /class="set-event-dismiss"><span aria-hidden="true">×<\/span> don't suggest events in my city/)
  assert.match(appJs, /setEventLookup\.querySelector\('\.set-event-dismiss'\).*setEventSuggestionsEnabled\(false\)/s)
  assert.match(appJs, /eventLocationSetup\.classList\.toggle\('hidden', !enabled\)/)
  assert.match(styleCss, /\.set-event-lookup\s*\{[^}]*border-top:\s*1px solid/s)
  assert.match(styleCss, /\.set-event-dismiss\s*\{[^}]*opacity:\s*\.48/s)
})

test('disabled local event suggestions never start or accept a lookup', () => {
  const lookup = appJs.slice(appJs.indexOf('async function lookupNextDjEvents'), appJs.indexOf('const SET_SERVICE_ORDER'))
  assert.ok(lookup.indexOf('if (!eventSuggestionsEnabled())') < lookup.indexOf('window.api.lookupNextEvents'))
  assert.match(appJs, /state\.currentEventLookupRequest\+\+/)
  assert.match(appJs, /window\.api\.on\('event-lookup-progress',[\s\S]*if \(!eventSuggestionsEnabled\(\)\) return/)
  assert.match(appJs, /eventSuggestionsEnabledInput\.addEventListener\('change'/)
})

test('mini-player source strip includes both source and provider checks', () => {
  assert.match(preloadJs, /'set-availability'/)
  assert.match(appJs, /window\.api\.on\('set-availability'/)
  assert.match(indexHtml, /id="np-source" class="set-availability np-set-availability"/)
  assert.match(indexHtml, /id="np-artist-separator"/)
  for (const service of ['1001tracklists', 'youtube', 'soundcloud', 'set79']) {
    assert.match(appJs, new RegExp(`id: '${service}'`), `${service} availability pill missing`)
  }
  for (const status of ['checking', 'available', 'unavailable', 'error']) {
    assert.match(styleCss, new RegExp(`status-${status}`), `${status} availability style missing`)
  }
})

test('the source strip replaces the old mini-player tracklist attribution', () => {
  assert.doesNotMatch(appJs, /set-availability-label">sources|tracklist obtained from/)
  assert.match(appJs, /function renderSetSources\(\)/)
  assert.match(appJs, /const sourceItems = SET_SERVICE_ORDER\.map/)
  assert.doesNotMatch(styleCss, /#np-source \.set-availability-pill\s*\{[^}]*min-height:\s*18px[^}]*font-size:\s*8px/s)
  assert.match(styleCss, /\.set-metadata-pill,\s*\.set-availability-pill\s*\{[^}]*min-height:\s*30px[^}]*padding:\s*5px 10px/s)
})

test('mini-player keeps artist and track on one line with the set title beneath', () => {
  assert.match(indexHtml, /id="np-title-row"[\s\S]*id="np-title-content"[\s\S]*id="np-tracknum"[\s\S]*id="np-artist"[\s\S]*id="np-artist-separator"[\s\S]*id="np-track"/)
  assert.match(indexHtml, /id="np-info"[\s\S]*id="np-set"[\s\S]*id="np-right"[\s\S]*id="np-source"/)
  assert.match(appJs, /npArtistSeparator\.classList\.toggle\('hidden'/)
  assert.match(appJs, /wireOverflowMarquee\(npTitleContent, npTitleRow, npTitleRow\)/)
  assert.match(styleCss, /#np-title-row\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/s)
  assert.match(styleCss, /#np-title-content\s*\{[^}]*width:\s*max-content/s)
  assert.doesNotMatch(styleCss, /#np-track-text\s*\{[^}]*text-overflow:\s*ellipsis/s)
  assert.doesNotMatch(styleCss, /#np-artist\s*\{[^}]*text-overflow:\s*ellipsis/s)
})

test('mini-player track information returns to the focused Now Playing track', () => {
  assert.match(indexHtml, /id="np-info" role="button" tabindex="0"/)
  assert.match(appJs, /function showNowPlayingTrack\(\)/)
  assert.match(appJs, /npInfo\.addEventListener\('click', showNowPlayingTrack\)/)
  assert.match(appJs, /requestAnimationFrame\(\(\) => highlightTracklistByNum\(trackNum\)\)/)
  assert.match(styleCss, /#np-info:hover,[\s\S]*background:\s*color-mix\(/)
  assert.match(styleCss, /#np-info\s*\{[^}]*border:\s*0/s)
})

test('playing track and saved-set rows share compact spectrum activity indicators', () => {
  assert.match(appJs, /function spectrumBarsHtml\(className = ''\)/)
  assert.match(appJs, /spectrumBarsHtml\('track-playing-indicator'\)/)
  assert.match(appJs, /spectrumBarsHtml\('set-playing-indicator'\)/)
  assert.match(appJs, /li\.classList\.toggle\('is-current-set', !!state\.currentSetUrl && item\.url === state\.currentSetUrl\)/)
  assert.match(appJs, /if \(item\.url === state\.currentSetUrl\) \{\s*showNowPlayingTrack\(\)\s*return/s)
  assert.match(styleCss, /\.track-item\.active \.track-playing-indicator\s*\{[^}]*display:\s*flex/s)
  assert.match(styleCss, /\.set-list li\.is-current-set\s*\{[^}]*border-left:\s*2px solid var\(--accent\)/s)
  assert.match(styleCss, /\.set-playing-indicator \.spectrum-bar\s*\{[^}]*width:\s*1px/s)
})

test('Library detail cards mark the playing set over its thumbnail and return directly to Now Playing', () => {
  const cardFn = appJs.slice(appJs.indexOf('function renderLibrarySetCard'), appJs.indexOf('function showLibraryEntityDetail'))
  assert.match(cardFn, /card\.classList\.toggle\('is-current-set', isCurrentSet\)/)
  assert.match(cardFn, /spectrumBarsHtml\('library-set-playing-indicator'\)/)
  assert.match(cardFn, /if \(item\.url === state\.currentSetUrl\) \{\s*showNowPlayingTrack\(\)\s*return/s)
  assert.ok(cardFn.indexOf('showNowPlayingTrack()') < cardFn.indexOf('openStoredSet(item)'))
  assert.match(styleCss, /\.library-set-thumb-frame\s*\{[^}]*position:\s*relative/s)
  assert.match(styleCss, /\.library-set-playing-indicator\s*\{[^}]*position:\s*absolute[^}]*top:\s*8px[^}]*right:\s*8px/s)
  assert.match(styleCss, /\.library-set-card\.is-current-set \.library-set-playing-indicator\s*\{[^}]*display:\s*flex/s)
})

test('mini-player metadata keeps layout priority over the compact source pills', () => {
  assert.match(styleCss, /#np-info\s*\{[^}]*flex:\s*1 1 520px[^}]*min-width:\s*300px[^}]*height:\s*46px/s)
  assert.match(styleCss, /#np-right\s*\{[^}]*flex:\s*0 0 148px[^}]*width:\s*148px[^}]*min-width:\s*148px[^}]*max-width:\s*148px/s)
  assert.match(styleCss, /#np-source \.set-availability-pill\s*\{[^}]*width:\s*max-content[^}]*border:\s*0[^}]*border-radius:\s*0[^}]*background:\s*transparent[^}]*font-size:\s*9px/s)
  assert.match(styleCss, /#np-source \.set-availability-dot\s*\{[^}]*display:\s*none/s)
  for (const selector of ['#np-tracknum', '#np-artist', '#np-artist-separator']) {
    assert.match(styleCss, new RegExp(`${selector}\\s*\\{[^}]*font-size:\\s*14px`, 's'))
  }
})

test('mini-player sources form two independent provider-first rows', () => {
  const order = appJs.slice(appJs.indexOf('const SET_SERVICE_ORDER'), appJs.indexOf('const SET_AVAILABILITY_LABELS'))
  assert.ok(order.indexOf("id: '1001tracklists'") < order.indexOf("id: 'set79'"))
  assert.ok(order.indexOf("id: 'set79'") < order.indexOf("id: 'youtube'"))
  assert.ok(order.indexOf("id: 'youtube'") < order.indexOf("id: 'soundcloud'"))
  assert.match(appJs, /sourceItems\.slice\(0, 2\), sourceItems\.slice\(2\)/)
  assert.match(appJs, /class="np-source-row"/)
  assert.match(styleCss, /#np-source\s*\{[^}]*flex-direction:\s*column[^}]*align-items:\s*flex-end/s)
  assert.match(styleCss, /\.np-source-row\s*\{[^}]*display:\s*flex[^}]*width:\s*max-content/s)
  assert.doesNotMatch(styleCss, /#np-source\s*\{[^}]*grid-template-columns/s)
})

test('available source and provider pills merge status with guarded external links', () => {
  assert.match(appJs, /const url = status === 'available' \? services\[id\]\?\.url : null/)
  assert.match(appJs, /set-availability-pill status-/)
  assert.match(appJs, /is-clickable/)
  assert.match(appJs, /window\.api\.openExternal\(url\)/)
  assert.match(styleCss, /\.set-availability-pill\.is-clickable/)
})

test('tracklist provider choices have a styled single-provider state and selector pills', () => {
  assert.equal(indexHtml.includes('id="tracklist-provider-choice"'), true)
  assert.match(appJs, /function renderTracklistProviderChoice\(\)/)
  assert.match(appJs, /tracklist-provider-choice is-single/)
  assert.match(appJs, /tracklist-provider-value/)
  assert.equal((appJs.match(/tracklist source/g) || []).length, 2)
  assert.match(appJs, /tracklist-provider-pill.*active/)
  assert.match(appJs, /window\.api\.selectTracklistProvider\(option\.id\)/)
  assert.match(preloadJs, /selectTracklistProvider: \(providerId\) => ipcRenderer\.invoke\('tracklist-select-provider'/)
  assert.match(styleCss, /\.tracklist-provider-choice\.is-single/)
  assert.match(styleCss, /\.tracklist-provider-choice\s*\{[^}]*justify-content:\s*center/s)
  assert.match(styleCss, /\.tracklist-provider-pill\.active/)
})

test('auto metadata lookup can replace a successful set79 match and edit mode is explicit', () => {
  assert.match(preloadJs, /autoSetMetadata: \(\) => ipcRenderer\.invoke\('set-metadata-auto'\)/)
  assert.match(appJs, /btnSetMetadataRefresh\.addEventListener\('click', autoSetMetadata\)/)
  assert.match(appJs, /btnSetMetadataEdit\.addEventListener\('click'/)
  assert.match(appJs, /await window\.api\.autoSetMetadata\(\)/)
  assert.match(appJs, /state\.metadataOverwriteOnSet79 = true/)
  assert.match(appJs, /metadata\.providerId === 'set79'/)
  assert.match(appJs, /replace: replaceFromSet79/)
  assert.match(appJs, /btnSetMetadataRefresh\.classList\.add\('is-refreshing'\)/)
  assert.match(styleCss, /\.set-metadata-refresh\.is-refreshing svg/)
  assert.match(styleCss, /@keyframes set-metadata-spin\s*\{[^}]*rotate\(-360deg\)/s)
  assert.match(styleCss, /\.set-metadata-header\.is-editing\s*\{/)
  assert.match(indexHtml, /<span>auto<\/span>/)
})

test('manual metadata removals survive cache backfill and can be explicitly reset', () => {
  assert.match(appJs, /function normalizedIgnoredMetadataValues\(values\)/)
  assert.match(appJs, /next\.metadataIgnoredValues = ignoredValues/)
  assert.match(appJs, /savedIgnoredMetadataValuesForUrl\(item\.url\)/)
  assert.match(appJs, /if \(isNewSet\) state\.metadataRemovedValues = savedIgnoredMetadataValuesForUrl\(url\)/)
  assert.match(appJs, /metadataIgnoredValues: normalizedIgnoredMetadataValues\(state\.metadataRemovedValues\)/)
  const refresh = appJs.slice(appJs.indexOf('async function autoSetMetadata'), appJs.indexOf('function openAboutDialog'))
  assert.ok(refresh.indexOf('state.metadataRemovedValues = []') < refresh.indexOf('window.api.autoSetMetadata()'))
  assert.match(refresh, /tagSavedSetMetadata\(sourceUrl, state\.currentSetMetadata/)
})

test('Last.fm remains the first settings section', () => {
  const settings = indexHtml.slice(indexHtml.indexOf('id="panel-settings"'), indexHtml.indexOf('</div><!-- #sidebar-panels -->'))
  assert.ok(settings.indexOf('<div class="panel-title">Last.fm</div>') < settings.indexOf('<div class="panel-title">Location</div>'))
})
