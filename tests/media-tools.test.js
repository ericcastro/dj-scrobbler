const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { assetsFor } = require('../scripts/media-tool-assets')
const { executableName, resolveMediaTool } = require('../lib/media-tools')

test('media tool asset manifest covers every packaged target', () => {
  for (const [platform, arch] of [
    ['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'arm64'], ['linux', 'x64'], ['win32', 'x64'],
  ]) {
    const assets = assetsFor(platform, arch)
    assert.deepEqual(assets.map(asset => asset.tool), ['ffmpeg', 'ffmpeg-license', 'yt-dlp', 'yt-dlp-license'])
    for (const asset of assets) assert.match(asset.sha256, /^[a-f0-9]{64}$/)
  }
})

test('packaged media tools resolve only from application resources', () => {
  const resourcesPath = path.join(path.sep, 'Applications', 'DJ Scrobbler', 'resources')
  const expected = path.join(resourcesPath, 'bin', 'ffmpeg.exe')
  assert.equal(resolveMediaTool('ffmpeg', {
    platform: 'win32', isPackaged: true, resourcesPath, existsSync: value => value === expected, env: {},
  }), expected)
  assert.throws(() => resolveMediaTool('yt-dlp', {
    platform: 'win32', isPackaged: true, resourcesPath, existsSync: () => false, env: {},
  }), /missing from the application bundle/)
})

test('development and explicit overrides remain available', () => {
  assert.equal(executableName('yt-dlp', 'win32'), 'yt-dlp.exe')
  assert.equal(resolveMediaTool('yt-dlp', { platform: 'linux', isPackaged: false, env: {} }), 'yt-dlp')
  assert.equal(resolveMediaTool('ffmpeg', { platform: 'linux', isPackaged: true, env: { DJ_SCROBBLER_FFMPEG: '/custom/ffmpeg' } }), '/custom/ffmpeg')
})
