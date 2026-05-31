const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const mainJs = fs.readFileSync(path.join(root, 'main.js'), 'utf8')

// ── Windows titlebar overlay ───────────────────────────────────────────────────

test('TITLEBAR_OVERLAY_THEMES defines color and symbolColor for all three themes', () => {
  for (const theme of ['neon-night', 'signal-teal', 'sunset-deck']) {
    assert.match(mainJs, new RegExp(`'${theme}'\\s*:\\s*\\{[^}]*color:`), `${theme} missing color`)
    assert.match(mainJs, new RegExp(`'${theme}'\\s*:\\s*\\{[^}]*symbolColor:`), `${theme} missing symbolColor`)
  }
})

test('titleBarOverlayForTheme returns height matching --topbar-h (52)', () => {
  assert.match(mainJs, /function titleBarOverlayForTheme/)
  assert.match(mainJs, /height:\s*52/)
})

test('titleBarOverlayForTheme falls back to neon-night for unknown themes', () => {
  assert.match(mainJs, /TITLEBAR_OVERLAY_THEMES\[theme\]\s*\|\|\s*TITLEBAR_OVERLAY_THEMES\['neon-night'\]/)
})

test('createWindow uses platform-conditional titlebar style', () => {
  // macOS gets hiddenInset, Windows gets hidden + overlay, Linux gets native frame (frame: true)
  assert.match(mainJs, /process\.platform\s*===\s*'darwin'/)
  assert.match(mainJs, /titleBarStyle:\s*'hiddenInset'/)
  assert.match(mainJs, /process\.platform\s*===\s*'win32'/)
  assert.match(mainJs, /titleBarStyle:\s*'hidden'/)
  assert.match(mainJs, /frame:\s*true/)
})

test('set-theme IPC handler delegates to setTitleBarTheme which calls setTitleBarOverlay on Windows', () => {
  // The handler calls a dedicated helper
  assert.match(mainJs, /ipcMain\.handle\('set-theme'/)
  assert.match(mainJs, /setTitleBarTheme\(theme\)/)

  // The helper guards on win32 and calls setTitleBarOverlay
  assert.match(mainJs, /function setTitleBarTheme/)
  assert.match(mainJs, /process\.platform[^)]*win32/)
  assert.match(mainJs, /mainWindow\.setTitleBarOverlay/)
})

// ── Store structure ────────────────────────────────────────────────────────────

test('store-set handler always re-injects lfmSession to prevent renderer from wiping it', () => {
  assert.match(mainJs, /lfmSession.*store\.settings/)
})

test('update-utils is loaded from lib subdirectory', () => {
  assert.match(mainJs, /require\(['"]\.\/lib\/update-utils['"]\)/)
})

// ── IPC channel completeness ───────────────────────────────────────────────────

test('all documented IPC channels are present in main.js', () => {
  const channels = [
    'store-get',
    'store-set',
    'player-toggle',
    'open-devtools',
    'lfm-connect',
    'lfm-disconnect',
    'now-playing',
    'tracklist-loaded',
    'wv-status',
    'lfm-status',
    'set-theme',
  ]
  for (const ch of channels) {
    assert.equal(mainJs.includes(`'${ch}'`), true, `IPC channel '${ch}' missing from main.js`)
  }
})
