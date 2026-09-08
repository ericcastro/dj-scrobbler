const { earliestEvent, localToday } = require('../../lib/event-lookup-core')
const { createResidentAdvisorSource } = require('./resident-advisor')
const { createShotgunSource } = require('./shotgun')

const EVENTS = [createResidentAdvisorSource(), createShotgunSource()]

async function resolveLocation(location, options = {}) {
  const residentAdvisor = options.sources?.find(source => source.id === 'resident-advisor') || EVENTS[0]
  return residentAdvisor.resolveLocation(location)
}

async function lookupNextEvents({
  djNames,
  location,
  today = localToday(),
  sources = EVENTS,
  onError = () => {},
  onProgress = () => {},
}) {
  const names = [...new Set((djNames || []).map(name => String(name).trim()).filter(Boolean))].slice(0, 8)
  const results = []
  const sourcePlans = names.map(artist => ({ artist, sources: sources.filter(source => source.appliesTo(location)) }))
  const total = sourcePlans.reduce((count, plan) => count + plan.sources.length, 0)
  let completed = 0

  for (const { artist, sources: artistSources } of sourcePlans) {
    const activeSources = new Map()
    const report = (source, phase) => onProgress({
      artist,
      sourceId: source.id,
      sourceName: source.name,
      phase,
      completed,
      total,
      activeSourceNames: [...activeSources.values()],
    })
    const settled = await Promise.all(artistSources.map(async source => {
        activeSources.set(source.id, source.name)
        report(source, 'started')
        try {
          return { source, events: await source.findEvents({ artist, location, today }) }
        } catch (error) {
          onError(source, artist, error)
          return { source, events: [], unavailable: true }
        } finally {
          activeSources.delete(source.id)
          completed++
          report(source, 'completed')
        }
      }))
    const events = settled
      .sort((left, right) => left.source.priority - right.source.priority)
      .flatMap(item => item.events)
    results.push({
      artist,
      event: earliestEvent(events, today),
      checkedSources: settled.filter(item => !item.unavailable).map(item => item.source.id),
      unavailableSources: settled.filter(item => item.unavailable).map(item => item.source.id),
    })
  }

  return results
}

module.exports = { EVENTS, lookupNextEvents, resolveLocation }
