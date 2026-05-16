const test = require('node:test')
const assert = require('node:assert/strict')

const {
  cleanVersion,
  compareVersions,
  releaseFromGitHub,
  releaseFromUpdateInfo,
  mergeUpdateStatus,
} = require('../lib/update-utils')

test('version comparison accepts GitHub tags and plain versions', () => {
  assert.equal(cleanVersion('v0.4.3'), '0.4.3')
  assert.equal(compareVersions('v0.4.3', '0.3.0') > 0, true)
  assert.equal(compareVersions('0.4.3', 'v0.4.3'), 0)
  assert.equal(compareVersions('0.4.2', '0.4.3') < 0, true)
})

test('GitHub releases become update dialog payloads', () => {
  const update = releaseFromGitHub({
    tag_name: 'v0.4.3',
    name: '0.4.3',
    html_url: 'https://github.com/ericcastro/dj-scrobbler/releases/tag/v0.4.3',
    body: 'Fix tracklist loading',
    prerelease: true,
    published_at: '2026-05-01T00:00:00Z',
  }, {
    currentVersion: '0.3.0',
    releasesUrl: 'https://github.com/ericcastro/dj-scrobbler/releases',
  })

  assert.equal(update.currentVersion, '0.3.0')
  assert.equal(update.latestVersion, '0.4.3')
  assert.equal(update.changelog, 'Fix tracklist loading')
  assert.equal(update.prerelease, true)
  assert.equal(update.canInstall, true)
})

test('electron-updater release notes are flattened into changelog text', () => {
  const update = releaseFromUpdateInfo({
    version: '0.5.0',
    releaseNotes: [{ note: 'One' }, { note: 'Two' }],
    releaseDate: '2026-05-02T00:00:00Z',
  }, {
    currentVersion: '0.4.0',
    releasesUrl: 'https://github.com/ericcastro/dj-scrobbler/releases',
    canInstall: true,
  })

  assert.equal(update.latestVersion, '0.5.0')
  assert.equal(update.changelog, 'One\n\nTwo')
  assert.equal(update.canInstall, true)
})

test('update state keeps a previous changelog when updater events omit it', () => {
  const previous = {
    status: 'available',
    latestVersion: '0.4.3',
    changelog: 'Release notes from GitHub',
    isChecking: false,
    error: null,
  }

  const next = mergeUpdateStatus(previous, 'downloading', {
    latestVersion: '0.4.3',
    progress: 42,
  })

  assert.equal(next.status, 'downloading')
  assert.equal(next.changelog, 'Release notes from GitHub')
  assert.equal(next.progress, 42)
})
