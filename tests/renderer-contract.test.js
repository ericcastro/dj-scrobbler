const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const appJs = fs.readFileSync(path.join(root, 'renderer/app.js'), 'utf8')
const indexHtml = fs.readFileSync(path.join(root, 'renderer/index.html'), 'utf8')
const styleCss = fs.readFileSync(path.join(root, 'renderer/style.css'), 'utf8')

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

test('clearTracklist resets scroll on both tracklist containers', () => {
  assert.match(appJs, /function clearTracklist\(\)/)
  assert.match(appJs, /tracklistBelowVideo\.scrollTop\s*=\s*0/)
  assert.match(appJs, /compactScroll\.scrollTop\s*=\s*0/)
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
