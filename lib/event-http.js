class EventSourceUnavailableError extends Error {
  constructor(message, code = 'unavailable') {
    super(message)
    this.name = 'EventSourceUnavailableError'
    this.code = code
  }
}

async function fetchText(url, options = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 15_000)
  try {
    const response = await (options.fetchImpl || globalThis.fetch)(url, {
      method: options.method || 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': options.userAgent || 'DJ-Scrobbler',
        ...(options.headers || {}),
      },
      body: options.body,
    })
    const body = await response.text()
    if (!response.ok) {
      throw new EventSourceUnavailableError(`${options.sourceName || 'Event source'} returned HTTP ${response.status}`, 'http')
    }
    return body
  } catch (error) {
    if (error instanceof EventSourceUnavailableError) throw error
    if (error.name === 'AbortError') {
      throw new EventSourceUnavailableError(`${options.sourceName || 'Event source'} timed out`, 'timeout')
    }
    throw new EventSourceUnavailableError(`${options.sourceName || 'Event source'} request failed: ${error.message}`, 'network')
  } finally {
    clearTimeout(timeout)
  }
}

module.exports = { EventSourceUnavailableError, fetchText }
