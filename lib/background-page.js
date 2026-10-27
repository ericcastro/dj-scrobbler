// Keep hidden provider windows bounded and close them on every completion path.
// Both page events and loadURL's promise can report the same navigation failure.
function extractFromBackgroundPage({ BrowserWindow, url, windowOptions, timeoutMs, fallback, extract, onError = () => {} }) {
  return new Promise(resolve => {
    const window = new BrowserWindow({ ...windowOptions, show: false })
    const contents = window.webContents
    let settled = false
    let extracting = false
    const finish = value => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!window.isDestroyed()) window.destroy()
      resolve(value)
    }
    const fail = error => {
      if (settled) return
      onError(error)
      finish(fallback)
    }
    const timer = setTimeout(() => fail(new Error('Provider page extraction timed out.')), timeoutMs)
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('did-finish-load', async () => {
      if (settled || extracting) return
      extracting = true
      try {
        finish(await extract(contents))
      } catch (error) {
        fail(error)
      }
    })
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (isMainFrame) fail(new Error(`Provider navigation failed (${code}): ${description}`))
    })
    contents.on('render-process-gone', () => fail(new Error('Provider page renderer stopped.')))
    window.once('closed', () => finish(fallback))
    try {
      Promise.resolve(window.loadURL(url)).catch(fail)
    } catch (error) {
      fail(error)
    }
  })
}

module.exports = { extractFromBackgroundPage }
