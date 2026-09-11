const { earliestEvent, localToday } = require('../../lib/event-lookup-core')
const { createResidentAdvisorSource } = require('./resident-advisor')
const { createShotgunSource } = require('./shotgun')

const EVENTS = [createResidentAdvisorSource(), createShotgunSource()]

async function resolveLocation(location, options = {}) {
  const residentAdvisor = options.sources?.find(source => source.id === 'resident-advisor') ||
    EVENTS.find(source => source.id === 'resident-advisor')
  return residentAdvisor.resolveLocation(location)
}

async function lookupNextEvents({
  djNames,
  location,
  today = localToday(),
  sources = EVENTS,
  onError = () => {},
  onProgress = () => {},
  onResult = () => {},
}) {
  const names = [...new Set((djNames || []).map(name => String(name).trim()).filter(Boolean))].slice(0, 8)
  const results = []
  const sourcePlans = names.map(artist => ({
    artist,
    sources: sources.filter(source => source.appliesTo(location)),
  }))
  const total = sourcePlans.reduce((count, plan) => count + plan.sources.length, 0)
  let completed = 0

  for (const { artist, sources: artistSources } of sourcePlans) {
    const activeSources = new Map()
    const settled = []
    const report = (source, phase) => onProgress({
      artist,
      sourceId: source.id,
      sourceName: source.name,
      phase,
      completed,
      total,
      activeSourceNames: [...activeSources.values()],
    })
    await Promise.all(artistSources.map(async source => {
      activeSources.set(source.id, source.name)
      report(source, 'started')
      let outcome
      try {
        outcome = { source, events: await source.findEvents({ artist, location, today }) }
      } catch (error) {
        outcome = { source, events: [], unavailable: true }
        onError(source, artist, error)
      } finally {
        settled.push(outcome)
        activeSources.delete(source.id)
        completed++
        report(source, 'completed')
        const partial = resultForArtist(artist, settled, today)
        onResult(partial, [...results, partial])
      }
    }))
    results.push(resultForArtist(artist, settled, today))
  }

  return results
}

function resultForArtist(artist, settled, today) {
  const ordered = [...settled].sort((left, right) => left.source.priority - right.source.priority)
  return {
    artist,
    event: earliestEvent(ordered.flatMap(item => item.events), today),
    checkedSources: ordered.filter(item => !item.unavailable).map(item => item.source.id),
    unavailableSources: ordered.filter(item => item.unavailable).map(item => item.source.id),
  }
}

module.exports = { EVENTS, lookupNextEvents, resolveLocation }
