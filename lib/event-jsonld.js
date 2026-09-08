const { dateKey } = require('./event-lookup-core')

function stripTags(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function eventFromJsonLd(value, fallbackUrl) {
  const place = value.location || {}
  const address = place.address || {}
  const performers = Array.isArray(value.performer) ? value.performer : value.performer ? [value.performer] : []
  const startTime = value.startDate || null
  return {
    id: value.identifier || value['@id'] || value.url || fallbackUrl,
    title: value.name || null,
    date: dateKey(startTime),
    startTime,
    venue: place.name || null,
    city: address.addressLocality || null,
    country: typeof address.addressCountry === 'string' ? address.addressCountry : address.addressCountry?.name,
    artists: performers.map(item => typeof item === 'string' ? item : item.name).filter(Boolean),
    description: stripTags(value.description || ''),
    url: new URL(value.url || fallbackUrl, fallbackUrl).href,
  }
}

module.exports = { eventFromJsonLd, stripTags }
