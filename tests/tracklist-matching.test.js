const test = require('node:test')
const assert = require('node:assert/strict')

const plugins = require('../plugins')

const cloudy = {
  title: 'Cloudy WE2 | Tomorrowland 2025',
  durationSeconds: (1 * 3600) + (31 * 60) + 37,
}

test('title matching tolerates one missing edition word', () => {
  assert.equal(plugins.titleSimilarity(cloudy, 'Cloudy | Tomorrowland 2025'), 75)
})

test('an exact duration carries more weight than a missing edition word', () => {
  const match = plugins.tracklistMatchScore(cloudy, {
    title: 'Cloudy | Tomorrowland 2025',
    durationSeconds: 5497,
  })

  assert.deepEqual(match, { score: 91, titleScore: 75, durationScore: 100 })
})

test('duration matching allows only a small margin', () => {
  assert.equal(plugins.durationSimilarity(5497, 5497), 100)
  assert.ok(plugins.durationSimilarity(5497, 5527) >= 75, '30 seconds should remain plausible')
  assert.equal(plugins.durationSimilarity(5497, 5558), 0, 'more than one minute must not match')
})

test('exact duration can outrank a perfect title with a conflicting duration', () => {
  const exactDuration = plugins.tracklistMatchScore(cloudy, {
    title: 'Cloudy | Tomorrowland 2025',
    durationSeconds: 5497,
  })
  const weakerTitle = plugins.tracklistMatchScore(cloudy, {
    title: 'Cloudy Tomorrowland',
    durationSeconds: 5000,
  })

  assert.ok(exactDuration.score > weakerTitle.score)
})

test('an unmistakable two-DJ event title survives a different platform edit length', () => {
  const title = 'VTSS b2b Marlon Hoffstadt at Intercell x VTSS Invites | ADE 2025'
  const match = plugins.tracklistMatchScore(
    { title, durationSeconds: 5040 },
    { title, durationSeconds: 5295 }
  )

  assert.deepEqual(match, { score: 100, titleScore: 100, durationScore: 0 })
})

test('a partial title with a conflicting duration still fails the provider threshold', () => {
  const match = plugins.tracklistMatchScore(cloudy, {
    title: 'Cloudy | Tomorrowland 2025',
    durationSeconds: 5000,
  })

  assert.equal(match.titleScore, 75)
  assert.ok(match.score < 40)
})

test('duration never overrides a blatantly different title', () => {
  const match = plugins.tracklistMatchScore(cloudy, {
    title: 'Charlotte de Witte | Tomorrowland 2025',
    durationSeconds: 5497,
  })

  assert.equal(match.score, 0)
})

test('missing duration preserves title-only ranking', () => {
  const match = plugins.tracklistMatchScore(cloudy, { title: 'Cloudy | Tomorrowland 2025' })
  assert.deepEqual(match, { score: 75, titleScore: 75, durationScore: null })
})
