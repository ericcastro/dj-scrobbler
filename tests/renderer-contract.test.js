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
