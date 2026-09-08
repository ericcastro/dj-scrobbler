const { createEdmtrainSource } = require('./edmtrain')
const { createPasslineSource } = require('./passline')
const { createResidentAdvisorSource } = require('./resident-advisor')
const { createShotgunSource } = require('./shotgun')

function createSources(options = {}) {
  return [
    createResidentAdvisorSource(options.residentAdvisor),
    createEdmtrainSource(options.edmtrain),
    createShotgunSource(options.shotgun),
    createPasslineSource(options.passline),
  ]
}

async function querySources(sources, query, onlySourceIds = null) {
  const selected = onlySourceIds
    ? sources.filter(source => onlySourceIds.includes(source.id))
    : sources
  const sourceSelection = {
    ids: selected.map(source => source.id),
    multiSource: selected.length > 1,
  }

  return Promise.all(selected.map(async source => {
    if (!source.appliesTo(query.location)) {
      return {
        sourceId: source.id,
        sourceName: source.name,
        status: 'skipped',
        events: [],
        message: `Outside source scope: ${source.scope}`,
      }
    }
    try {
      return await source.findNext({ ...query, sourceSelection })
    } catch (err) {
      return {
        sourceId: source.id,
        sourceName: source.name,
        status: 'unavailable',
        events: [],
        message: err.message,
      }
    }
  }))
}

module.exports = { createSources, querySources }
