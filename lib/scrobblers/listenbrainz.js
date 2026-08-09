/**
 * ListenBrainz-protocol Scrobble Target.
 *
 * Speaks the ListenBrainz submit-listens API (https://listenbrainz.readthedocs.io/en/latest/users/json.html)
 * against a user-configured server. Intended for scrobbling to a self-hosted
 * Multi-Scrobbler instance (its ListenBrainz endpoint), which relays listens
 * onward to services like a local ListenBrainz — but also works pointed
 * directly at any ListenBrainz-compatible server.
 *
 * Auth is a single token sent as `Authorization: Token <token>`. There is no
 * session dance: "connect" means "validate the token eagerly, then remember it".
 */

/**
 * Normalise a user-entered server URL: trim, require http(s), strip trailing
 * slashes and a trailing `/1/submit-listens` style path so both base URLs and
 * pasted endpoint URLs work.
 */
function normaliseBaseUrl(raw) {
  let url
  try {
    url = new URL(String(raw || '').trim())
  } catch {
    throw new Error('Enter a full URL, e.g. http://localhost:9078')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Server URL must start with http:// or https://')
  }
  url.pathname = url.pathname.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

/**
 * @param {object} deps
 * @param {(status: 'unconfigured'|'ok'|'error') => void} deps.onStatus
 */
function createListenBrainzScrobbler({ onStatus }) {
  /** @type {{ url: string, token: string } | null} */
  let config = null

  async function submit(body) {
    const res = await fetch(`${config.url}/1/submit-listens`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${config.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'dj-scrobbler/0.1',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Server returned ${res.status}`)
    return res.json().catch(() => ({}))
  }

  function listenEntry(artist, title, startedAt, album) {
    const track_metadata = { artist_name: artist, track_name: title }
    if (album) track_metadata.release_name = album
    const entry = { track_metadata }
    if (startedAt) entry.listened_at = Math.floor(startedAt / 1000)
    return entry
  }

  return {
    id: 'listenbrainz',
    label: 'Multi-Scrobbler / ListenBrainz',

    get config() { return config },

    restore(saved) {
      config = saved?.url && saved?.token ? { url: saved.url, token: saved.token } : null
      if (config) onStatus('ok')
    },

    async connect({ url, token }) {
      const base = normaliseBaseUrl(url)
      const t = String(token || '').trim()
      if (!t) throw new Error('Enter your API token')

      // Eager validation. NOTE: Multi-Scrobbler's /1/validate-token answers
      // 200 valid:true even for WRONG tokens (generic fallback), so it cannot
      // be trusted. An empty playing_now submission is the reliable probe:
      // real ListenBrainz answers 200/401, Multi-Scrobbler answers 200/409.
      let res
      try {
        res = await fetch(`${base}/1/submit-listens`, {
          method: 'POST',
          headers: { 'Authorization': `Token ${t}`, 'Content-Type': 'application/json', 'User-Agent': 'dj-scrobbler/0.1' },
          body: JSON.stringify({ listen_type: 'playing_now', payload: [] }),
        })
      } catch {
        throw new Error(`Could not reach ${base} — check the URL and that the server is running`)
      }
      if (res.status === 401 || res.status === 403 || res.status === 409) {
        throw new Error('Server rejected the token')
      }
      if (!res.ok) throw new Error(`Server returned ${res.status} — is this a ListenBrainz-compatible endpoint?`)

      config = { url: base, token: t }
      onStatus('ok')
      return { name: base }
    },

    disconnect() {
      config = null
      onStatus('unconfigured')
    },

    nowPlaying(artist, title, album) {
      if (!config || !artist || !title) return
      submit({ listen_type: 'playing_now', payload: [listenEntry(artist, title, null, album)] })
        .then(() => onStatus('ok'))
        .catch(() => onStatus('error'))
    },

    scrobble(artist, title, startedAt, album) {
      if (!config || !artist || !title) return
      submit({ listen_type: 'single', payload: [listenEntry(artist, title, startedAt, album)] })
        .then(() => onStatus('ok'))
        .catch(() => onStatus('error'))
    },
  }
}

module.exports = { createListenBrainzScrobbler, normaliseBaseUrl }
