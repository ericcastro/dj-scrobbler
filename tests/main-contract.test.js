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

test('store-set handler always re-injects scrobbler sessions to prevent renderer from wiping them', () => {
  assert.match(mainJs, /scrobblers\.lastfm\.session[\s\S]*?next\.settings/)
  assert.match(mainJs, /scrobblers\.listenbrainz\.config[\s\S]*?next\.settings/)
})

test('update-utils is loaded from lib subdirectory', () => {
  assert.match(mainJs, /require\(['"]\.\/lib\/update-utils['"]\)/)
})

test('macOS self-updates via lib/mac-updater instead of Squirrel.Mac', () => {
  assert.match(mainJs, /require\(['"]\.\/lib\/mac-updater['"]\)/)
  // Squirrel.Mac rejects ad-hoc signed builds, so the electron-updater path
  // must never run on darwin.
  assert.match(mainJs, /MAC_SELF_UPDATE\s*=\s*process\.platform\s*===\s*'darwin'/)
  assert.match(mainJs, /if\s*\(MAC_SELF_UPDATE\)\s*return downloadMacUpdate\(\)/)
  assert.match(mainJs, /if\s*\(MAC_SELF_UPDATE\)\s*return macQuitAndInstall\(\)/)
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
    'scrobbler-status',
    'scrobbler-target-get',
    'scrobbler-target-set',
    'lb-config-get',
    'lb-connect',
    'lb-disconnect',
    'set-theme',
  ]
  for (const ch of channels) {
    assert.equal(mainJs.includes(`'${ch}'`), true, `IPC channel '${ch}' missing from main.js`)
  }
})
