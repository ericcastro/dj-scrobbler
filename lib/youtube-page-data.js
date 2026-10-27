const { normalizeWords } = require('./event-lookup-core')

function extractJsonObject(text, objectStart) {
  if (objectStart < 0 || text[objectStart] !== '{') return null
  let depth = 0
  let quote = null
  let escaped = false

  for (let index = objectStart; index < text.length; index++) {
    const character = text[index]
    if (quote) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") {
      quote = character
      continue
    }
    if (character === '{') depth++
    else if (character === '}' && --depth === 0) {
      try { return JSON.parse(text.slice(objectStart, index + 1)) } catch { return null }
    }
  }
  return null
}

function extractInitialData(html) {
  const text = String(html || '')
  const markers = ['var ytInitialData =', 'window["ytInitialData"] =', 'ytInitialData =']
  for (const marker of markers) {
    const markerIndex = text.indexOf(marker)
    if (markerIndex < 0) continue
    const data = extractJsonObject(text, text.indexOf('{', markerIndex + marker.length))
    if (data) return data
  }
  return null
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return
  visit(value)
  if (Array.isArray(value)) value.forEach(item => walk(item, visit))
  else Object.values(value).forEach(item => walk(item, visit))
}

function displayText(value) {
  if (typeof value === 'string') return value.trim()
  if (!value || typeof value !== 'object') return ''
  if (typeof value.content === 'string') return value.content.trim()
  if (typeof value.simpleText === 'string') return value.simpleText.trim()
  if (Array.isArray(value.runs)) return value.runs.map(run => run.text || '').join('').trim()
  return ''
}

function firstBrowseId(value) {
  let found = null
  walk(value, item => {
    if (!found && /^UC[A-Za-z0-9_-]{20,}$/.test(item.browseEndpoint?.browseId || '')) {
      found = item.browseEndpoint.browseId
    }
  })
  return found
}

function hasAudioBadge(title) {
  return (title?.attachmentRuns || []).some(run => (
    run?.element?.type?.imageType?.image?.sources?.some(source => source?.clientResource?.imageName === 'AUDIO_BADGE')
  ))
}

function hasVerifiedArtistBadge(badges) {
  return (badges || []).some(badge => {
    const renderer = badge?.metadataBadgeRenderer || badge?.badgeViewModel || badge
    return renderer?.style === 'BADGE_STYLE_TYPE_VERIFIED_ARTIST' ||
      renderer?.badgeStyle === 'BADGE_STYLE_TYPE_VERIFIED_ARTIST' ||
      /official artist channel/i.test(renderer?.tooltip || renderer?.accessibilityData?.label || '')
  })
}

function collaboratorFromListItem(item) {
  const model = item?.listItemViewModel
  if (!model) return null
  const name = displayText(model.title)
  const channelId = firstBrowseId(model.title)
  if (!name || !channelId) return null
  const subtitle = displayText(model.subtitle)
  return {
    name,
    channelId,
    handle: subtitle.match(/@[^\s⁩•]+/)?.[0] || null,
    officialArtist: hasAudioBadge(model.title),
  }
}

function selectedVideoOwner(data) {
  const primaryContents = data?.contents?.twoColumnWatchNextResults?.results?.results?.contents || []
  return primaryContents.find(item => item.videoSecondaryInfoRenderer)
    ?.videoSecondaryInfoRenderer?.owner?.videoOwnerRenderer || null
}

function parseYouTubeCollaborators(html) {
  const data = extractInitialData(html)
  if (!data) return []
  const collaborators = []
  const owner = selectedVideoOwner(data)
  if (!owner) return []

  walk(owner.navigationEndpoint, item => {
    const dialog = item.dialogViewModel
    const headline = displayText(dialog?.header?.dialogHeaderViewModel?.headline)
    if (!dialog || headline.toLowerCase() !== 'collaborators') return
    const listItems = dialog.customContent?.listViewModel?.listItems || []
    listItems.map(collaboratorFromListItem).filter(Boolean).forEach(item => collaborators.push(item))
  })

  // Older watch layouts expose a conventional owner instead of the newer
  // collaborator dialog. Only inspect its direct badges so artist credits or
  // nested collaborator data cannot accidentally turn the uploader into a DJ.
  if (hasVerifiedArtistBadge(owner.badges)) {
    const name = displayText(owner.title)
    const channelId = firstBrowseId(owner.navigationEndpoint || owner.title)
    if (name && channelId) collaborators.push({ name, channelId, handle: null, officialArtist: true })
  }

  const seen = new Set()
  return collaborators.filter(item => {
    if (seen.has(item.channelId)) return false
    seen.add(item.channelId)
    return true
  }).slice(0, 8)
}

function parseYouTubeArtists(html) {
  return parseYouTubeCollaborators(html)
    .filter(item => item.officialArtist)
    .map(({ officialArtist: _officialArtist, ...artist }) => artist)
}

function mergeConfirmedYouTubeArtists(existing, collaborators, djNames) {
  const confirmedNames = new Set((djNames || []).map(normalizeWords).filter(Boolean))
  const confirmedCollaborators = (collaborators || [])
    .filter(item => confirmedNames.has(normalizeWords(item?.name)))
    .map(({ officialArtist: _officialArtist, ...artist }) => artist)
  return [...new Map(
    [...(existing || []), ...confirmedCollaborators]
      .filter(item => item?.channelId)
      .map(item => [item.channelId, item]),
  ).values()]
}

module.exports = {
  displayText,
  extractInitialData,
  walk,
  mergeConfirmedYouTubeArtists,
  parseYouTubeArtists,
  parseYouTubeCollaborators,
}
