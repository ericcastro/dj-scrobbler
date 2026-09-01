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
    'lfm-status',
    'set-theme',
  ]
  for (const ch of channels) {
    assert.equal(mainJs.includes(`'${ch}'`), true, `IPC channel '${ch}' missing from main.js`)
  }
})

// ── Alternate tracklist providers ──────────────────────────────────────────────

test('the lookup pipeline is shared by the automatic lookup and the manual retry', () => {
  // Both entry points must run the same search → extract → cache → broadcast
  // path, so a provider only has to be correct once.
  assert.match(mainJs, /async function runTracklistLookup\(tlPlugin, meta, lookupToken/)
  assert.match(mainJs, /await runTracklistLookup\(tlPlugin, meta, lookupToken\)/)
  assert.match(mainJs, /await runTracklistLookup\(tlPlugin, currentSourceMeta, lookupToken, \{ manual: true \}\)/)
})

test('manual provider retries are reachable over IPC and keyed to the live set', () => {
  assert.match(mainJs, /ipcMain\.handle\('tracklist-try-provider'/)
  assert.match(mainJs, /async function tryTracklistProvider\(providerId\)/)
  // Replaying the lookup needs the meta from the original source navigation
  assert.match(mainJs, /currentSourceMeta = meta/)
  assert.match(mainJs, /if \(!currentSourceMeta \|\| !currentSourceUrl\)/)
})

test('a manual retry scrobbles and clears the outgoing provider before searching', () => {
  const fn = mainJs.slice(mainJs.indexOf('async function tryTracklistProvider'))
  assert.match(fn, /scrobbleLastTrackIfReady\(\)/)
  assert.match(fn, /resetTimelineState\(\)/)
  assert.match(fn, /currentTracks = \[\]/)
})

test('a manual retry leaves the running player alone', () => {
  // The loading overlay covers the video, so manual runs skip it — the
  // fallback panel below the player carries the progress instead.
  const fn = mainJs.slice(mainJs.indexOf('async function runTracklistLookup'))
  assert.match(fn, /if \(!manual\) \{\s*mainWindow\.webContents\.send\('wv-status', \{ type: 'loading'/)
})

test('providers already tried are not offered again for the same set', () => {
  assert.match(mainJs, /triedProviders\.add\(tlPlugin\.id\)/)
  assert.match(mainJs, /triedProviders = new Set\(\)/)
  assert.match(mainJs, /alternateTracklistsForSource\(currentSourceId, \{ exclude: \[\.\.\.triedProviders\] \}\)/)
})

test('every no-tracklist outcome offers the same contribute and alternate choices', () => {
  // Search miss, provider error and empty extract must all reach the same panel.
  const fallbackSends = mainJs.match(/isFallback: true,\n\s*(lookupError,\n\s*)?\.\.\.tracklistFallbackExtras\(\),/g)
  assert.equal(fallbackSends.length, 3, 'expected 3 fallback tracklist-loaded payloads')
})

test('an empty extract counts as a miss, not as a loaded tracklist', () => {
  // Otherwise the set would be pinned to a provider holding no tracks and the
  // remaining alternates would never be offered.
  assert.match(mainJs, /if \(extracted\.tracks\.length === 0\)/)
  const fn = mainJs.slice(mainJs.indexOf('if (extracted.tracks.length === 0)'))
  assert.match(fn.slice(0, 400), /currentTracklistProvider = null/)
})

test('weak-signal providers can raise the minimum match score', () => {
  assert.match(mainJs, /const minScore = tlPlugin\.minMatchScore \|\| 1/)
  assert.match(mainJs, /if \(!top \|\| top\.score < minScore\)/)
})

test('tracklist-loaded names the provider so the renderer stops hardcoding it', () => {
  assert.match(mainJs, /providerName: tlPlugin\?\.name \|\| null/)
  assert.match(mainJs, /providerFooterLabel: tlPlugin\?\.footerLabel \|\| null/)
})

test('a tracklist fetched by hand from an alternate is restored on reopen', () => {
  // The primary still retries first — a set79 result must not pin the set
  // forever if 1001Tracklists later gains a tracklist for it.
  assert.match(mainJs, /async function restoreCachedAlternate\(meta, lookupToken\)/)
  assert.match(mainJs, /\.find\(p => getCachedTracklist\(p\.id, currentSourceUrl\)\)/)
  // Every dead end tries the restore before painting the fallback panel
  const restores = mainJs.match(/if \(await restoreCachedAlternate\(meta, lookupToken\)\) return/g)
  assert.equal(restores.length, 3, 'expected the restore on all 3 no-tracklist paths')
})

test('the external-link allowlist is derived from the tracklist registry', () => {
  // Regression: set79 links were silently dropped because the allowlist named
  // 1001tracklists.com by hand. A new provider must not have to remember this.
  assert.match(mainJs, /function allowedExternalHosts/)
  assert.match(mainJs, /plugins\.TRACKLISTS\.map\(p => p\.externalHost\)\.filter\(Boolean\)/)
  assert.equal(/const allowed = \['djscrobbler\.com'/.test(mainJs), false,
    'open-external still hardcodes provider hosts')
  // A rejected URL has to say so — silence is what hid this for a whole session
  assert.match(mainJs, /\[external\] blocked/)
})

test('every tracklist provider declares the host its links point at', () => {
  const plugins = require('../plugins')
  for (const p of plugins.TRACKLISTS) {
    assert.ok(p.externalHost, `${p.id} is missing externalHost`)
  }
})
