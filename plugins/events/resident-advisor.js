const {
  countryMatches,
  dateKey,
  normalize,
  normalizeEvent,
  normalizeWords,
} = require('../../lib/event-lookup-core')
const { fetchText } = require('../../lib/event-http')

const SOURCE = {
  id: 'resident-advisor',
  name: 'Resident Advisor',
  externalHost: 'ra.co',
  priority: 10,
}

const SEARCH_QUERY = `
  query SearchArtists($term: String!) {
    search(searchTerm: $term, limit: 8, indices: [ARTIST]) {
      id value searchType contentUrl areaName
    }
  }
`

const AREAS_QUERY = `
  query FindAreas($term: String!) {
    areas(searchTerm: $term, limit: 10) {
      id name urlName country { id name urlCode }
    }
  }
`

const EVENTS_QUERY = `
  query NextArtistEvents($filters: [FilterInput], $pageSize: Int, $page: Int) {
    listing(indices: [EVENT], filters: $filters, pageSize: $pageSize, page: $page,
      sortField: EVENTDATE, sortOrder: ASCENDING) {
      data {
        ... on Event {
          id title date startTime contentUrl
          artists { id name }
          venue {
            id name contentUrl
            area { id name urlName country { id name urlCode } }
          }
        }
      }
      totalResults
    }
  }
`

function selectArea(areas, city, countryCode, countryName = '') {
  return areas.find(area =>
    normalize(area.name) === normalize(city) && (
      countryCode
        ? countryMatches(area.country?.urlCode, countryCode)
        : normalize(area.country?.name) === normalize(countryName)
    ),
  ) || null
}

class ResidentAdvisorClient {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch
    this.userAgent = options.userAgent || 'DJ-Scrobbler'
  }

  async query(query, variables) {
    const text = await fetchText('https://ra.co/graphql', {
      sourceName: SOURCE.name,
      fetchImpl: this.fetchImpl,
      userAgent: this.userAgent,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Referer: 'https://ra.co/events',
      },
      body: JSON.stringify({ query, variables }),
    })
    let result
    try {
      result = JSON.parse(text)
    } catch {
      throw new Error('Resident Advisor returned invalid JSON')
    }
    if (result.errors?.length) throw new Error(result.errors.map(error => error.message).join('; '))
    return result.data
  }

  async resolveArea(location) {
    if (location.raAreaId) return location
    const data = await this.query(AREAS_QUERY, { term: location.city })
    return selectArea(data.areas || [], location.city, location.countryCode, location.country)
  }

  async searchArtist(name) {
    const data = await this.query(SEARCH_QUERY, { term: name })
    const key = normalizeWords(name)
    const artists = (data.search || []).filter(item => item.searchType === 'ARTIST')
    return artists.find(item => normalizeWords(item.value) === key) || null
  }

  async artistEvents(artistId, today) {
    const events = []
    const dateFilter = JSON.stringify({ gte: `${today}T00:00:00.000Z` })
    for (let page = 1; page <= 5; page++) {
      const data = await this.query(EVENTS_QUERY, {
        filters: [
          { type: 'ARTIST', value: String(artistId) },
          { type: 'DATERANGE', value: dateFilter },
        ],
        pageSize: 100,
        page,
      })
      const pageEvents = data.listing?.data || []
      events.push(...pageEvents)
      if (events.length >= Number(data.listing?.totalResults || 0) || pageEvents.length < 100) break
    }
    return events
  }
}

function createResidentAdvisorSource(options = {}) {
  const client = options.client || new ResidentAdvisorClient(options)
  return {
    ...SOURCE,
    appliesTo() { return true },
    async resolveLocation(location) {
      const area = await client.resolveArea(location)
      if (!area) return null
      const resolvedCountryCode = String(area.country?.urlCode || '').toUpperCase()
      return {
        ...location,
        city: area.name || location.city,
        country: area.country?.name || location.country,
        countryCode: location.countryCode || (resolvedCountryCode === 'UK' ? 'GB' : resolvedCountryCode),
        raAreaId: String(area.id),
        raUrlName: area.urlName || null,
      }
    },
    async findEvents({ artist, location, today }) {
      const area = await client.resolveArea(location)
      if (!area) return []
      const profile = await client.searchArtist(artist)
      if (!profile) return []
      const rawEvents = await client.artistEvents(profile.id, today)
      return rawEvents
        .filter(event => String(event.venue?.area?.id) === String(area.id || area.raAreaId))
        .filter(event => dateKey(event.date) >= today)
        .map(event => normalizeEvent({
          id: event.id,
          title: event.title,
          date: event.date,
          startTime: event.startTime,
          venue: event.venue?.name,
          city: event.venue?.area?.name,
          country: event.venue?.area?.country?.name,
          artists: (event.artists || []).map(item => item.name),
          url: new URL(event.contentUrl || `/events/${event.id}`, 'https://ra.co').href,
        }, SOURCE))
    },
  }
}

module.exports = { SOURCE, ResidentAdvisorClient, createResidentAdvisorSource, selectArea }
