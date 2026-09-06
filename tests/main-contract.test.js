const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
// Source is matched with regexes that span lines. Windows checks the repo out
// with CRLF, so normalise first — otherwise every multi-line pattern silently
// stops matching in CI.
const readSource = (rel) => fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n')

const mainJs = readSource('main.js')

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
    'tracklist-options',
    'set-metadata',
    'set-availability',
    'wv-status',
    'lfm-status',
    'set-theme',
  ]
  for (const ch of channels) {
    assert.equal(mainJs.includes(`'${ch}'`), true, `IPC channel '${ch}' missing from main.js`)
  }
})

// ── Alternate tracklist providers ──────────────────────────────────────────────

test('the provider probe pipeline is shared by automatic and manual lookups', () => {
  // Both entry points share cache → search → extract without sharing UI state.
  assert.match(mainJs, /async function probeTracklistProvider\(tlPlugin, meta, lookupToken,/)
  assert.match(mainJs, /async function runTracklistLookup\(tlPlugin, meta, lookupToken/)
  assert.match(mainJs, /lookup: plugin => probeTracklistProvider\(plugin, meta, lookupToken, \{ bypassCache \}\)/)
  assert.match(mainJs, /await probeTracklistProvider\(tlPlugin, meta, lookupToken\)/)
  assert.match(mainJs, /await runTracklistLookup\(tlPlugin, currentSourceMeta, lookupToken, \{ manual: true \}\)/)
})

test('YouTube playback starts before either automatic tracklist result is awaited', () => {
  const fn = mainJs.slice(
    mainJs.indexOf('async function handleSourceUrl'),
    mainJs.indexOf('// ── WebView wiring')
  )
  assert.ok(fn.indexOf('playbackContents.loadURL(playerUrl)') < fn.indexOf('await runAutomaticTracklistLookups'),
    'tracklist providers must not gate player navigation')
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
  assert.match(fn, /if \(!manual\) mainWindow\.webContents\.send\('wv-status', \{ type: 'loading'/)
})

test('providers already tried are not offered again for the same set', () => {
  assert.match(mainJs, /triedProviders\.add\(tlPlugin\.id\)/)
  assert.match(mainJs, /triedProviders = new Set\(\)/)
  assert.match(mainJs, /alternateTracklistsForSource\(currentSourceId, \{ exclude: \[\.\.\.triedProviders\] \}\)/)
})

test('every no-tracklist outcome uses the same fallback payload builder', () => {
  assert.match(mainJs, /function sendTracklistFallback\(tlPlugin, error = null\)/)
  const fn = mainJs.slice(mainJs.indexOf('function sendTracklistFallback'), mainJs.indexOf('/** Manual retry path'))
  assert.match(fn, /isFallback: true/)
  assert.match(fn, /\.\.\.tracklistFallbackExtras\(\)/)
})

test('an empty extract counts as a miss, not as a loaded tracklist', () => {
  // Otherwise the set would be pinned to a provider holding no tracks and the
  // remaining alternates would never be offered.
  assert.match(mainJs, /if \(extracted\.tracks\.length === 0\)/)
  const fn = mainJs.slice(mainJs.indexOf('if (extracted.tracks.length === 0)'))
  assert.match(fn.slice(0, 450), /return \{ usable: false, sourceUrl, tracklistUrl: best\.url, metadata, sourceLinks \}/)
})

test('provider normalization is applied to fresh and cached tracklists', () => {
  const fn = mainJs.slice(mainJs.indexOf('function normalizeTracks('), mainJs.indexOf('function isTimelineTrack('))
  assert.match(fn, /provider\?\.normalizeTracklist/)
  assert.match(mainJs, /normalizeTracks\(cached\.tracks, cached\.providerId\)/)
  assert.match(mainJs, /normalizeTracks\(extracted\.tracks, tlPlugin\.id\)/)
})

test('weak-signal providers can raise the minimum match score', () => {
  assert.match(mainJs, /const minScore = tlPlugin\.minMatchScore \|\| 1/)
  assert.match(mainJs, /if \(!top \|\| top\.score < minScore\)/)
})

test('set79 candidate duration is best-effort and sourced after playback starts', () => {
  assert.match(mainJs, /currentSourceMeta\.durationSeconds = Number\(poll\.duration\)/)
  assert.match(mainJs, /async function waitForSourceDuration/)
  assert.match(mainJs, /function extractCandidateInfoInBackground/)
  assert.match(mainJs, /extractCandidateInfoInBackground\(tlPlugin, result\.url\)\.catch\(\(\) => null\)/)
  assert.match(mainJs, /plugins\.tracklistMatchScore\(meta, r\)/)
})

test('tracklist-loaded names the provider so the renderer stops hardcoding it', () => {
  assert.match(mainJs, /providerName: tlPlugin\?\.name \|\| null/)
  assert.match(mainJs, /providerFooterLabel: tlPlugin\?\.footerLabel \|\| null/)
})

test('cached alternate tracklists participate in automatic fallback without pinning the primary', () => {
  assert.match(mainJs, /getCachedTracklist\(tlPlugin\.id, sourceUrl\)/)
  assert.match(mainJs, /primaryProvider: primaryPlugin/)
  assert.match(mainJs, /fallbackProvider: fallbackPlugin/)
  assert.match(mainJs, /if \(choice\.selected\) \{\s*applyTracklistResult\(choice\.selected\.provider/)
})

test('tracklist cache remains backward compatible while carrying optional metadata', () => {
  const validator = mainJs.slice(
    mainJs.indexOf('function isUsableCachedTracklist'),
    mainJs.indexOf('function pruneTracklistCache')
  )
  assert.equal(validator.includes('metadata'), false, 'older v2 entries must remain usable')
  assert.match(mainJs, /metadata: metadata \|\| null/)
  assert.match(mainJs, /metadata: normalizeSetMetadata\(cached\.metadata\)/)
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

test('YouTube and SoundCloud source links are explicitly allowed externally', () => {
  const declaration = mainJs.slice(
    mainJs.indexOf('const APP_EXTERNAL_HOSTS'),
    mainJs.indexOf('function allowedExternalHosts')
  )
  for (const host of ['youtube.com', 'youtu.be', 'soundcloud.com']) {
    assert.match(declaration, new RegExp(`['"]${host.replace('.', '\\.') }['"]`), `${host} missing from allowlist`)
  }
})

test('the initial availability payload covers both sources and both providers', () => {
  const availability = mainJs.slice(
    mainJs.indexOf("mainWindow.webContents.send('set-availability'", mainJs.indexOf('async function handleSourceUrl')),
    mainJs.indexOf('const playerUrl', mainJs.indexOf('async function handleSourceUrl'))
  )
  assert.match(availability, /youtube:\s*\{ status: 'available', url: currentSourceUrl \}/)
  assert.match(availability, /soundcloud:\s*\{ status: 'checking'/)
  assert.match(availability, /'1001tracklists':\s*\{ status: 'checking' \}/)
  assert.match(availability, /set79:\s*\{ status: 'checking' \}/)
})

test('manual provider retries continue to update availability state', () => {
  const fn = mainJs.slice(mainJs.indexOf('async function runTracklistLookup'), mainJs.indexOf('// ── Source → tracklist routing'))
  assert.match(fn, /emitSetAvailability/)
  assert.match(fn, /\[tlPlugin\.id\]: \{ status: 'checking' \}/)
  assert.match(fn, /tlPlugin\.id === 'set79'/)
})

test('explicit refresh bypasses every provider cache without showing a playback overlay', () => {
  assert.match(mainJs, /ipcMain\.handle\('tracklist-refresh', \(\) => refreshTracklistLookups\(\)\)/)
  const fn = mainJs.slice(mainJs.indexOf('async function refreshTracklistLookups'), mainJs.indexOf('// ── Source → tracklist routing'))
  assert.match(fn, /bypassCache: true/)
  assert.match(fn, /showLoading: false/)
  assert.match(fn, /waitForFallback: true/)
  assert.match(fn, /normalizeSetMetadata\(null\)/)
  assert.match(mainJs, /if \(!bypassCache\) \{\s*log\(`\[lookup\] checking tracklist cache/)
})

test('available provider statuses carry their set-specific external URLs', () => {
  assert.match(mainJs, /url: outcome\.result\?\.usable \? outcome\.result\.tracklistUrl : null/)
  assert.match(mainJs, /url: outcome\.result\?\.usable \? outcome\.result\.tracklistUrl : null/)
  assert.match(mainJs, /url: result\.usable \? result\.tracklistUrl : null/)
})

test('usable provider outcomes are retained as switchable options', () => {
  assert.match(mainJs, /let currentTracklistOptions = new Map\(\)/)
  assert.match(mainJs, /function registerTracklistOption\(/)
  assert.match(mainJs, /mainWindow\.webContents\.send\('tracklist-options'/)
  assert.match(mainJs, /ipcMain\.handle\('tracklist-select-provider'/)
  assert.match(mainJs, /writeTracklistPreference\(currentSourceUrl, providerId\)/)
})

test('tracklist provider preferences are persisted separately from tracklist cache', () => {
  assert.match(mainJs, /function getTracklistPreference\(sourceUrl\)/)
  assert.match(mainJs, /preferredProviderId: getTracklistPreference\(/)
  assert.match(mainJs, /existing\.tracklistPreferences\)/)
  assert.match(mainJs, /store\.tracklistPreferences = \{\}/)
})

test('every tracklist provider declares the host its links point at', () => {
  const plugins = require('../plugins')
  for (const p of plugins.TRACKLISTS) {
    assert.ok(p.externalHost, `${p.id} is missing externalHost`)
  }
})
