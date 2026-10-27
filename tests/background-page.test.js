const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { extractFromBackgroundPage } = require('../lib/background-page')

function fixture(extract = async () => 'tracks', timeoutMs = 1000) {
  let window
  class FakeWindow extends EventEmitter {
    constructor() {
      super()
      window = this
      this.destroyed = false
      this.webContents = new EventEmitter()
      this.webContents.setWindowOpenHandler = handler => { this.popupHandler = handler }
    }
    isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.emit('closed') }
    loadURL() { return this.navigation = new Promise((resolve, reject) => { this.rejectNavigation = reject }) }
  }
  const pending = extractFromBackgroundPage({ BrowserWindow: FakeWindow, url: 'https://provider.test', timeoutMs, fallback: null, extract })
  return { window, pending }
}

test('background page extraction closes its window and denies popups', async () => {
  const { window, pending } = fixture()
  assert.deepEqual(window.popupHandler(), { action: 'deny' })
  window.webContents.emit('did-finish-load')
  assert.equal(await pending, 'tracks')
  assert.equal(window.destroyed, true)
})

test('background page navigation rejection is handled without waiting for timeout', async () => {
  const { window, pending } = fixture()
  window.rejectNavigation(new Error('navigation rejected'))
  assert.equal(await pending, null)
  assert.equal(window.destroyed, true)
})

test('background page timeout closes a window even when extraction never resolves', async () => {
  const { window, pending } = fixture(() => new Promise(() => {}), 10)
  window.webContents.emit('did-finish-load')
  assert.equal(await pending, null)
  assert.equal(window.destroyed, true)
})

test('background pages ignore subframe failures and extract only once', async () => {
  let calls = 0
  const { window, pending } = fixture(async () => { calls++; return 'tracks' })
  window.webContents.emit('did-fail-load', {}, -1, 'subframe', '', false)
  assert.equal(window.destroyed, false)
  window.webContents.emit('did-finish-load')
  window.webContents.emit('did-finish-load')
  assert.equal(await pending, 'tracks')
  assert.equal(calls, 1)
})

test('background page renderer crashes and extraction errors return the fallback', async () => {
  const crashed = fixture()
  crashed.window.webContents.emit('render-process-gone')
  assert.equal(await crashed.pending, null)
  const failed = fixture(async () => { throw new Error('extraction failed') })
  failed.window.webContents.emit('did-finish-load')
  assert.equal(await failed.pending, null)
  assert.equal(failed.window.destroyed, true)
})
