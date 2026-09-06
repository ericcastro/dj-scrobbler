const test = require('node:test')
const assert = require('node:assert/strict')

const { hasSetMetadata, normalizeSetMetadata } = require('../lib/set-metadata')

test('set metadata normalizes only supported set79 fields', () => {
  assert.deepEqual(normalizeSetMetadata({
    djNames: ['  Enei ', 'Simula', 'Enei', '', null],
    venue: '  Anara Forest ',
    event: ' Boomtown ',
    date: '2025-08-09',
    description: 'must not pass through',
  }), {
    djNames: ['Enei', 'Simula'],
    venue: 'Anara Forest',
    event: 'Boomtown',
    date: '2025-08-09',
  })
})

test('set metadata rejects malformed values without inventing replacements', () => {
  const normalized = normalizeSetMetadata({
    djNames: 'Enei',
    venue: '',
    event: 123,
    date: '9 Aug 2025',
  })

  assert.deepEqual(normalized, { djNames: [], venue: null, event: null, date: null })
  assert.equal(hasSetMetadata(normalized), false)
  assert.equal(hasSetMetadata(normalizeSetMetadata({ djNames: ['Enei'] })), true)
})
