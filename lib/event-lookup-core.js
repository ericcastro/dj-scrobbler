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

const COUNTRY_ALIASES = new Map([
  ['gb', 'gb'],
  ['uk', 'gb'],
  ['greatbritain', 'gb'],
  ['unitedkingdom', 'gb'],
  ['us', 'us'],
  ['usa', 'us'],
  ['unitedstates', 'us'],
  ['unitedstatesofamerica', 'us'],
])

function countryIdentity(value) {
  const key = normalize(value)
  return COUNTRY_ALIASES.get(key) || key
}

function countryMatches(left, right) {
  const leftKey = countryIdentity(left)
  const rightKey = countryIdentity(right)
  return !!leftKey && !!rightKey && leftKey === rightKey
}

function dateKey(value) {
  return String(value || '').match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || null
}

function localToday(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function artistMatches(candidate, requested) {
  const artist = normalizeWords(requested)
  if (!artist) return false
  if (Array.isArray(candidate)) return candidate.some(value => normalizeWords(value) === artist)
  return ` ${normalizeWords(candidate)} `.includes(` ${artist} `)
}

function locationMatches(event, location) {
  const city = normalize(location.city)
  const eventCity = normalize(event.city)
  if (!city || !eventCity) return false
  const buenosAires = new Set(['buenosaires', 'caba', 'capitalfederal', 'ciudadautonomadebuenosaires'])
  const sameMetroAlias = buenosAires.has(city) && buenosAires.has(eventCity)
  if (!sameMetroAlias && eventCity !== city) return false

  const wantedCountries = new Set([location.countryCode, location.country].map(countryIdentity).filter(Boolean))
  const eventCountries = [event.countryCode, event.country].map(countryIdentity).filter(Boolean)
  if (!eventCountries.length || !wantedCountries.size) return true
  return eventCountries.some(value => wantedCountries.has(value))
}

function formatDateLabel(date, startTime = null) {
  const day = dateKey(date)
  if (!day) return 'Date TBA'
  const [year, month, dayOfMonth] = day.split('-').map(Number)
  const label = new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, dayOfMonth)))
  const time = String(startTime || '').match(/T(\d{2}:\d{2})/)?.[1]
  return time ? `${label} · ${time}` : label
}

function normalizeEvent(event, source) {
  const date = dateKey(event.date || event.startTime)
  return {
    id: event.id || `${source.id}:${date}:${normalize(event.title)}:${normalize(event.venue)}`,
    sourceId: source.id,
    sourceName: source.name,
    title: event.title || 'Event',
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

function earliestEvent(events, today = localToday()) {
  return [...events]
    .filter(event => event.date && event.date >= today)
    .sort((left, right) => (left.startTime || left.date).localeCompare(right.startTime || right.date))[0] || null
}

module.exports = {
  artistMatches,
  countryIdentity,
  countryMatches,
  dateKey,
  earliestEvent,
  formatDateLabel,
  localToday,
  locationMatches,
  normalize,
  normalizeEvent,
  normalizeWords,
}
