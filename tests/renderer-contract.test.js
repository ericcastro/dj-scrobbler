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
  assert.match(appJs, /card\.addEventListener\('click', \(\) => openStoredSet\(item\)\)/)
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
  assert.match(appJs, /ids\.has\(state\.nowPlaying\?\.providerTrackId\)/)
  assert.match(styleCss, /#np-artwork\s*\{[^}]*width:\s*46px[^}]*height:\s*46px/s)
  assert.match(styleCss, /#np-artwork\.is-loading::after/)
})

test('normalized DJ metadata is persisted onto history and favorites', () => {
  assert.match(appJs, /function tagSavedSetDjNames\(url, djNames\)/)
  assert.match(appJs, /tagSavedSetDjNames\(metadata\.sourceUrl, metadata\.djNames\)/)
  assert.match(appJs, /const djNames = normalizedDjNames\(state\.currentSetMetadata\?\.djNames\)/)
  assert.match(appJs, /\.\.\.\(djNames\.length \? \{ djNames \} : \{\}\)/)
  assert.match(appJs, /djNames:\s*normalizedDjNames\(state\.currentSetMetadata\?\.djNames \|\| histEntry\?\.djNames\)/)
})

test('clearTracklist resets scroll on both tracklist containers', () => {
  assert.match(appJs, /function clearTracklist\(\)/)
  assert.match(appJs, /tracklistBelowVideo\.scrollTop\s*=\s*0/)
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
  assert.match(appJs, /state\.currentSetMetadata = metadata/)
  assert.match(appJs, /metadata\?\.sourceUrl !== state\.currentSetUrl/)
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
  for (const id of ['set-metadata-tags', 'btn-set-metadata-refresh']) {
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

test('mini-player source strip includes both source and provider checks', () => {
  assert.match(preloadJs, /'set-availability'/)
  assert.match(appJs, /window\.api\.on\('set-availability'/)
  assert.match(indexHtml, /id="np-source" class="set-availability np-set-availability"/)
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
  assert.match(appJs, /npSource\.innerHTML = SET_SERVICE_ORDER\.map/)
  assert.match(styleCss, /#np-source \.set-availability-pill\s*\{[^}]*min-height:\s*18px[^}]*font-size:\s*8px/s)
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

test('metadata refresh button invokes a cache-bypassing lookup and shows busy state', () => {
  assert.match(preloadJs, /refreshTracklists: \(\) => ipcRenderer\.invoke\('tracklist-refresh'\)/)
  assert.match(appJs, /btnSetMetadataRefresh\.addEventListener\('click', refreshSetMetadata\)/)
  assert.match(appJs, /await window\.api\.refreshTracklists\(\)/)
  assert.match(appJs, /btnSetMetadataRefresh\.classList\.add\('is-refreshing'\)/)
  assert.match(styleCss, /\.set-metadata-refresh\.is-refreshing svg/)
})
