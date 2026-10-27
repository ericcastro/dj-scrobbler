const test = require('node:test')
const assert = require('node:assert/strict')
const { isAllowedExternalUrl } = require('../lib/external-url')

test('external URLs allow web links on exact hosts or their subdomains and support email', () => {
  const hosts = ['youtube.com', 'github.com']
  assert.equal(isAllowedExternalUrl('https://www.youtube.com/watch?v=test', hosts), true)
  assert.equal(isAllowedExternalUrl('https://github.com/ericcastro/dj-scrobbler', hosts), true)
  assert.equal(isAllowedExternalUrl('mailto:support@example.com?subject=Hello', hosts), true)
  for (const url of ['https://notyoutube.com', 'https://youtube.com.example.org', 'https://youtube.com@example.org', 'file://youtube.com/tmp/app', 'custom://youtube.com/action', 'javascript:alert(1)', 'invalid']) {
    assert.equal(isAllowedExternalUrl(url, hosts), false, url)
  }
})
