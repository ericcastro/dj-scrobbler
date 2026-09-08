const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { writeJsonAtomic } = require('../lib/atomic-json')

test('atomic JSON writes replace the destination and leave no temporary file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-scrobbler-json-'))
  const destination = path.join(directory, 'store.json')
  try {
    fs.writeFileSync(destination, '{"old":true}')
    writeJsonAtomic(destination, { next: true })

    assert.deepEqual(JSON.parse(fs.readFileSync(destination, 'utf8')), { next: true })
    assert.equal(fs.existsSync(`${destination}.${process.pid}.tmp`), false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('a serialization failure preserves the previous destination', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-scrobbler-json-'))
  const destination = path.join(directory, 'store.json')
  try {
    fs.writeFileSync(destination, '{"safe":true}')
    const circular = {}
    circular.self = circular

    assert.throws(() => writeJsonAtomic(destination, circular), /circular/i)
    assert.equal(fs.readFileSync(destination, 'utf8'), '{"safe":true}')
    assert.equal(fs.existsSync(`${destination}.${process.pid}.tmp`), false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
