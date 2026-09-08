const { countryMatches, dateKey, normalize, normalizeEvent, rankArtists } = require('../core')
const { fetchText } = require('../http')

const SOURCE = {
  id: 'resident-advisor',
  name: 'Resident Advisor',
  scope: 'Global',
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

class ResidentAdvisorClient {
  constructor(fetchImpl = globalThis.fetch) {
    this.fetchImpl = fetchImpl
  }

  async query(query, variables) {
    const text = await fetchText('https://ra.co/graphql', {
      sourceName: SOURCE.name,
      fetchImpl: this.fetchImpl,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Referer': 'https://ra.co/events',
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

  async findAreas(city) {
    const data = await this.query(AREAS_QUERY, { term: city })
    return data.areas || []
  }

  async resolveArea(location) {
    if (location.raAreaId) {
      return {
        id: location.raAreaId,
        name: location.city,
        urlName: location.raUrlName,
        country: { name: location.country, urlCode: location.countryCode },
      }
    }
    const areas = await this.findAreas(location.city)
    return selectArea(areas, location.city, location.countryCode || location.country)
  }

  async searchArtist(name) {
    const data = await this.query(SEARCH_QUERY, { term: name })
    const candidates = rankArtists(data.search || [], name)
    return candidates[0] || null
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

function selectArea(areas, city, country) {
  return areas.find(area => normalize(area.name) === normalize(city) && countryMatches(area.country, country)) || null
}

function createResidentAdvisorSource(options = {}) {
  const client = options.client || new ResidentAdvisorClient(options.fetchImpl)
  return {
    ...SOURCE,
    appliesTo() { return true },
    async findNext({ artist, location, today }) {
      const area = await client.resolveArea(location)
      if (!area) return result('ok', [], `No exact RA area for ${location.city}`)
      const profile = await client.searchArtist(artist)
      if (!profile) return result('ok', [], `No RA artist match for ${artist}`)
      const rawEvents = await client.artistEvents(profile.id, today)
      const events = rawEvents
        .filter(event => String(event.venue?.area?.id) === String(area.id))
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
      return result('ok', events, null, {
        artist: { id: profile.id, name: profile.value, url: new URL(profile.contentUrl, 'https://ra.co').href },
        area,
      })
    },
  }
}

function result(status, events, message = null, details = null) {
  return { sourceId: SOURCE.id, sourceName: SOURCE.name, status, events, message, details }
}

module.exports = { ResidentAdvisorClient, createResidentAdvisorSource, selectArea }
