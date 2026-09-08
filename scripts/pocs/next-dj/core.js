const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
}

const COUNTRY_ALIASES = {
  argentina: 'AR', ar: 'AR',
  brasil: 'BR', brazil: 'BR', br: 'BR',
  canada: 'CA', ca: 'CA',
  chile: 'CL', cl: 'CL',
  france: 'FR', fr: 'FR',
  germany: 'DE', deutschland: 'DE', de: 'DE',
  greatbritain: 'UK', unitedkingdom: 'UK', uk: 'UK', gb: 'UK',
  mexico: 'MX', mx: 'MX',
  portugal: 'PT', pt: 'PT',
  spain: 'ES', espana: 'ES', es: 'ES',
  unitedstates: 'US', unitedstatesofamerica: 'US', usa: 'US', us: 'US',
}

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase()
}

function normalizeWords(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
}

function countryCode(value) {
  const key = normalize(value)
  return COUNTRY_ALIASES[key] || (key.length === 2 ? key.toUpperCase() : null)
}

function countryMatches(candidate, input) {
  if (!candidate) return false
  const wantedCode = countryCode(input)
  const candidateCode = countryCode(candidate.urlCode || candidate.countryCode || candidate.code)
    || countryCode(candidate.name)
  if (wantedCode && candidateCode) return wantedCode === candidateCode
  return normalize(candidate.name || candidate) === normalize(input)
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

function dateFromText(value, now = new Date()) {
  const text = normalizeWords(value)
  const dayFirst = text.match(/(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|miercoles|jueves|viernes|sabado|domingo)?\s*(\d{1,2})(?:\s+de)?\s+([a-z]+)(?:\s+(\d{4}))?/)
  const monthFirst = text.match(/\b([a-z]+)\s+(\d{1,2})(?:\s+(\d{4}))?\b/)
  const useDayFirst = dayFirst && MONTHS[dayFirst[2]]
  const day = Number(useDayFirst ? dayFirst[1] : monthFirst?.[2])
  const monthName = useDayFirst ? dayFirst[2] : monthFirst?.[1]
  const explicitYear = useDayFirst ? dayFirst[3] : monthFirst?.[3]
  if (!day || !monthName) return null
  const month = MONTHS[monthName]
  if (!month) return null
  let year = explicitYear ? Number(explicitYear) : now.getFullYear()
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  if (!explicitYear && candidate < localToday(now)) year += 1
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function artistMatches(candidate, requested) {
  const artist = normalizeWords(requested)
  if (!artist) return false
  if (Array.isArray(candidate)) return candidate.some(value => normalizeWords(value) === artist)
  const text = ` ${normalizeWords(candidate)} `
  return text.includes(` ${artist} `)
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

function locationMatches(event, location) {
  const city = normalize(location.city)
  const eventCity = normalize(event.city || event.addressLocality)
  const buenosAires = new Set(['buenosaires', 'caba', 'capitalfederal', 'ciudadautonomadebuenosaires'])
  const sameMetroAlias = buenosAires.has(city) && buenosAires.has(eventCity)
  if (eventCity && !sameMetroAlias && eventCity !== city && !eventCity.includes(city) && !city.includes(eventCity)) return false

  const wantedCountry = countryCode(location.countryCode || location.country)
  const eventCountry = countryCode(event.countryCode || event.country)
  return !eventCountry || !wantedCountry || eventCountry === wantedCountry
}

function formatDateLabel(date, startTime = null) {
  const day = dateKey(date)
  if (!day) return 'Date TBA'
  const [year, month, dayOfMonth] = day.split('-').map(Number)
  const label = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, dayOfMonth)))
  const time = String(startTime || '').match(/T?(\d{2}:\d{2})/)?.[1]
  return time ? `${label} at ${time}` : label
}

function normalizeEvent(event, source) {
  const date = dateKey(event.date || event.startTime)
  return {
    id: event.id || `${source.id}:${date}:${normalize(event.title)}:${normalize(event.venue)}`,
    sourceId: source.id,
    sourceName: source.name,
    title: event.title || `${event.artist || 'DJ'} event`,
    date,
    startTime: event.startTime || null,
    dateLabel: formatDateLabel(date, event.startTime),
    venue: event.venue || 'Venue TBA',
    city: event.city || null,
    country: event.country || null,
    artists: event.artists || [],
    url: event.url || null,
  }
}

function selectEarliestMatches(sourceResults, today = localToday()) {
  const events = sourceResults
    .filter(result => result.status === 'ok')
    .flatMap(result => result.events)
    .filter(event => event.date && event.date >= today)
    .sort((left, right) => {
      const leftTime = left.startTime || left.date
      const rightTime = right.startTime || right.date
      return leftTime.localeCompare(rightTime)
    })

  if (events.length === 0) return { date: null, matches: [] }
  const earliestDate = events[0].date
  const sameDay = events.filter(event => event.date === earliestDate)
  const merged = []

  for (const event of sameDay) {
    const duplicate = merged.find(item => {
      const sameVenue = normalize(item.venue) && normalize(item.venue) === normalize(event.venue)
      const sameTitle = normalize(item.title) && normalize(item.title) === normalize(event.title)
      return sameVenue || sameTitle
    })
    if (!duplicate) {
      merged.push({ ...event, sources: [{ id: event.sourceId, name: event.sourceName, url: event.url }] })
      continue
    }
    if (!duplicate.sources.some(source => source.id === event.sourceId)) {
      duplicate.sources.push({ id: event.sourceId, name: event.sourceName, url: event.url })
    }
  }

  return { date: earliestDate, matches: merged }
}

function slugify(value) {
  return normalizeWords(value).replace(/\s+/g, '-')
}

module.exports = {
  artistMatches,
  countryCode,
  countryMatches,
  dateFromText,
  dateKey,
  formatDateLabel,
  localToday,
  locationMatches,
  normalize,
  normalizeEvent,
  normalizeWords,
  rankArtists,
  selectEarliestMatches,
  slugify,
}
