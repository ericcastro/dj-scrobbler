const test = require('node:test')
const assert = require('node:assert/strict')
const { castingSupportForPlatform } = require('../lib/casting-support')

test('casting is experimental on macOS and unavailable on Windows/Linux', () => {
  assert.equal(castingSupportForPlatform('darwin').supported, true)
  for (const platform of ['darwin', 'win32', 'linux']) {
    const support = castingSupportForPlatform(platform)
    assert.equal(support.experimental, true)
    assert.equal(support.supported, platform === 'darwin')
    assert.match(support.availabilityMessage, /Windows and Linux support is coming soon/)
  }
})
