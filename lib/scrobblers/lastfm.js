/**
 * Last.fm Scrobble Target.
 *
 * Speaks the Last.fm Web Services API (https://www.last.fm/api) with the
 * desktop-app web auth flow: auth.getToken → browser approval → auth.getSession.
 *
 * The API key/secret below are registered to DJ Scrobbler. As with all desktop
 * scrobblers they are shipped in the clear; Last.fm treats these client
 * credentials as semi-public (the session key is the actual secret, obtained
 * per-user via the auth flow).
 */

const https = require('https')
const crypto = require('crypto')

const LFM_KEY    = 'f3f24407f4bd2142b31d27fb47461e05'
const LFM_SECRET = '5c9447b7b09a1514c64aab54002645db'

function lfmSign(params) {
  const str = Object.keys(params)
    .filter(k => k !== 'format')
    .sort()
    .map(k => k + params[k])
    .join('') + LFM_SECRET
  return crypto.createHash('md5').update(str, 'utf8').digest('hex')
}

function lfmPost(params) {
  return new Promise((resolve, reject) => {
    const p = { ...params, api_key: LFM_KEY, format: 'json' }
    p.api_sig = lfmSign(p)
    const body = new URLSearchParams(p).toString()
    const req = https.request({
      hostname: 'ws.audioscrobbler.com',
      path: '/2.0/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'dj-scrobbler/0.1',
      },
    }, res => {
      const chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
        catch (e) { reject(e) }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/**
 * @param {object} deps
 * @param {(url: string) => void} deps.openExternal  opens a URL in the system browser
 * @param {(status: 'unconfigured'|'ok'|'error') => void} deps.onStatus
 */
function createLastfmScrobbler({ openExternal, onStatus }) {
  return {
    id: 'lastfm',
    label: 'Last.fm',
    /** @type {{ key: string, name: string } | null} */
    session: null,

    restore(session) {
      this.session = session || null
      if (this.session) onStatus('ok')
    },

    async connect() {
      const tokenRes = await lfmPost({ method: 'auth.getToken' })
      if (!tokenRes.token) throw new Error('Could not get auth token from Last.fm')
      const token = tokenRes.token

      openExternal(`https://www.last.fm/api/auth/?api_key=${LFM_KEY}&token=${token}`)

      return new Promise((resolve, reject) => {
        let attempts = 0
        const iv = setInterval(async () => {
          attempts++
          if (attempts > 45) {
            clearInterval(iv)
            reject(new Error('Timed out waiting for Last.fm authorisation'))
            return
          }
          try {
            const res = await lfmPost({ method: 'auth.getSession', token })
            if (res.session) {
              clearInterval(iv)
              this.session = { key: res.session.key, name: res.session.name }
              onStatus('ok')
              resolve(this.session)
            }
          } catch {}
        }, 2000)
      })
    },

    disconnect() {
      this.session = null
      onStatus('unconfigured')
    },

    nowPlaying(artist, title) {
      if (!this.session?.key) return
      lfmPost({ method: 'track.updateNowPlaying', artist, track: title, sk: this.session.key })
        .then(res => onStatus(res.error ? 'error' : 'ok'))
        .catch(() => onStatus('error'))
    },

    scrobble(artist, title, startedAt, album) {
      if (!this.session?.key || !artist || !title) return
      const params = {
        method: 'track.scrobble',
        'artist[0]': artist,
        'track[0]': title,
        'timestamp[0]': String(Math.floor(startedAt / 1000)),
        sk: this.session.key,
      }
      if (album) params['album[0]'] = album
      lfmPost(params)
        .then(res => onStatus(res.error ? 'error' : 'ok'))
        .catch(() => onStatus('error'))
    },
  }
}

module.exports = { createLastfmScrobbler }
