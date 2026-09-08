#!/usr/bin/env node

/**
 * POC: answer "When is <DJ> playing next in my city?" with Resident Advisor.
 *
 * RA's GraphQL endpoint is public but undocumented. Keep this experiment out of
 * production code until the query, caching, and fallback strategy are settled.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const readline = require('node:readline/promises')
const { stdin, stdout } = require('node:process')

const RA_URL = 'https://ra.co/graphql'
const RA_ORIGIN = 'https://ra.co'
const FETCH_TIMEOUT_MS = 15_000
const PAGE_SIZE = 100
const MAX_EVENT_PAGES = 5

const SEARCH_QUERY = `
  query SearchArtists($term: String!) {
    search(searchTerm: $term, limit: 8, indices: [ARTIST]) {
      id
      value
      searchType
      contentUrl
      areaName
    }
  }
`

const AREAS_QUERY = `
  query FindAreas($term: String!) {
    areas(searchTerm: $term, limit: 10) {
      id
      name
      urlName
      country {
        id
        name
        urlCode
      }
    }
  }
`

const EVENTS_QUERY = `
  query NextArtistEvents($filters: [FilterInput], $pageSize: Int, $page: Int) {
    listing(
      indices: [EVENT]
      filters: $filters
      pageSize: $pageSize
      page: $page
      sortField: EVENTDATE
      sortOrder: ASCENDING
    ) {
      data {
        ... on Event {
          id
          title
          date
          startTime
          contentUrl
          artists { id name }
          venue {
            id
            name
            contentUrl
            area {
              id
              name
              urlName
              country { id name urlCode }
            }
          }
        }
      }
      totalResults
    }
  }
`

function usage() {
  console.log(`Usage:
  npm run poc:next-dj
  node scripts/pocs/next-dj.js [options]

Options:
  --configure          Reconfigure the saved city and country
  --city <name>        Use a city without prompting (requires --country)
  --country <name>     Country name or two-letter code
  --dj <name>          DJ name without prompting
  --radius <value>     "exact" only for this POC; numeric radii are reserved
  --json               Print machine-readable output
  --config <path>      Override the config file location
  -h, --help           Show this help

Examples:
  npm run poc:next-dj
  node scripts/pocs/next-dj.js --city Paris --country FR --dj "Ben UFO"
`)
}

function parseArgs(argv) {
  const args = {
    city: null,
    configPath: null,
    configure: false,
    country: null,
    dj: null,
    help: false,
    json: false,
    radius: null,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--configure') args.configure = true
    else if (arg === '--json') args.json = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--city') args.city = requiredValue(argv, ++i, arg)
    else if (arg === '--country') args.country = requiredValue(argv, ++i, arg)
    else if (arg === '--dj') args.dj = requiredValue(argv, ++i, arg)
    else if (arg === '--radius') args.radius = requiredValue(argv, ++i, arg)
    else if (arg === '--config') args.configPath = requiredValue(argv, ++i, arg)
    else throw new Error(`Unknown argument: ${arg}`)
  }

  if ((args.city && !args.country) || (!args.city && args.country)) {
    throw new Error('--city and --country must be used together')
  }
  return args
}

function requiredValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`)
  return value
}

function defaultConfigPath() {
  if (process.env.DJ_SCROBBLER_POC_CONFIG) return process.env.DJ_SCROBBLER_POC_CONFIG
  const configRoot = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(configRoot, 'dj-scrobbler', 'next-dj.json')
}

function readConfig(configPath) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    return config && typeof config === 'object' ? config : {}
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw new Error(`Could not read ${configPath}: ${err.message}`)
  }
}

function writeConfig(configPath, config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase()
}

function countryKeys(value) {
  const key = normalize(value)
  const aliases = {
    gb: 'unitedkingdom',
    greatbritain: 'unitedkingdom',
    uk: 'unitedkingdom',
    unitedstates: 'unitedstatesofamerica',
    us: 'unitedstatesofamerica',
    usa: 'unitedstatesofamerica',
  }
  return new Set([key, aliases[key] || key])
}

function countryMatches(country, input) {
  if (!country) return false
  const wanted = countryKeys(input)
  return wanted.has(normalize(country.name)) || wanted.has(normalize(country.urlCode))
}

function selectArea(areas, city, country) {
  const cityKey = normalize(city)
  return areas.find(area => normalize(area.name) === cityKey && countryMatches(area.country, country)) || null
}

function rankArtists(results, input) {
  const key = normalize(input)
  return [...results]
    .filter(result => result.searchType === 'ARTIST')
    .sort((left, right) => {
      const leftExact = normalize(left.value) === key ? 1 : 0
      const rightExact = normalize(right.value) === key ? 1 : 0
      return rightExact - leftExact
    })
}

function dateKey(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : null
}

function localToday(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function exactAreaEvents(events, area, today = localToday()) {
  return events
    .filter(event => String(event.venue?.area?.id) === String(area.id))
    .filter(event => dateKey(event.date) >= today)
    .sort((left, right) => {
      const leftTime = left.startTime || left.date || ''
      const rightTime = right.startTime || right.date || ''
      return leftTime.localeCompare(rightTime)
    })
}

function formatEvent(event) {
  const day = dateKey(event.date)
  let formattedDay = day || 'Date TBA'
  if (day) {
    const [year, month, date] = day.split('-').map(Number)
    formattedDay = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(year, month - 1, date)))
  }
  const time = String(event.startTime || '').match(/T(\d{2}:\d{2})/)?.[1]
  return {
    date: day,
    dateLabel: time ? `${formattedDay} at ${time}` : formattedDay,
    title: event.title,
    venue: event.venue?.name || 'Venue TBA',
    url: new URL(event.contentUrl || `/events/${event.id}`, RA_ORIGIN).href,
  }
}

class ResidentAdvisorClient {
  constructor(fetchImpl = globalThis.fetch) {
    if (!fetchImpl) throw new Error('Node.js 20+ is required (global fetch is missing)')
    this.fetch = fetchImpl
  }

  async query(query, variables) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const response = await this.fetch(RA_URL, {
        method: 'POST',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Referer': 'https://ra.co/events',
          // RA currently returns empty area results to Node's default user agent.
          'User-Agent': 'Mozilla/5.0',
        },
        body: JSON.stringify({ query, variables }),
      })
      const body = await response.text()
      if (!response.ok) throw new Error(`RA returned HTTP ${response.status}`)

      let parsed
      try {
        parsed = JSON.parse(body)
      } catch {
        throw new Error('RA returned an unexpected non-JSON response')
      }
      if (parsed.errors?.length) {
        throw new Error(`RA query failed: ${parsed.errors.map(error => error.message).join('; ')}`)
      }
      return parsed.data
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Resident Advisor timed out')
      throw err
    } finally {
      clearTimeout(timeout)
    }
  }

  async findAreas(city) {
    const data = await this.query(AREAS_QUERY, { term: city })
    return data.areas || []
  }

  async searchArtists(name) {
    const data = await this.query(SEARCH_QUERY, { term: name })
    return rankArtists(data.search || [], name)
  }

  async findUpcomingEvents(artistId, area, today = localToday()) {
    const events = []
    const dateFilter = JSON.stringify({ gte: `${today}T00:00:00.000Z` })

    for (let page = 1; page <= MAX_EVENT_PAGES; page++) {
      const data = await this.query(EVENTS_QUERY, {
        filters: [
          { type: 'ARTIST', value: String(artistId) },
          { type: 'DATERANGE', value: dateFilter },
        ],
        pageSize: PAGE_SIZE,
        page,
      })
      const listing = data.listing
      const pageEvents = listing?.data || []
      events.push(...pageEvents)

      const matches = exactAreaEvents(events, area, today)
      if (matches.length > 0) return matches
      if (events.length >= Number(listing?.totalResults || 0) || pageEvents.length < PAGE_SIZE) break
    }

    return exactAreaEvents(events, area, today)
  }
}

async function askNonEmpty(rl, label, defaultValue = null) {
  while (true) {
    const suffix = defaultValue ? ` [${defaultValue}]` : ''
    const answer = (await rl.question(`${label}${suffix}: `)).trim()
    if (answer) return answer
    if (defaultValue) return defaultValue
  }
}

async function chooseArtist(rl, artists, requestedName) {
  if (artists.length === 0) throw new Error(`No RA artist found for "${requestedName}"`)
  if (artists.length === 1 || normalize(artists[0].value) === normalize(requestedName)) return artists[0]

  console.log('\nRA found a few possible artists:')
  artists.forEach((artist, index) => console.log(`  ${index + 1}. ${artist.value}`))
  while (true) {
    const answer = (await rl.question('DJ match [1]: ')).trim() || '1'
    const index = Number(answer) - 1
    if (Number.isInteger(index) && artists[index]) return artists[index]
  }
}

function parseRadius(value) {
  const normalized = String(value || 'exact').trim().toLowerCase()
  if (!normalized || normalized === 'exact' || normalized === '0') return { mode: 'exact', km: null }
  const km = Number(normalized.replace(/\s*km$/, ''))
  if (Number.isFinite(km) && km > 0) {
    throw new Error('Radius search is reserved for the next iteration; press Enter for exact city matching')
  }
  throw new Error('Radius must be "exact" for this POC')
}

async function resolveLocation(client, city, country) {
  const areas = await client.findAreas(city)
  const area = selectArea(areas, city, country)
  if (!area) {
    const suggestions = areas.slice(0, 5)
      .map(item => `${item.name}, ${item.country?.name || '?'}`)
      .join('; ')
    const hint = suggestions ? ` RA returned: ${suggestions}.` : ''
    throw new Error(`Could not find an exact RA area for ${city}, ${country}.${hint}`)
  }
  return area
}

async function run(options = {}) {
  const args = options.args || parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return null
  }

  const configPath = args.configPath || defaultConfigPath()
  const config = readConfig(configPath)
  const client = options.client || new ResidentAdvisorClient()
  const rl = options.readline || readline.createInterface({ input: stdin, output: stdout })
  const ownsReadline = !options.readline

  try {
    let area = config.location || null
    if (args.city || args.configure || !area) {
      if (!args.json && !args.city) console.log('Configure your location (RA uses city/metro areas).')
      const city = args.city || await askNonEmpty(rl, 'City', area?.name)
      const country = args.country || await askNonEmpty(rl, 'Country', area?.country?.name)
      area = await resolveLocation(client, city, country)
      config.location = area
      if (!args.json) console.log(`Location: ${area.name}, ${area.country.name}`)
    }

    const lastName = config.lastDj?.name || null
    const requestedName = args.dj || await askNonEmpty(rl, 'Which DJ?', lastName)
    let artist
    if (!args.dj && lastName && requestedName === lastName && config.lastDj?.id) {
      artist = config.lastDj
    } else {
      const artists = await client.searchArtists(requestedName)
      artist = args.dj ? artists[0] : await chooseArtist(rl, artists, requestedName)
      if (!artist) throw new Error(`No RA artist found for "${requestedName}"`)
    }

    const radiusInput = args.radius || await askNonEmpty(rl, 'Radius?', 'exact')
    const radius = parseRadius(radiusInput)
    const matches = await client.findUpcomingEvents(artist.id, area)
    const event = matches[0] || null

    config.version = 1
    config.location = area
    config.lastDj = { id: artist.id, name: artist.value || artist.name, contentUrl: artist.contentUrl }
    config.radius = radius
    writeConfig(configPath, config)

    const result = {
      source: 'Resident Advisor',
      sourceStatus: 'unofficial-undocumented-api',
      location: {
        areaId: area.id,
        city: area.name,
        country: area.country.name,
        countryCode: area.country.urlCode,
      },
      artist: {
        id: artist.id,
        name: artist.value || artist.name,
        url: artist.contentUrl ? new URL(artist.contentUrl, RA_ORIGIN).href : null,
      },
      radius,
      nextEvent: event ? formatEvent(event) : null,
    }

    if (args.json) {
      console.log(JSON.stringify(result, null, 2))
    } else if (result.nextEvent) {
      console.log(`\n${result.artist.name} is next playing in ${area.name}:`)
      console.log(`  ${result.nextEvent.dateLabel}`)
      console.log(`  ${result.nextEvent.title} — ${result.nextEvent.venue}`)
      console.log(`  ${result.nextEvent.url}`)
    } else {
      console.log(`\nNo upcoming ${result.artist.name} event is currently listed by RA in ${area.name}.`)
      if (result.artist.url) console.log(`  ${result.artist.url}`)
    }

    return result
  } finally {
    if (ownsReadline) rl.close()
  }
}

if (require.main === module) {
  run().catch(err => {
    console.error(`Error: ${err.message}`)
    process.exitCode = 1
  })
}

module.exports = {
  ResidentAdvisorClient,
  countryMatches,
  dateKey,
  exactAreaEvents,
  formatEvent,
  normalize,
  parseArgs,
  parseRadius,
  rankArtists,
  run,
  selectArea,
}
