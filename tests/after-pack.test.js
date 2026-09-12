const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { buildAirPlayHelper, collectSignablePaths } = require('../scripts/afterPack')._test

test('macOS packaging builds the universal AirPlay helper into app resources', () => {
  const calls = []
  const appPath = path.join('/tmp', 'DJ Scrobbler.app')
  const destination = buildAirPlayHelper(appPath, '/project', (...args) => calls.push(args))
  assert.equal(destination, path.join(appPath, 'Contents', 'Resources', 'bin', 'dj-scrobbler-airplay'))
  assert.deepEqual(calls, [[
    '/bin/bash',
    ['/project/scripts/build-airplay-helper.sh', destination, '--universal'],
    { stdio: 'inherit' },
  ]])
})

test('macOS signing inventory is collected inside-out without following symlinks', {
  skip: process.platform !== 'darwin',
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-after-pack-'))
  try {
    const framework = path.join(root, 'Example.framework')
    const helper = path.join(framework, 'Helpers', 'Nested.app')
    fs.mkdirSync(path.join(helper, 'Contents', 'MacOS'), { recursive: true })
    const executable = path.join(helper, 'Contents', 'MacOS', 'Nested')
    fs.writeFileSync(executable, '')
    fs.chmodSync(executable, 0o755)
    fs.symlinkSync(helper, path.join(root, 'ignored.app'))

    const inventory = collectSignablePaths(root)
    assert.deepEqual(inventory.binaries, [executable])
    assert.deepEqual(inventory.bundles, [helper, framework])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
