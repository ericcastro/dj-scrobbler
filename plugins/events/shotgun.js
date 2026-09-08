const {
  artistMatches,
  dateKey,
  locationMatches,
  normalizeEvent,
} = require('../../lib/event-lookup-core')
const { eventFromJsonLd } = require('../../lib/event-jsonld')

const SOURCE = {
  id: 'shotgun',
  name: 'Shotgun',
  externalHost: 'shotgun.live',
  priority: 20,
}

const EUROPE_AND_BRAZIL = new Set([
  'AL', 'AD', 'AT', 'BE', 'BA', 'BG', 'BY', 'BR', 'CH', 'CY', 'CZ', 'DE', 'DK',
  'EE', 'ES', 'FI', 'FR', 'GB', 'GR', 'HR', 'HU', 'IE', 'IS', 'IT', 'LI', 'LT',
  'LU', 'LV', 'MC', 'MD', 'ME', 'MK', 'MT', 'NL', 'NO', 'PL', 'PT', 'RO', 'RS',
  'SE', 'SI', 'SK', 'SM', 'TR', 'UA', 'UK', 'VA',
])

async function defaultBrowserSearch(artist, options) {
  return require('../../lib/shotgun-browser').searchShotgunInBrowser(artist, options)
}

function createShotgunSource(options = {}) {
  const browserSearch = options.browserSearch || defaultBrowserSearch
  return {
    ...SOURCE,
    appliesTo(location) {
      return EUROPE_AND_BRAZIL.has(String(location.countryCode || '').toUpperCase())
    },
    async findEvents({ artist, location, today }) {
      const matches = await browserSearch(artist, options.browser)
      return matches
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
    },
  }
}

module.exports = { SOURCE, createShotgunSource }
