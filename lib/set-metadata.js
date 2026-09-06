function clean(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
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

module.exports = { hasSetMetadata, normalizeSetMetadata }
