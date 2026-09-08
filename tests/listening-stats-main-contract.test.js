const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const mainJs = fs.readFileSync(path.resolve(__dirname, '..', 'main.js'), 'utf8')

test('the main process owns listening-stat mutation and persistence', () => {
  assert.match(mainJs, /require\(['"]\.\/lib\/listening-stats['"]\)/)
  assert.match(mainJs, /function updateListeningStats\(poll, now\)/)
  assert.match(mainJs, /updateListeningStats\(poll, now\)/)
  assert.doesNotMatch(mainJs, /ipcMain\.handle\('stats-set'/)
  assert.match(mainJs, /webContents\.send\('stats-updated', readStats\(\)\)/)
})

test('validated listening samples also drive the Last.fm play threshold', () => {
  assert.match(mainJs, /const listenedMs = updateListeningStats\(poll, now\)/)
  assert.match(mainJs, /if \(lastTrackData\) currentTrackPlayedMs \+= listenedMs/)
  assert.doesNotMatch(mainJs, /function updatePlayAccumulator/)
})

test('player polling is serialized and ignores stale monitor generations', () => {
  const monitor = mainJs.slice(
    mainJs.indexOf('function startYouTubePlayerMonitoring'),
    mainJs.indexOf('function playerSeek')
  )
  assert.match(monitor, /let pollPending = false/)
  assert.match(monitor, /if \(pollPending\) return/)
  assert.match(monitor, /generation === monitorGeneration/)
  assert.match(mainJs, /function stopMonitoring[\s\S]*monitorGeneration\+\+/)
})

test('stats are flushed on pause, set shutdown, and application quit', () => {
  assert.match(mainJs, /if \(previous\?\.isPlaying && !poll\.isPlaying\) persistStatsNow\(\)/)
  assert.match(mainJs, /resetStatsPlayback\(\{ flush: true \}\)/)
  const beforeQuit = mainJs.slice(mainJs.indexOf("app.on('before-quit'"), mainJs.indexOf("app.on('window-all-closed'"))
  assert.match(beforeQuit, /persistStatsNow\(\)/)
})

test('late set metadata updates the stats set catalog', () => {
  const emitMetadata = mainJs.slice(
    mainJs.indexOf('function emitSetMetadata'),
    mainJs.indexOf('function sourceLinksForTracklist')
  )
  assert.match(emitMetadata, /if \(!currentStatsDjNames\.length\) currentStatsDjNames = metadata\.djNames \|\| \[\]/)
  assert.match(emitMetadata, /registerCurrentStatsSet\(\)/)
})

test('DJ metadata saved locally in history or favorites also reaches stats', () => {
  assert.match(mainJs, /function storedDjNamesForStats\(store, sourceUrl\)/)
  assert.match(mainJs, /currentStatsDjNames = storedDjNamesForStats\(readStore\(\), currentSourceUrl\)/)
  const storeHandler = mainJs.slice(
    mainJs.indexOf("ipcMain.handle('store-set'"),
    mainJs.indexOf('function validatedEventLocation')
  )
  assert.match(storeHandler, /syncCurrentStatsMetadataFromStore\(next\)/)
})

test('stats persistence uses the shared atomic JSON writer', () => {
  const persist = mainJs.slice(
    mainJs.indexOf('function persistStatsNow'),
    mainJs.indexOf('function markStatsDirty')
  )
  assert.match(mainJs, /require\(['"]\.\/lib\/atomic-json['"]\)/)
  assert.match(persist, /writeJsonAtomic\(statsPath, listeningStats\)/)
})
