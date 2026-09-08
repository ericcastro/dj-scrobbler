const childProcess = require('node:child_process')
const path = require('node:path')
const { promisify } = require('node:util')

const { SourceUnavailableError } = require('./http')

const RESULT_MARKER = '__SHOTGUN_BROWSER_RESULT__'

async function searchShotgunInBrowser(artist, options = {}) {
  const timeoutMs = options.timeoutMs || 25_000
  const execFile = options.execFile || promisify(childProcess.execFile)
  let electronPath
  try {
    electronPath = options.electronPath || require('electron')
  } catch {
    throw new SourceUnavailableError('Shotgun needs the project Electron runtime for browser search', 'browser-missing')
  }

  const helperPath = path.join(__dirname, 'shotgun-browser.js')
  let stdout
  try {
    const result = await execFile(electronPath, [helperPath, artist, String(timeoutMs)], {
      timeout: timeoutMs + 5_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    })
    stdout = result.stdout
  } catch (error) {
    const parsed = parseBrowserOutput(error.stdout)
    throw new SourceUnavailableError(
      parsed?.error || `Shotgun browser search failed: ${error.message}`,
      'browser',
    )
  }

  const parsed = parseBrowserOutput(stdout)
  if (!parsed) throw new SourceUnavailableError('Shotgun browser search returned no result', 'browser')
  if (!parsed.ok) throw new SourceUnavailableError(parsed.error || 'Shotgun browser search failed', 'browser')
  return parsed.events || []
}

function parseBrowserOutput(stdout) {
  const line = String(stdout || '').split(/\r?\n/).find(value => value.startsWith(RESULT_MARKER))
  if (!line) return null
  try {
    return JSON.parse(line.slice(RESULT_MARKER.length))
  } catch {
    return null
  }
}

module.exports = { parseBrowserOutput, searchShotgunInBrowser }
