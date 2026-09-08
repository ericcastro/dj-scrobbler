let searchQueue = Promise.resolve()

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor(window, expression, deadline) {
  while (Date.now() < deadline) {
    if (window.isDestroyed()) throw new Error('Shotgun browser closed during search')
    const value = await window.webContents.executeJavaScript(expression, true).catch(() => null)
    if (value) return value
    await delay(250)
  }
  throw new Error('Shotgun browser search timed out')
}

async function runSearch(artist, options = {}) {
  const query = String(artist || '').trim()
  if (!query) return []
  const timeoutMs = options.timeoutMs || 25_000
  const deadline = Date.now() + timeoutMs
  const BrowserWindow = options.BrowserWindow || require('electron').BrowserWindow
  const window = new BrowserWindow({
    show: false,
    parent: options.parentWindow || undefined,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: 'persist:dj-scrobbler-shotgun',
    },
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  try {
    await window.loadURL(`https://shotgun.live/en/search?query=${encodeURIComponent(query)}`)
    await waitFor(window, 'Boolean(document.querySelector(\'input[type="text"], input[type="search"], input\'))', deadline)
    await delay(500)
    await window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('input[type="text"], input[type="search"], input')
      input.focus()
      input.select()
      return true
    })()`, true)
    window.webContents.insertText(query)

    const links = await waitFor(window, `(() => {
      const links = [...document.querySelectorAll('a[href*="/events/"]')]
        .map(link => ({ url: new URL(link.href, location.href).href, text: link.innerText }))
      if (!links.length) return null
      return [...new Map(links.map(link => [link.url, link])).values()].slice(0, 12)
    })()`, deadline)

    return await window.webContents.executeJavaScript(`(async () => {
      const links = ${JSON.stringify(links)}
      const settled = await Promise.allSettled(links.map(async resultLink => {
        const response = await fetch(resultLink.url, { credentials: 'include' })
        if (!response.ok) throw new Error('HTTP ' + response.status)
        const html = await response.text()
        const document = new DOMParser().parseFromString(html, 'text/html')
        const values = [...document.querySelectorAll('script[type="application/ld+json"]')]
          .map(script => {
            try { return JSON.parse(script.textContent) } catch { return null }
          })
          .filter(Boolean)
        const flattened = values.flatMap(value => Array.isArray(value) ? value : value['@graph'] || [value])
        const event = flattened.find(value => {
          const types = Array.isArray(value?.['@type']) ? value['@type'] : [value?.['@type']]
          return types.includes('Event') || types.includes('MusicEvent')
        })
        if (!event) return null
        const displayedTime = String(resultLink.text || '').match(/\\b(\\d{1,2}):(\\d{2})\\s*([AP]M)\\b/i)
        let localStartTime = null
        if (displayedTime) {
          let hour = Number(displayedTime[1]) % 12
          if (displayedTime[3].toUpperCase() === 'PM') hour += 12
          localStartTime = String(hour).padStart(2, '0') + ':' + displayedTime[2]
        }
        if (!localStartTime) {
          localStartTime = String(event.description || '').match(/(?:^|\\n)\\s*(\\d{1,2}:\\d{2})\\s*(?:→|—|-|to)/im)?.[1] || null
        }
        return {
          url: resultLink.url,
          localStartTime,
          event: {
            '@type': event['@type'],
            name: event.name,
            url: event.url,
            startDate: event.startDate,
            description: event.description,
            location: event.location,
            performer: event.performer,
          },
        }
      }))
      return settled
        .filter(item => item.status === 'fulfilled' && item.value)
        .map(item => item.value)
    })()`, true)
  } finally {
    if (!window.isDestroyed()) window.destroy()
  }
}

function searchShotgunInBrowser(artist, options = {}) {
  const search = searchQueue.catch(() => {}).then(() => runSearch(artist, options))
  searchQueue = search
  return search
}

module.exports = { searchShotgunInBrowser }
