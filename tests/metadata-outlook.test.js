const test = require('node:test')
const assert = require('node:assert/strict')

const {
  LOW_VIEW_THRESHOLD,
  POPULAR_VIEW_THRESHOLD,
  classifyMetadataOutlook,
} = require('../lib/metadata-outlook')

const now = new Date('2026-09-07T12:00:00Z')

test('recent YouTube sets over the underground popularity threshold are likely to gain metadata', () => {
  assert.equal(classifyMetadataOutlook({
    publishedAt: '2026-06-01',
    viewCount: POPULAR_VIEW_THRESHOLD,
    now,
  }).kind, 'likely')
})

test('old YouTube sets below the low-play threshold are unlikely to gain metadata', () => {
  assert.equal(classifyMetadataOutlook({
    publishedAt: '2024-01-01',
    viewCount: LOW_VIEW_THRESHOLD - 1,
    now,
  }).kind, 'unlikely')
})

test('incomplete and middle-ground statistics stay uncertain', () => {
  assert.equal(classifyMetadataOutlook({ publishedAt: '2026-06-01', now }).kind, 'unknown')
  assert.equal(classifyMetadataOutlook({ publishedAt: '2025-01-01', viewCount: 50_000, now }).kind, 'unknown')
})
