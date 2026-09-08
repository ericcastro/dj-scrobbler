const { dateFromText, dateKey, normalizeWords } = require('./core')

function decodeHtml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/gi, '/')
}

function stripTags(value) {
  return decodeHtml(String(value || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function eventLinks(html, baseUrl, pattern) {
  const links = []
  const seen = new Set()
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  for (const match of String(html || '').matchAll(re)) {
    const url = new URL(decodeHtml(match[1]), baseUrl).href
    if (!pattern.test(new URL(url).pathname) || seen.has(url)) continue
    seen.add(url)
    links.push({ url, text: stripTags(match[2]) })
  }
  return links
}

function jsonLdEvents(html, url) {
  const events = []
  const scripts = String(html || '').matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const match of scripts) {
    try {
      visitJsonLd(JSON.parse(decodeHtml(match[1])), value => {
        const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']]
        if (!types.includes('Event') && !types.includes('MusicEvent')) return
        events.push(eventFromJsonLd(value, url))
      })
    } catch {
      // Ignore malformed analytics/SEO blocks and continue with other blocks.
    }
  }
  return events.filter(Boolean)
}

function visitJsonLd(value, visit) {
  if (Array.isArray(value)) return value.forEach(item => visitJsonLd(item, visit))
  if (!value || typeof value !== 'object') return
  visit(value)
  if (value['@graph']) visitJsonLd(value['@graph'], visit)
  if (value.itemListElement) visitJsonLd(value.itemListElement, visit)
  if (value.item) visitJsonLd(value.item, visit)
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
    url: new URL(value.url || fallbackUrl).href,
  }
}

function looseEventFromPage(html, url) {
  const text = stripTags(html)
  const title = stripTags(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    || html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    || '')
    .replace(/^Passline\s*-\s*/i, '')
  const date = dateFromText(text)
  const time = normalizeWords(text).match(/\b(\d{1,2}:\d{2})\s*(?:hrs?)?\b/)?.[1]
  return date ? {
    id: url,
    title,
    date,
    startTime: time ? `${date}T${time.padStart(5, '0')}:00` : null,
    venue: null,
    city: null,
    country: null,
    artists: [],
    description: text,
    url,
  } : null
}

module.exports = { decodeHtml, eventFromJsonLd, eventLinks, jsonLdEvents, looseEventFromPage, stripTags }
