const {
  artistMatches, countryCode, dateKey, locationMatches, normalizeEvent,
} = require('../core')
const { eventFromJsonLd } = require('../html-events')
const { searchShotgunInBrowser } = require('../shotgun-browser-client')

const SOURCE = {
  id: 'shotgun',
  name: 'Shotgun',
  scope: 'Brazil and Europe',
  priority: 30,
}

const EUROPE_AND_BRAZIL = new Set([
  'AL', 'AD', 'AT', 'BE', 'BA', 'BG', 'BY', 'BR', 'CH', 'CY', 'CZ', 'DE', 'DK',
  'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT',
  'LU', 'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS',
  'SE', 'SI', 'SK', 'SM', 'TR', 'UA', 'UK', 'VA',
])

function createShotgunSource(options = {}) {
  const browserSearch = options.browserSearch || searchShotgunInBrowser
  return {
    ...SOURCE,
    appliesTo(location) {
      return EUROPE_AND_BRAZIL.has(countryCode(location.countryCode || location.country))
    },
    async findNext({ artist, location, today }) {
      const matches = await browserSearch(artist, options.browser)
      const events = matches
        .map(match => {
          const event = eventFromJsonLd(match.event, match.url)
          if (event?.date && /^\d{2}:\d{2}$/.test(match.localStartTime || '')) {
            event.startTime = `${event.date}T${match.localStartTime}:00`
          }
          return event
        })
        .filter(Boolean)
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

module.exports = { createShotgunSource }
