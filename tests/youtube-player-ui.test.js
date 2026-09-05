const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const vm = require('node:vm')
const {
  wireYouTubePlayerUi,
  isYouTubePlayerUrl,
  isYouTubeEmbedUrl,
  YOUTUBE_PLAYER_UI_SCRIPT,
  LEGACY_WRAPPER_UI_SCRIPT,
} = require('../lib/youtube-player-ui')

const PLAYER_URL = 'https://www.djscrobbler.com/embed/youtube?id=abcdefghijk'
const EMBED_URL = 'https://www.youtube.com/embed/abcdefghijk?controls=0'

function makeDocument() {
  const children = []
  return {
    children,
    head: { appendChild: element => children.push(element) },
    getElementById: id => children.find(element => element.id === id),
    createElement: tagName => ({ tagName, textContent: '' }),
  }
}

class Frame extends EventEmitter {
  constructor(url) {
    super()
    this.url = url
    this.document = makeDocument()
    this.calls = 0
    this.destroyed = false
    this.detached = false
  }

  isDestroyed() { return this.destroyed }

  async executeJavaScript(script) {
    this.calls++
    if (this.fail) throw new Error('Frame execution failed')
    return vm.runInNewContext(script, {
      location: { href: this.executionUrl || this.url },
      URL,
      document: this.document,
    })
  }
}

function fixture({ role = 'player', url = PLAYER_URL, embedUrl = EMBED_URL } = {}) {
  const contents = new EventEmitter()
  const main = new Frame(url)
  const child = new Frame(embedUrl)
  main.framesInSubtree = [main, child]
  contents.mainFrame = main
  contents.getURL = () => main.url
  contents.isDestroyed = () => !!contents.destroyed
  const errors = []
  const state = { role }
  wireYouTubePlayerUi(contents, () => state.role === 'player', error => errors.push(error))
  return { contents, main, child, errors, state }
}

test('only app-owned HTTPS wrappers and exact YouTube embed paths are eligible', () => {
  assert.equal(isYouTubePlayerUrl(PLAYER_URL), true)
  assert.equal(isYouTubePlayerUrl('https://djscrobbler.com/embed/youtube/?controls=1'), true)
  for (const value of [
    'http://www.djscrobbler.com/embed/youtube',
    'https://djscrobbler.com.evil.test/embed/youtube',
    'https://www.djscrobbler.com:444/embed/youtube',
    'https://www.djscrobbler.com/embed/youtube/another-page',
    'not a URL',
  ]) assert.equal(isYouTubePlayerUrl(value), false, value)

  assert.equal(isYouTubeEmbedUrl(EMBED_URL), true)
  assert.equal(isYouTubeEmbedUrl(EMBED_URL.replace('youtube.com', 'youtube-nocookie.com')), true)
  for (const value of [
    'https://www.youtube.com/watch?v=abcdefghijk',
    'https://www.youtube.com/embed/abcdefghijk/another-page',
    'https://www.youtube.com/embed/short',
    'https://www.youtube.com.evil.test/embed/abcdefghijk',
    'https://www.youtube.com:444/embed/abcdefghijk',
    'http://www.youtube.com/embed/abcdefghijk',
    `${EMBED_URL.replace('controls=0', 'controls=1')}`,
  ]) assert.equal(isYouTubeEmbedUrl(value), false, value)
})

test('existing player frames receive styles once in the DOM, including legacy mask compatibility', () => {
  const { contents, main, child } = fixture()
  assert.equal(main.document.children.length, 1)
  assert.equal(child.document.children.length, 1)
  const style = child.document.children[0]
  contents.emit('did-finish-load')
  child.emit('dom-ready')
  assert.equal(child.document.children.length, 1)
  assert.equal(child.document.children[0], style)
  assert.equal(child.listenerCount('dom-ready'), 1)
})

test('browser webviews and foreign wrappers never receive player styling', () => {
  for (const options of [
    { role: 'browser' },
    { url: 'https://www.youtube.com/watch?v=abcdefghijk' },
    { url: 'https://djscrobbler.com.evil.test/embed/youtube' },
  ]) {
    const { contents, main, child } = fixture(options)
    contents.emit('did-finish-load')
    child.emit('dom-ready')
    assert.equal(main.calls, 0)
    assert.equal(child.calls, 0)
  }
})

test('native controls opt-in leaves the actual YouTube UI available', () => {
  const { child } = fixture({ embedUrl: EMBED_URL.replace('controls=0', 'controls=1') })
  child.emit('dom-ready')
  assert.equal(child.calls, 0)
})

test('late-created, navigated, and replaced subframes are styled after readiness', () => {
  const { contents, main } = fixture()
  const late = new Frame('about:blank')
  contents.emit('frame-created', {}, { frame: late })
  assert.equal(late.calls, 0)
  late.url = EMBED_URL
  late.emit('dom-ready')
  assert.equal(late.document.children.length, 1)
  late.document = makeDocument()
  late.emit('dom-ready')
  assert.equal(late.document.children.length, 1, 'reload must receive a new style')

  late.destroyed = true
  const replacement = new Frame(EMBED_URL)
  contents.emit('frame-created', {}, { frame: replacement })
  assert.equal(replacement.document.children.length, 1)
  assert.equal(late.listenerCount('dom-ready'), 0, 'removed frames must be released')
  main.framesInSubtree = [main, replacement]
  contents.emit('did-finish-load')
  assert.equal(replacement.listenerCount('dom-ready'), 1)
})

test('a navigation between the host check and execution does not style another site', async () => {
  const document = makeDocument()
  for (const script of [YOUTUBE_PLAYER_UI_SCRIPT, LEGACY_WRAPPER_UI_SCRIPT]) {
    const result = vm.runInNewContext(script, {
      location: { href: 'https://example.com/embed/abcdefghijk' }, URL, document,
    })
    assert.equal(result, false)
  }
  assert.equal(document.children.length, 0)
})

test('a frame execution failure is reported and does not prevent the next ready attempt', async () => {
  const { child, errors } = fixture()
  child.document = makeDocument()
  child.fail = true
  child.emit('dom-ready')
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(errors.length, 1)
  child.fail = false
  child.emit('dom-ready')
  assert.equal(child.document.children.length, 1)
})

test('webview destruction removes listeners and stops further injection', () => {
  const { contents, main, child } = fixture()
  contents.destroyed = true
  contents.emit('destroyed')
  const calls = child.calls
  child.emit('dom-ready')
  contents.emit('did-finish-load')
  contents.emit('frame-created', {}, { frame: new Frame(EMBED_URL) })
  assert.equal(child.calls, calls)
  assert.equal(contents.listenerCount('frame-created'), 0)
  assert.equal(contents.listenerCount('did-finish-load'), 0)
  assert.equal(main.listenerCount('dom-ready'), 0)
  assert.equal(child.listenerCount('dom-ready'), 0)
})
