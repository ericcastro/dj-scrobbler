const test = require('node:test')
const assert = require('node:assert/strict')

const comments = require('../lib/youtube-comments')
const provider = require('../plugins/tracklists/youtube-comments')
const plugins = require('../plugins')

const initialContinuation = Buffer.from('comments-section:first').toString('base64url')
const secondContinuation = Buffer.from('comments-section:second').toString('base64url')
const replyContinuation = Buffer.from('comment-replies:never').toString('base64url')

function watchPage() {
  return `<script>var ytInitialData = {"continuationCommand":{"token":"${initialContinuation}"}};</script>
    <script>var ytcfg={"INNERTUBE_API_KEY":"fixture-key","INNERTUBE_CLIENT_VERSION":"2.fixture","VISITOR_DATA":"fixture-visitor"};</script>`
}

function watchPageWithDescription(description) {
  return `<script>var ytInitialData = {"contents":{"twoColumnWatchNextResults":{"results":{"results":{"contents":[{"videoSecondaryInfoRenderer":{"attributedDescription":{"content":${JSON.stringify(description)}}}}]}}}},"continuationCommand":{"token":"${initialContinuation}"}};</script>
    <script>var ytcfg={"INNERTUBE_API_KEY":"fixture-key","INNERTUBE_CLIENT_VERSION":"2.fixture"};</script>`
}

function modernResponse(entries, { continuation = null } = {}) {
  return {
    frameworkUpdates: { entityBatchUpdate: { mutations: entries.map((entry, index) => ({
      payload: { commentEntityPayload: { key: `comment-${index}`, properties: {
        commentId: `comment-${index}`,
        content: { content: entry.content },
        authorButtonA11y: entry.author || '@listener',
        likeCount: entry.likes || 0,
        authorIsChannelOwner: !!entry.owner,
      } }, },
    })) } },
    ...(continuation ? { continuationContents: { itemSectionContinuation: { continuations: [{ nextContinuationData: { continuation } }] } } } : {}),
  }
}

test('YouTube comment parser splits one dash but preserves ambiguous multi-dash lines for Deezer verification', () => {
  const tracks = comments.parseTimestampedTracks(`00:58 SPFDJ - The Warmup [Unreleased]\n1:05:27 Kalus - Jump - Special Edit\n08:14 Major Lazer - pAPi wiTH tOKisCha`, 'spfdj')
  assert.equal(tracks.length, 3)
  assert.deepEqual(tracks.map(track => track.cueSeconds), [58, 3927, 494])
  assert.equal(tracks[1].cueDisplay, '1:05:27')
  assert.equal(tracks[0].artist, 'SPFDJ')
  assert.equal(tracks[0].title, 'The Warmup [Unreleased]')
  assert.equal(tracks[1].artist, 'ID')
  assert.equal(tracks[1].title, 'Kalus - Jump - Special Edit')
  assert.deepEqual(tracks[1].commentAmbiguousSplits, [
    { artist: 'Kalus', title: 'Jump - Special Edit' },
    { artist: 'Kalus - Jump', title: 'Special Edit' },
  ])
  assert.equal(tracks[2].artist, 'Major Lazer')
  assert.equal(tracks[1].commentTracklist, true)
})

test('comment parser treats em dashes like hyphens and keeps no-dash text as a manual ID', () => {
  const tracks = comments.parseTimestampedTracks('0:00 Artist — A Track\n1:00 A-Track - Like I Said\n2:00 Untitled ID', 'dashes')
  assert.deepEqual([tracks[0].artist, tracks[0].title], ['Artist', 'A Track'])
  assert.equal(tracks[1].artist, 'ID')
  assert.deepEqual(tracks[1].commentAmbiguousSplits, [
    { artist: 'A', title: 'Track - Like I Said' },
    { artist: 'A-Track', title: 'Like I Said' },
  ])
  assert.deepEqual([tracks[2].artist, tracks[2].title], ['ID', 'Untitled ID'])
})

test('accepted YouTube tracklists are ordered for playback without changing edit identities', () => {
  const tracks = comments.parseTimestampedTracks('0:00 A - One\n3:00 C - Three\n2:00 B - Two\n4:00 D - Four', 'ordered')
  assert.equal(comments.isCredibleTimestampTracklist(tracks), true)
  const normalized = provider.normalizeTracklist(tracks)
  assert.deepEqual(normalized.map(track => track.cueSeconds), [0, 120, 180, 240])
  assert.deepEqual(normalized.map(track => track.trackNum), [1, 2, 3, 4])
  assert.equal(normalized[1].providerTrackId, tracks[2].providerTrackId)
  assert.deepEqual(tracks.map(track => track.cueSeconds), [0, 180, 120, 240])
})

test('malformed comment timestamps and non-track prose are ignored', () => {
  const tracks = comments.parseTimestampedTracks(`hello 12:99 nope\n00:01\n99:00 okay\n01:02 actual one\n01:02 duplicate\n1:61:00 invalid`, 'bad')
  assert.deepEqual(tracks.map(track => [track.cueSeconds, track.title]), [[5940, 'okay'], [62, 'actual one']])
  assert.equal(comments.parseTimestamp('not a timestamp'), null)
  assert.equal(comments.parseTimestamp('01:60'), null)
})

test('candidate rank is dominated by timestamp coverage, then likes, ownership signal and first-batch position', () => {
  const ranked = comments.rankCommentCandidates([
    { id: 'first', content: '0:00 A\n1:00 B\n2:00 C\n3:00 D', author: '@random', likes: 2, position: 0 },
    { id: 'owner', content: '0:00 A\n1:00 B\n2:00 C\n3:00 D', author: '@SPFDJ', likes: 1, owner: true, position: 7 },
    { id: 'rich', content: '0:00 A\n1:00 B\n2:00 C\n3:00 D\n4:00 E', author: '@other', likes: 0, position: 9 },
  ], { channel: 'SPFDJ' })
  assert.equal(ranked[0].id, 'rich', 'an extra credible timestamp outweighs authorship preference')
  assert.equal(ranked.find(item => item.id === 'owner').owner, true)
})

test('watch bootstrap takes the canonical page continuation and avoids reply continuations', () => {
  const bootstrap = comments.extractWatchBootstrap(watchPage())
  assert.deepEqual(bootstrap, {
    apiKey: 'fixture-key', clientName: 'WEB', clientVersion: '2.fixture', visitorData: 'fixture-visitor', continuation: initialContinuation,
  })
  assert.equal(comments.continuationFromResponse(modernResponse([], { continuation: replyContinuation })), null)
  assert.equal(comments.continuationFromResponse(modernResponse([], { continuation: secondContinuation })), secondContinuation)
})

test('provider contract fetches only first batch when it already has a credible comment tracklist', async () => {
  let calls = 0
  const candidate = await provider._test.findCommentTracklist({
    title: 'SPFDJ live', channel: 'SPFDJ', watchPagePromise: Promise.resolve(watchPage()),
  }, async () => {
    calls++
    return modernResponse([{ owner: true, author: '@SPFDJ', likes: 90, content: '00:00 A - One\n01:00 B - Two\n02:00 C - Three' }], { continuation: secondContinuation })
  })
  assert.equal(calls, 1)
  assert.equal(candidate.tracks.length, 3)
})

test('an official timestamped description wins before comments are requested', async () => {
  let calls = 0
  const candidate = await provider._test.findCommentTracklist({
    watchPagePromise: Promise.resolve(watchPageWithDescription('00:00 Muse - First\n10:45 Muse - Second\n20:30 Muse - Third')),
  }, async () => {
    calls++
    return modernResponse([])
  })
  assert.equal(calls, 0)
  assert.equal(candidate.type, 'description')
  assert.deepEqual(candidate.tracks.map(track => track.cueSeconds), [0, 645, 1230])
})

test('provider contract makes at most one continuation request, then gives up cleanly', async () => {
  let calls = 0
  const candidate = await provider._test.findCommentTracklist({ watchPagePromise: Promise.resolve(watchPage()) }, async () => {
    calls++
    return calls === 1
      ? modernResponse([{ content: '0:00 only one', author: '@a' }], { continuation: secondContinuation })
      : modernResponse([{ content: 'chat only', author: '@b' }], { continuation: secondContinuation })
  })
  assert.equal(candidate, null)
  assert.equal(calls, 2)
})

test('YouTube comments is registered as the first automatic fallback and selectable source', () => {
  assert.equal(plugins.tracklistForSource('youtube').id, '1001tracklists')
  assert.deepEqual(plugins.automaticFallbackTracklistsForSource('youtube').map(item => item.id), ['youtube-comments', 'set79'])
  assert.equal(plugins.tracklistById('youtube-comments'), provider)
})
