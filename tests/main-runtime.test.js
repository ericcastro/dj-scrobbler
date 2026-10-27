const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const { pathToFileURL } = require('node:url')

const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8')

// Exercise the actual main-process orchestration with controlled dependencies,
// without booting Electron or touching the user's store/network/devices.
function mainFunctions(start, end, globals) {
  const context = vm.createContext({ CASTING_SUPPORT: { supported: true }, ...globals })
  vm.runInContext(source.slice(source.indexOf(start), source.indexOf(end)), context)
  return context
}

test('Windows titlebar creation and theme updates share the active palette and height', () => {
  let overlay
  const paletteSource = source.slice(source.indexOf('const THEME_TITLE_BAR ='), source.indexOf('const MAX_TRACKLIST_CACHE_ENTRIES'))
  const context = mainFunctions('function titleBarOptions(', '// ── Window bounds persistence', {
    process: { platform: 'win32' },
    WINDOWS_TITLE_BAR_OVERLAY_HEIGHT: 51,
    mainWindow: { setTitleBarOverlay(value) { overlay = value } },
  })
  vm.runInContext(paletteSource, context)
  for (const theme of ['neon-night', 'signal-teal', 'sunset-deck', 'unknown']) {
    const options = context.titleBarOptions(theme)
    context.setTitleBarTheme(theme)
    assert.deepEqual(overlay, options.titleBarOverlay)
    assert.equal(overlay.height, 51)
  }
  assert.deepEqual(context.titleBarOptions('unknown'), context.titleBarOptions('neon-night'))
})

test('macOS and Linux retain their existing native titlebar strategies', () => {
  for (const platform of ['darwin', 'linux']) {
    const context = mainFunctions('function titleBarOptions(', '// ── Window bounds persistence', { process: { platform } })
    const options = context.titleBarOptions('neon-night')
    if (platform === 'darwin') assert.equal(options.titleBarStyle, 'hiddenInset')
    else assert.equal(options.frame, true)
  }
})

test('session permissions keep media capture on app-owned frames and reject unrelated access', () => {
  const main = {}
  const player = {}
  const browser = {}
  const root = path.join(__dirname, '..')
  const context = mainFunctions('function sessionPermissionAllowed(', 'function createWindow(', {
    mainWindow: { webContents: main },
    playerWvContents: player,
    path,
    pathToFileURL,
    __dirname: root,
    isYouTubePlayerUrl: require('../lib/youtube-player-ui').isYouTubePlayerUrl,
  })
  const allowed = context.sessionPermissionAllowed
  const appUrl = pathToFileURL(path.join(root, 'renderer', 'index.html')).href
  const playerUrl = 'https://www.djscrobbler.com/embed/youtube?v=abcdefghijk'
  assert.equal(allowed(main, 'display-capture', appUrl), true)
  assert.equal(allowed(player, 'display-capture', playerUrl), true)
  assert.equal(allowed(player, 'media', 'https://www.youtube.com/embed/abcdefghijk'), false)
  assert.equal(allowed(browser, 'media', playerUrl), false)
  assert.equal(allowed(null, 'media', playerUrl), false)
  assert.equal(allowed(main, 'media', 'https://example.org'), false)
  for (const permission of ['geolocation', 'notifications', 'midi', 'fileSystem', 'unknown']) {
    assert.equal(allowed(main, permission, appUrl), false)
  }
  assert.equal(allowed(browser, 'fullscreen', 'https://www.youtube.com'), true)
})

test('licenses IPC opens only the fixed bundled directory and reports OS failures', async () => {
  for (const isPackaged of [true, false]) {
    let handler
    let opened
    let osError = ''
    mainFunctions("ipcMain.handle('licenses-open'", "ipcMain.handle('tracklist-cache-clear'", {
      ipcMain: { handle(_name, callback) { handler = callback } },
      app: { isPackaged },
      process: { resourcesPath: path.join(path.sep, 'app', 'Resources') },
      path,
      developmentMediaToolsDirectory: () => path.join(path.sep, 'dev', 'media'),
      shell: { async openPath(directory) { opened = directory; return osError } },
    })
    await handler({}, '/an/arbitrary/path/from/renderer')
    assert.equal(opened, isPackaged ? path.join(path.sep, 'app', 'Resources', 'bin') : path.join(path.sep, 'dev', 'media'))
    osError = 'folder unavailable'
    await assert.rejects(handler({}), /folder unavailable/)
  }
})

test('editing artwork carries every pending cover into the replacement generation', async () => {
  let queued
  const context = mainFunctions('function queueCurrentTrackArtwork(', 'function editRecognizedTrack(', {
    currentTracks: [{ providerTrackId: 'edited' }, { providerTrackId: 'pending', artworkStatus: 'loading' }],
    isArtworkLookupCandidate: () => true,
    prepareTracksForArtwork: tracks => tracks.map(track => ({ ...track, artworkStatus: 'loading' })),
    emitCurrentTracklistData() {},
    currentArtworkToken: 1,
    artworkCacheGeneration: 1,
    currentLookupToken: 1,
    currentSourceUrl: 'source',
    currentTracklistProvider: 'youtube-comments',
    currentTracklistUrl: 'source',
    setImmediate,
    enrichArtworkInBackground: async (tracks, job) => { queued = { tracks, job } },
  })
  context.queueCurrentTrackArtwork('edited')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(Array.from(queued.tracks, track => track.providerTrackId), ['edited', 'pending'])
  assert.equal(queued.job.artworkToken, 2)
})

test('missing or invalid track cues cannot become a timestamp at zero', () => {
  const context = mainFunctions('function normalizeTrack(', 'function normalizeTracks(', {})
  for (const cueSeconds of [null, undefined, '', -1, Infinity, 'invalid']) {
    const track = context.normalizeTrack({ cueSeconds, hasTimestamp: true }, 0, 'test')
    assert.equal(track.cueSeconds, null)
    assert.equal(track.hasTimestamp, false)
    assert.equal(track.noTimestamp, true)
  }
  assert.equal(context.normalizeTrack({ cueSeconds: 0 }, 0, 'test').hasTimestamp, true)
  assert.equal(context.normalizeTrack({ cueSeconds: 0, noTimestamp: true }, 0, 'test').hasTimestamp, false)
})

test('old casting cleanup cannot overwrite a replacement session status', async () => {
  let release
  const stopped = new Promise(resolve => { release = resolve })
  const context = mainFunctions('async function disposeCastingSession(', '// ── App lifecycle', {
    castingPreparationToken: 0,
    castingSession: { directory: '/test/old', encoder: { stop: () => stopped } },
    castingCaptureGrant: {},
    castingStatus: { status: 'casting' },
    sendCastingState() {},
    castingStateSnapshot() { return { status: context.castingStatus.status } },
    fs: { rmSync() {} },
  })
  const disposing = context.disposeCastingSession()
  context.castingSession = { sessionId: 'new' }
  context.castingStatus = { status: 'casting', target: 'new' }
  release()
  await disposing
  assert.equal(context.castingStatus.target, 'new')
})

test('Windows and Linux casting cannot start discovery or prepare media resources', async () => {
  const { castingSupportForPlatform } = require('../lib/casting-support')
  for (const platform of ['win32', 'linux']) {
    const context = mainFunctions('function initializeTvDiscovery(', '// ── App lifecycle', {
      CASTING_SUPPORT: castingSupportForPlatform(platform),
      tvDiscovery: null,
      TvDiscovery: class { constructor() { throw new Error('Discovery must not start') } },
    })
    context.initializeTvDiscovery()
    await assert.rejects(context.prepareCastingSession('tv'), /macOS only.*coming soon/)
    await assert.rejects(context.startPreparedCastingSession('session'), /macOS only.*coming soon/)
    assert.equal(context.tvDiscovery, null)
  }
})

test('a stale casting startup failure does not stop the replacement session', async () => {
  let rejectReady
  const ready = new Promise((_, reject) => { rejectReady = reject })
  const context = mainFunctions('async function disposeCastingSession(', '// ── App lifecycle', {
    castingPreparationToken: 0,
    castingSession: { sessionId: 'old', target: { protocol: 'airplay' }, encoder: { ready } },
    castingStateSnapshot() { return {} },
    setCastingStatus() {},
    log() {},
  })
  const startup = context.startPreparedCastingSession('old')
  const replacement = { sessionId: 'new' }
  context.castingSession = replacement
  rejectReady(new Error('old encoder failed'))
  await assert.rejects(startup, /old encoder failed/)
  assert.equal(context.castingSession, replacement)
})

test('browser source failures release navigation for the next valid selection', async () => {
  let loads = 0
  const contents = new EventEmitter()
  contents.id = 1
  const youtube = require('../plugins/sources/youtube')
  const context = mainFunctions('function wireWebview(', '// ── Updates', {
    attachedWebviews: new Map(),
    playerWvContents: null,
    browserWvContents: contents,
    wireYouTubePlayerUi() {},
    log() {},
    plugins: { SOURCES: [youtube] },
    handleSourceUrl: async () => { if (++loads === 1) throw new Error('provider failed') },
    mainWindow: { isDestroyed: () => false, webContents: { send() {} } },
  })
  context.wireWebview(contents)
  const intercept = contents.listeners('console-message')[0]
  await intercept({ message: '__INTERCEPT__youtube__https://example.org/watch?v=bad' })
  assert.equal(loads, 0)
  await intercept({ message: '__INTERCEPT__youtube__https://www.youtube.com/watch?v=first' })
  await intercept({ message: '__INTERCEPT__youtube__https://www.youtube.com/watch?v=second' })
  assert.equal(loads, 2)
})
