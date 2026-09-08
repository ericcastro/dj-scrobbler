function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

const EDITABLE_METADATA_FIELDS = new Set(['djNames', 'venue', 'event', 'date'])

function metadataValueKey(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function normalizeIgnoredMetadataValues(values) {
  if (!Array.isArray(values)) return []
  const seen = new Set()
  return values.flatMap(entry => {
    const field = entry?.field
    const value = clean(entry?.value)
    if (!EDITABLE_METADATA_FIELDS.has(field) || !value) return []
    const key = `${field}:${metadataValueKey(value)}`
    if (seen.has(key)) return []
    seen.add(key)
    return [{ field, value }]
  }).slice(0, 32)
}

function isMetadataValueIgnored(values, field, value) {
  const key = metadataValueKey(value)
  return !!key && normalizeIgnoredMetadataValues(values).some(entry => (
    entry.field === field && metadataValueKey(entry.value) === key
  ))
}

function normalizeSetMetadata(metadata) {
  const djNames = Array.isArray(metadata?.djNames)
    ? [...new Set(metadata.djNames.map(clean).filter(Boolean))]
    : []
  const date = clean(metadata?.date)

  return {
    djNames,
    venue: clean(metadata?.venue),
    event: clean(metadata?.event),
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
  }
}

function hasSetMetadata(metadata) {
  return !!metadata && (
    metadata.djNames.length > 0 ||
    !!metadata.venue ||
    !!metadata.event ||
    !!metadata.date
  )
}

module.exports = {
  hasSetMetadata,
  isMetadataValueIgnored,
  normalizeIgnoredMetadataValues,
  normalizeSetMetadata,
}
