const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')
const { assetsFor } = require('../scripts/media-tool-assets')
const { developmentMediaToolsDirectory, executableName, resolveMediaTool } = require('../lib/media-tools')
const { assertRedistributableFfmpeg } = require('../scripts/prepare-media-tools')

test('media tool asset manifest covers every packaged target', () => {
  for (const [platform, arch] of [
    ['darwin', 'arm64'], ['darwin', 'x64'], ['linux', 'arm64'], ['linux', 'x64'], ['win32', 'x64'],
  ]) {
    const assets = assetsFor(platform, arch)
    assert.deepEqual(assets.map(asset => asset.tool), ['ffmpeg', 'ffmpeg-license', 'yt-dlp', 'yt-dlp-license'])
    for (const asset of assets) assert.match(asset.sha256, /^[a-f0-9]{64}$/)
  }
})

test('every FFmpeg target uses pinned upstream source with the complete LGPL text', () => {
  for (const [platform, arch] of [['darwin', 'arm64'], ['darwin', 'x64'], ['win32', 'x64'], ['linux', 'x64'], ['linux', 'arm64']]) {
    const [ffmpeg, license] = assetsFor(platform, arch)
    assert.equal(ffmpeg.buildFromSource, true)
    assert.equal(new URL(ffmpeg.url).hostname, 'ffmpeg.org')
    assert.match(license.url, /COPYING\.LGPLv2\.1$/)
  }
})

test('packaging refuses FFmpeg binaries that report nonfree or unreadable licensing', () => {
  const check = report => assertRedistributableFfmpeg('ffmpeg', () => ({ status: 0, stdout: report, stderr: '' }))
  assert.doesNotThrow(() => check('GNU Lesser General Public License version 2.1 or later'))
  assert.doesNotThrow(() => check('GNU Lesser General Public\nLicense version 2.1 or later'))
  assert.doesNotThrow(() => check('GNU General Public License version 3 or later'))
  assert.throws(() => check('This version of ffmpeg has nonfree parts compiled in. Therefore it is not legally redistributable.'), /Refusing/)
  assert.throws(() => check('GNU General Public License\nconfiguration: --enable-nonfree'), /Refusing/)
  assert.throws(() => check(''), /recognized license/)
  assert.throws(() => assertRedistributableFfmpeg('ffmpeg', () => ({ status: 1 })), /Refusing/)
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

test('development resolves the project-managed pinned tools instead of PATH', () => {
  assert.equal(executableName('yt-dlp', 'win32'), 'yt-dlp.exe')
  const projectRoot = path.join(path.sep, 'workspace', 'dj-scrobbler')
  const expectedDirectory = path.join(projectRoot, 'node_modules', '.cache', 'dj-scrobbler-media-tools', 'runtime-linux-arm64')
  const expected = path.join(expectedDirectory, 'yt-dlp')
  assert.equal(developmentMediaToolsDirectory({ platform: 'linux', arch: 'arm64', projectRoot }), expectedDirectory)
  assert.equal(resolveMediaTool('yt-dlp', {
    platform: 'linux', arch: 'arm64', projectRoot, isPackaged: false, env: {}, existsSync: value => value === expected,
  }), expected)
  assert.throws(() => resolveMediaTool('yt-dlp', {
    platform: 'linux', arch: 'arm64', projectRoot, isPackaged: false, env: {}, existsSync: () => false,
  }), /Run npm run prepare:media/)
  assert.equal(resolveMediaTool('ffmpeg', { platform: 'linux', isPackaged: true, env: { DJ_SCROBBLER_FFMPEG: '/custom/ffmpeg' } }), '/custom/ffmpeg')
})
