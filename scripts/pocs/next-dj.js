#!/usr/bin/env node

/**
 * POC v2: ask several plugin-like event sources when a DJ next plays locally.
 * The original RA-only implementation is frozen in archive/next-dj-v1-ra.js.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const readline = require('node:readline/promises')
const { stdin, stdout } = require('node:process')

const {
  countryMatches,
  dateKey,
  formatDateLabel,
  localToday,
  normalize,
  rankArtists,
  selectEarliestMatches,
} = require('./next-dj/core')
const { createSources, querySources } = require('./next-dj/sources')
const {
  ResidentAdvisorClient,
  selectArea,
} = require('./next-dj/sources/resident-advisor')

const SOURCE_IDS = new Set(['resident-advisor', 'edmtrain', 'shotgun', 'passline'])

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
  --sources <ids>      Comma-separated source ids
  --verbose            Show every source status, including out-of-scope sources
  --json               Print machine-readable output
  --config <path>      Override the config file location
  -h, --help           Show this help

Source ids: resident-advisor, edmtrain, shotgun, passline

Edmtrain's API requires a key. EDMTRAIN_CLIENT_KEY is sufficient for an isolated
--sources edmtrain lookup. Multi-source use additionally requires permission and
EDMTRAIN_COMBINATION_APPROVED=1.
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
    sources: null,
    verbose: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--configure') args.configure = true
    else if (arg === '--json') args.json = true
    else if (arg === '--verbose') args.verbose = true
    else if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--city') args.city = requiredValue(argv, ++i, arg)
    else if (arg === '--country') args.country = requiredValue(argv, ++i, arg)
    else if (arg === '--dj') args.dj = requiredValue(argv, ++i, arg)
    else if (arg === '--radius') args.radius = requiredValue(argv, ++i, arg)
    else if (arg === '--config') args.configPath = requiredValue(argv, ++i, arg)
    else if (arg === '--sources') args.sources = parseSourceIds(requiredValue(argv, ++i, arg))
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

function parseSourceIds(value) {
  const ids = [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))]
  const invalid = ids.filter(id => !SOURCE_IDS.has(id))
  if (invalid.length) throw new Error(`Unknown source id: ${invalid.join(', ')}`)
  return ids
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

function migrateLocation(location) {
  if (!location) return null
  if (location.city) return location
  if (!location.name || !location.country) return null
  return {
    city: location.name,
    country: location.country.name,
    countryCode: location.country.urlCode,
    raAreaId: location.id,
    raUrlName: location.urlName,
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

async function askYesNo(rl, label, defaultValue = false) {
  while (true) {
    const defaultLabel = defaultValue ? 'y' : 'n'
    const answer = (await rl.question(`${label} [${defaultLabel}]: `)).trim().toLowerCase()
    if (!answer) return defaultValue
    if (answer === 'y' || answer === 'yes') return true
    if (answer === 'n' || answer === 'no') return false
    console.log('Please answer y or n.')
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
    throw new Error(`Could not find an exact city/country match for ${city}, ${country}.${hint}`)
  }
  return {
    city: area.name,
    country: area.country.name,
    countryCode: area.country.urlCode,
    raAreaId: area.id,
    raUrlName: area.urlName,
  }
}

function exactAreaEvents(events, area, today = localToday()) {
  return events
    .filter(event => String(event.venue?.area?.id) === String(area.id))
    .filter(event => dateKey(event.date) >= today)
    .sort((left, right) => (left.startTime || left.date || '').localeCompare(right.startTime || right.date || ''))
}

function formatEvent(event) {
  return {
    date: dateKey(event.date),
    dateLabel: formatDateLabel(event.date, event.startTime),
    title: event.title,
    venue: event.venue?.name || event.venue || 'Venue TBA',
    url: event.url || new URL(event.contentUrl || `/events/${event.id}`, 'https://ra.co').href,
  }
}

function sourceSummaries(results) {
  return results.map(result => ({
    id: result.sourceId,
    name: result.sourceName,
    status: result.status,
    matches: result.events.length,
    message: result.message || null,
  }))
}

function printResult(result, verbose) {
  if (result.next.matches.length) {
    console.log(`\n${result.artist} is next playing in ${result.location.city}:`)
    console.log(`  ${result.next.matches[0].dateLabel}`)
    for (const match of result.next.matches) {
      console.log(`  ${match.title} — ${match.venue}`)
      for (const source of match.sources) {
        console.log(`    ${source.name}${source.url ? `: ${source.url}` : ''}`)
      }
    }
  } else {
    console.log(`\n${noMatchMessage(result)}`)
  }

  const notes = result.sources.filter(source => source.status === 'unavailable' || source.status === 'disabled'
    || (verbose && source.status === 'skipped'))
  if (notes.length) {
    console.log('\nCoverage notes:')
    for (const source of notes) console.log(`  ${source.name}: ${source.message}`)
  }
  if (verbose) {
    const checked = result.sources.filter(source => source.status === 'ok')
    if (checked.length) console.log(`\nChecked: ${checked.map(source => `${source.name} (${source.matches})`).join(', ')}`)
  }
}

function noMatchMessage(result) {
  const checked = result.sources.filter(source => source.status === 'ok')
  if (checked.length === 0) {
    return `Could not determine when ${result.artist} next plays in ${result.location.city}; no selected source could be checked.`
  }
  const incomplete = result.sources.some(source => source.status === 'unavailable' || source.status === 'disabled')
  const qualifier = incomplete ? ' in the sources that responded' : ''
  return `No upcoming ${result.artist} event was found in ${result.location.city}${qualifier}.`
}

async function run(options = {}) {
  const args = options.args || parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return null
  }

  const configPath = args.configPath || defaultConfigPath()
  const config = readConfig(configPath)
  const rl = options.readline || readline.createInterface({ input: stdin, output: stdout })
  const ownsReadline = !options.readline

  try {
    const raClient = options.raClient || new ResidentAdvisorClient()
    let location = migrateLocation(config.location)
    const changeLocation = !args.city && !args.configure && location
      ? await askYesNo(rl, 'Change location?', false)
      : false
    if (args.city || args.configure || changeLocation || !location) {
      if (!args.json && !args.city) console.log('Configure your location (exact city/metro matching).')
      const city = args.city || await askNonEmpty(rl, 'City', location?.city)
      const country = args.country || await askNonEmpty(rl, 'Country', location?.country)
      location = await resolveLocation(raClient, city, country)
      if (!args.json) console.log(`Location: ${location.city}, ${location.country}`)
    }

    const lastName = config.lastDj?.name || null
    const artist = args.dj || await askNonEmpty(rl, 'Which DJ?', lastName)
    const radiusInput = args.radius || await askNonEmpty(rl, 'Radius?', 'exact')
    const radius = parseRadius(radiusInput)
    const today = options.today || localToday()
    const sources = options.sources || createSources(options.sourceOptions)
    const sourceResults = await querySources(sources, { artist, location, radius, today }, args.sources)
    const next = selectEarliestMatches(sourceResults, today)

    config.version = 2
    config.location = location
    config.lastDj = { name: artist }
    config.radius = radius
    writeConfig(configPath, config)

    const result = {
      artist,
      location,
      radius,
      next,
      sources: sourceSummaries(sourceResults),
    }
    if (args.json) console.log(JSON.stringify(result, null, 2))
    else printResult(result, args.verbose)
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
  askYesNo,
  countryMatches,
  dateKey,
  exactAreaEvents,
  formatEvent,
  migrateLocation,
  noMatchMessage,
  normalize,
  parseArgs,
  parseRadius,
  parseSourceIds,
  rankArtists,
  run,
  selectArea,
  selectEarliestMatches,
}
