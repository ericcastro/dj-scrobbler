class SourceUnavailableError extends Error {
  constructor(message, code = 'unavailable') {
    super(message)
    this.name = 'SourceUnavailableError'
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
        'User-Agent': 'Mozilla/5.0',
        ...(options.headers || {}),
      },
      body: options.body,
    })
    const body = await response.text()
    if (response.status === 403 || response.status === 429 || looksLikeChallenge(body)) {
      throw new SourceUnavailableError(`${options.sourceName || 'Source'} blocked the direct POC request`, 'challenge')
    }
    if (!response.ok) {
      throw new SourceUnavailableError(`${options.sourceName || 'Source'} returned HTTP ${response.status}`, 'http')
    }
    return body
  } catch (err) {
    if (err instanceof SourceUnavailableError) throw err
    if (err.name === 'AbortError') {
      throw new SourceUnavailableError(`${options.sourceName || 'Source'} timed out`, 'timeout')
    }
    throw new SourceUnavailableError(`${options.sourceName || 'Source'} request failed: ${err.message}`, 'network')
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, options)
  try {
    return JSON.parse(text)
  } catch {
    throw new SourceUnavailableError(`${options.sourceName || 'Source'} returned invalid JSON`, 'invalid-json')
  }
}

function looksLikeChallenge(body) {
  const sample = String(body || '').slice(0, 100_000).toLowerCase()
  return sample.includes('vercel challenge')
    || sample.includes('performing security verification')
    || sample.includes('cf-chl-')
    || sample.includes('captcha-delivery.com')
}

module.exports = { SourceUnavailableError, fetchJson, fetchText, looksLikeChallenge }
