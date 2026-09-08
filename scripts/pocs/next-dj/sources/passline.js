const {
  artistMatches, countryCode, dateKey, locationMatches, normalizeEvent,
} = require('../core')
const { eventLinks, jsonLdEvents, looseEventFromPage } = require('../html-events')
const { fetchText } = require('../http')

const SOURCE = {
  id: 'passline',
  name: 'Passline',
  scope: 'Argentina and Chile',
  priority: 40,
}

function passlineSearchUrl(artist, location) {
  const code = countryCode(location.countryCode || location.country)
  const country = code === 'AR' ? 'argentina' : 'chile'
  const url = new URL('https://home.passline.com/eventos.php')
  url.searchParams.set('q', artist)
  url.searchParams.set('category', '')
  url.searchParams.set('region', '')
  url.searchParams.set('comuna', '')
  url.searchParams.set('mes', '')
  url.searchParams.set('pais', country)
  url.searchParams.set('page', '1')
  return url.href
}

function createPasslineSource(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch
  return {
    ...SOURCE,
    appliesTo(location) {
      return new Set(['AR', 'CL']).has(countryCode(location.countryCode || location.country))
    },
    async findNext({ artist, location, today }) {
      const searchUrl = passlineSearchUrl(artist, location)
      const searchHtml = await fetchText(searchUrl, { sourceName: SOURCE.name, fetchImpl })
      const links = eventLinks(searchHtml, searchUrl, /^\/eventos\//i).slice(0, 12)
      if (links.length === 0) return result('ok', [], `No Passline search results for ${artist}`)

      const attempts = await Promise.all(links.map(async link => {
        try {
          const html = await fetchText(link.url, { sourceName: SOURCE.name, fetchImpl })
          return { event: jsonLdEvents(html, link.url)[0] || looseEventFromPage(html, link.url), error: null }
        } catch (error) {
          return { event: null, error }
        }
      }))
      const candidates = attempts.map(item => item.event).filter(Boolean)
      if (candidates.length === 0 && attempts.some(item => item.error)) {
        throw attempts.find(item => item.error).error
      }
      const events = candidates
        .filter(event => artistMatches(event.artists?.length ? event.artists : `${event.title} ${event.description}`, artist))
        .filter(event => locationMatches(event, location))
        .filter(event => dateKey(event.date) >= today)
        .map(event => normalizeEvent(event, SOURCE))
      return result('ok', events)
    },
  }
}

function result(status, events, message = null) {
  return { sourceId: SOURCE.id, sourceName: SOURCE.name, status, events, message }
}

module.exports = { createPasslineSource, passlineSearchUrl }
