const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { collectSignablePaths } = require('../scripts/afterPack')._test

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
