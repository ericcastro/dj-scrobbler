const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const vm = require('node:vm')
const {
  buildYouTubeQualityScript,
  chooseYouTubeQuality,
  forceYouTubePlaybackQuality,
  wireYouTubePlayerUi,
  isYouTubePlayerUrl,
  isYouTubeEmbedUrl,
  isYouTubeControlsEmbedUrl,
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
  assert.equal(isYouTubeEmbedUrl(EMBED_URL.replace('controls=0', 'controls=1')), true)
  assert.equal(isYouTubeControlsEmbedUrl(EMBED_URL), false)
  assert.equal(isYouTubeControlsEmbedUrl(EMBED_URL.replace('controls=0', 'controls=1')), true)
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

test('controls-enabled embeds retain the DOM but receive visually hidden player styling', () => {
  const { child } = fixture({ embedUrl: EMBED_URL.replace('controls=0', 'controls=1') })
  child.emit('dom-ready')
  assert.ok(child.calls > 0)
  assert.match(child.document.children[0].textContent, /player-control-overlay/)
})

test('quality selection picks the smallest explicit resolution meeting the target', () => {
  const labels = ['Auto (480p)', '2160p', '720p', '1080p Premium', '1080p', '1440p']
  assert.deepEqual(chooseYouTubeQuality(labels, 1080), { label: '1080p', height: 1080 })
  assert.deepEqual(chooseYouTubeQuality(labels, 2000), { label: '2160p', height: 2160 })
  assert.equal(chooseYouTubeQuality(['Auto', 'Higher picture quality'], 1080), null)
})

test('quality script drives the controls menu and verifies the decoded resolution', async () => {
  let menu = 'closed'
  const video = { clientHeight: 720, videoHeight: 480 }
  const element = (label, click) => ({
    textContent: label,
    getAttribute: name => name === 'aria-label' ? label : null,
    click,
  })
  const settings = element('Playback settings', () => { menu = 'settings' })
  const quality = element('Quality 480p', () => { menu = 'quality' })
  const p720 = element('720p', () => { video.videoHeight = 720 })
  const p1080 = element('1080p', () => { video.videoHeight = 1080 })
  const document = {
    documentElement: { clientHeight: 720 },
    querySelector: selector => {
      if (selector === 'video') return video
      if (selector === '#player-controls-a11y-toggle') return null
      if (selector.includes('Playback settings')) return settings
      return null
    },
    querySelectorAll: () => menu === 'settings' ? [quality] : menu === 'quality' ? [p720, p1080] : [],
  }
  const result = await vm.runInNewContext(buildYouTubeQualityScript(1080), {
    location: { href: EMBED_URL.replace('controls=0', 'controls=1') },
    URL,
    document,
    devicePixelRatio: 1,
    setTimeout,
  })
  assert.equal(result.status, 'selected')
  assert.equal(result.selectedHeight, 1080)
  assert.equal(result.afterHeight, 1080)
  assert.equal(result.verified, true)
})

test('quality script follows the newer sheet menu through Advanced', async () => {
  let menu = 'closed'
  const video = { clientHeight: 1080, videoHeight: 480 }
  const element = (label, click) => ({
    textContent: label,
    getAttribute: name => name === 'aria-label' ? label : null,
    closest() { return this },
    click,
  })
  const settings = element('Playback settings', () => { menu = 'settings' })
  const quality = element('Quality 480p', () => { menu = 'policy' })
  const advanced = element('Advanced', () => { menu = 'quality' })
  const p1080 = element('1080p', () => { video.videoHeight = 1080 })
  const p1440 = element('1440p', () => { video.videoHeight = 1440 })
  const document = {
    documentElement: { clientHeight: 1080 },
    querySelector: selector => {
      if (selector === 'video') return video
      if (selector === '#player-controls-a11y-toggle') return null
      if (selector.includes('Playback settings')) return settings
      return null
    },
    querySelectorAll: () => {
      if (menu === 'settings') return [quality]
      if (menu === 'policy') return [advanced]
      if (menu === 'quality') return [p1080, p1440]
      return []
    },
  }
  const result = await vm.runInNewContext(buildYouTubeQualityScript(1080), {
    location: { href: EMBED_URL.replace('controls=0', 'controls=1') },
    URL,
    document,
    devicePixelRatio: 1,
    setTimeout,
  })
  assert.equal(result.status, 'selected')
  assert.equal(result.selectedHeight, 1080)
  assert.equal(result.verified, true)
})

test('quality driver executes only in the exact controls-enabled YouTube subframe', async () => {
  const main = new Frame(PLAYER_URL)
  const decoy = new Frame('https://www.youtube.com/watch?v=abcdefghijk')
  const target = new Frame(EMBED_URL.replace('controls=0', 'controls=1'))
  let userGesture = null
  target.executeJavaScript = async (_script, gesture) => {
    userGesture = gesture
    return { status: 'selected', selectedHeight: 1080 }
  }
  main.framesInSubtree = [main, decoy, target]
  const contents = {
    mainFrame: main,
    getURL: () => PLAYER_URL,
    isDestroyed: () => false,
  }
  const result = await forceYouTubePlaybackQuality(contents, { attempts: 1 })
  assert.equal(result.selectedHeight, 1080)
  assert.equal(userGesture, true)
  assert.equal(decoy.calls, 0)
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
