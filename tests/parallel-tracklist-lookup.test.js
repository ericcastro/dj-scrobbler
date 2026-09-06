const test = require('node:test')
const assert = require('node:assert/strict')

const { startPrimaryWithFallback } = require('../lib/parallel-tracklist-lookup')

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const primaryProvider = { id: '1001tracklists' }
const fallbackProvider = { id: 'set79' }

test('automatic lookup starts set79 in parallel with the primary provider', async () => {
  const started = []
  const pending = {
    '1001tracklists': deferred(),
    set79: deferred(),
  }

  const lookups = startPrimaryWithFallback({
    primaryProvider,
    fallbackProvider,
    lookup(provider) {
      started.push(provider.id)
      return pending[provider.id].promise
    },
  })

  assert.deepEqual(started, ['1001tracklists', 'set79'])
  pending['1001tracklists'].resolve({ usable: true, tracks: [{}] })
  const choice = await lookups.selected
  assert.equal(choice.selected.provider.id, '1001tracklists')

  pending.set79.resolve({ usable: false })
  await lookups.fallback
})

test('an explicit fallback preference reverses selection for that set', async () => {
  const lookups = startPrimaryWithFallback({
    primaryProvider,
    fallbackProvider,
    preferredProviderId: 'set79',
    lookup(provider) {
      return Promise.resolve({ usable: true, tracks: [{ provider: provider.id }] })
    },
  })

  const choice = await lookups.selected
  assert.equal(choice.selected.provider.id, 'set79')
  assert.equal(choice.primary, null)
  await lookups.primary
})

test('set79 failure neither rejects nor delays a usable primary result', async () => {
  const fallback = deferred()
  const lookups = startPrimaryWithFallback({
    primaryProvider,
    fallbackProvider,
    lookup(provider) {
      if (provider.id === 'set79') return fallback.promise
      return Promise.resolve({ usable: true, tracks: [{}] })
    },
  })

  const choice = await lookups.selected
  assert.equal(choice.selected.provider.id, '1001tracklists')

  fallback.reject(new Error('set79 timed out'))
  const fallbackOutcome = await lookups.fallback
  assert.equal(fallbackOutcome.error.message, 'set79 timed out')
})

test('a usable set79 result is selected only when the primary has no usable tracklist', async () => {
  const lookups = startPrimaryWithFallback({
    primaryProvider,
    fallbackProvider,
    lookup(provider) {
      return Promise.resolve(provider.id === 'set79'
        ? { usable: true, tracks: [{ title: 'Fallback track' }] }
        : { usable: false, tracks: [] })
    },
  })

  const choice = await lookups.selected
  assert.equal(choice.selected.provider.id, 'set79')
  assert.equal(choice.primary.result.usable, false)
})

test('a primary failure still allows a usable set79 fallback', async () => {
  const lookups = startPrimaryWithFallback({
    primaryProvider,
    fallbackProvider,
    lookup(provider) {
      if (provider.id === '1001tracklists') return Promise.reject(new Error('primary unavailable'))
      return Promise.resolve({ usable: true, tracks: [{ title: 'Fallback track' }] })
    },
  })

  const choice = await lookups.selected
  assert.equal(choice.primary.error.message, 'primary unavailable')
  assert.equal(choice.selected.provider.id, 'set79')
})

test('provider failures are isolated and become outcomes', async () => {
  const lookups = startPrimaryWithFallback({
    primaryProvider,
    fallbackProvider,
    lookup(provider) {
      if (provider.id === '1001tracklists') throw new Error('primary failed')
      return Promise.reject(new Error('fallback failed'))
    },
  })

  const choice = await lookups.selected
  assert.equal(choice.selected, null)
  assert.equal(choice.primary.error.message, 'primary failed')
  assert.equal(choice.fallback.error.message, 'fallback failed')
})
