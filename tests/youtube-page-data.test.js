const test = require('node:test')
const assert = require('node:assert/strict')

const {
  mergeConfirmedYouTubeArtists,
  parseYouTubeArtists,
  parseYouTubeCollaborators,
} = require('../lib/youtube-page-data')

function page(data) {
  return `<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`
}

function artistItem(name, channelId, { official = true } = {}) {
  return {
    listItemViewModel: {
      title: {
        content: name,
        commandRuns: [{ onTap: { innertubeCommand: { browseEndpoint: { browseId: channelId } } } }],
        attachmentRuns: official ? [{
          element: { type: { imageType: { image: { sources: [{ clientResource: { imageName: 'AUDIO_BADGE' } }] } } } },
        }] : [],
      },
      subtitle: { content: `@${name.toLowerCase().replace(/\s+/g, '')} • 10K subscribers` },
    },
  }
}

function collaboratorDialog(items) {
  return {
    showDialogCommand: {
      panelLoadingStrategy: {
        inlineContent: {
          dialogViewModel: {
            header: { dialogHeaderViewModel: { headline: { content: 'Collaborators' } } },
            customContent: { listViewModel: { listItems: items } },
          },
        },
      },
    },
  }
}

function watchPage(primaryItems, secondaryItems = []) {
  return page({
    contents: {
      twoColumnWatchNextResults: {
        results: {
          results: {
            contents: [{
              videoSecondaryInfoRenderer: {
                owner: { videoOwnerRenderer: { navigationEndpoint: collaboratorDialog(primaryItems) } },
              },
            }],
          },
        },
        secondaryResults: { results: [{ navigationEndpoint: collaboratorDialog(secondaryItems) }] },
      },
    },
  })
}

test('YouTube DJ discovery accepts only official artists from the selected video collaborator dialog', () => {
  const html = watchPage([
    artistItem('Intercell', 'UCaaaaaaaaaaaaaaaaaaaaaa', { official: false }),
    artistItem('Funk Tribu', 'UCbbbbbbbbbbbbbbbbbbbbbb'),
    artistItem('VTSS', 'UCcccccccccccccccccccccc'),
    artistItem('Glitch Festival', 'UCdddddddddddddddddddddd', { official: false }),
    artistItem('Pegassi', 'UCeeeeeeeeeeeeeeeeeeeeee'),
  ], [artistItem('Unrelated recommendation', 'UCffffffffffffffffffffff')])

  assert.deepEqual(parseYouTubeArtists(html).map(artist => artist.name), ['Funk Tribu', 'VTSS', 'Pegassi'])
  assert.deepEqual(parseYouTubeCollaborators(html).map(item => [item.name, item.officialArtist]), [
    ['Intercell', false],
    ['Funk Tribu', true],
    ['VTSS', true],
    ['Glitch Festival', false],
    ['Pegassi', true],
  ])
  assert.deepEqual(parseYouTubeArtists(html).map(artist => artist.channelId), [
    'UCbbbbbbbbbbbbbbbbbbbbbb',
    'UCcccccccccccccccccccccc',
    'UCeeeeeeeeeeeeeeeeeeeeee',
  ])
})

test('Set79 can promote an exact unbadged collaborator without promoting event or production accounts', () => {
  const collaborators = [
    { name: 'Intercell', channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa', officialArtist: false },
    { name: 'Cloudy', channelId: 'UCbbbbbbbbbbbbbbbbbbbbbb', officialArtist: false },
    { name: 'Glitch Festival', channelId: 'UCcccccccccccccccccccccc', officialArtist: false },
  ]
  assert.deepEqual(
    mergeConfirmedYouTubeArtists([], collaborators, ['CLOUDY']),
    [{ name: 'Cloudy', channelId: 'UCbbbbbbbbbbbbbbbbbbbbbb' }],
  )
})
