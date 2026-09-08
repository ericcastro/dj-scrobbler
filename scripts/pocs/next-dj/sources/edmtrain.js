const { countryCode, dateKey, normalize, normalizeEvent, normalizeWords } = require('../core')
const { fetchJson } = require('../http')

const SOURCE = {
  id: 'edmtrain',
  name: 'Edmtrain',
  scope: 'United States and Canada',
  priority: 20,
}

function createEdmtrainSource(options = {}) {
  const clientKey = options.clientKey || process.env.EDMTRAIN_CLIENT_KEY
  const combinationApproved = options.combinationApproved
    ?? process.env.EDMTRAIN_COMBINATION_APPROVED === '1'
  const fetchImpl = options.fetchImpl || globalThis.fetch

  return {
    ...SOURCE,
    appliesTo(location) {
      return new Set(['US', 'CA']).has(countryCode(location.countryCode || location.country))
    },
    async findNext({ artist, location, today, sourceSelection }) {
      if (!clientKey) {
        return result('disabled', [], 'Set EDMTRAIN_CLIENT_KEY after obtaining an Edmtrain API key')
      }
      if (sourceSelection?.multiSource && !combinationApproved) {
        return result('disabled', [], 'Edmtrain forbids multi-source event discovery unless permission is obtained; then set EDMTRAIN_COMBINATION_APPROVED=1')
      }

      const locations = await api('locations', { client: clientKey }, fetchImpl)
      const wantedCountry = countryCode(location.countryCode || location.country)
      const area = locations.find(item => edmtrainLocationMatches(item, location.city)
        && countryCode(item.countryCode || item.country) === wantedCountry)
      if (!area) return result('ok', [], `No Edmtrain location match for ${location.city}`)

      const rawEvents = await api('events', {
        client: clientKey,
        locationIds: area.id,
        startDate: today,
        livestreamInd: false,
      }, fetchImpl)
      const events = rawEvents
        .filter(event => (event.artistList || []).some(item => edmtrainArtistMatches(item.name, artist)))
        .filter(event => dateKey(event.date) >= today)
        .map(event => normalizeEvent({
          id: event.id,
          title: event.name || (event.artistList || []).map(item => item.name).join(', '),
          date: event.date,
          startTime: event.startTime,
          venue: event.venue?.name,
          city: area.city,
          country: area.country,
          artists: (event.artistList || []).map(item => item.name),
          url: event.link,
        }, SOURCE))
      return result('ok', events)
    },
  }
}

function edmtrainArtistMatches(candidate, requested) {
  const candidateName = normalizeWords(candidate)
  const requestedName = normalizeWords(requested)
  const unqualifiedName = normalizeWords(String(candidate || '').replace(/\s*\([^)]*\)\s*$/, ''))
  return candidateName === requestedName || unqualifiedName === requestedName
}

function edmtrainLocationMatches(candidate, requestedCity) {
  const requested = normalize(requestedCity)
  const values = [
    candidate.city,
    `${candidate.city || ''}${candidate.stateCode || ''}`,
    candidate.link ? new URL(candidate.link).pathname : null,
  ]
  return values.some(value => normalize(value) === requested)
}

async function api(endpoint, params, fetchImpl) {
  const url = new URL(`https://edmtrain.com/api/${endpoint}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const response = await fetchJson(url, { sourceName: SOURCE.name, fetchImpl })
  if (!response.success) throw new Error(response.message || 'Edmtrain API request failed')
  return response.data || []
}

function result(status, events, message = null) {
  return { sourceId: SOURCE.id, sourceName: SOURCE.name, status, events, message }
}

module.exports = { createEdmtrainSource, edmtrainArtistMatches, edmtrainLocationMatches }
