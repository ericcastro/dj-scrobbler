const fs = require('node:fs')
const path = require('node:path')

const TOOL_ENV = {
  ffmpeg: 'DJ_SCROBBLER_FFMPEG',
  'yt-dlp': 'DJ_SCROBBLER_YTDLP',
}

function executableName(tool, platform = process.platform) {
  if (!TOOL_ENV[tool]) throw new Error(`Unknown media tool: ${tool}`)
  return platform === 'win32' ? `${tool}.exe` : tool
}

function resolveMediaTool(tool, options = {}) {
  const platform = options.platform || process.platform
  const env = options.env || process.env
  const override = env[TOOL_ENV[tool]]
  if (override) return override

  const electron = options.isPackaged === undefined ? require('electron') : null
  const isPackaged = options.isPackaged ?? !!electron?.app?.isPackaged
  const resourcesPath = options.resourcesPath || process.resourcesPath
  if (isPackaged) {
    const bundled = path.join(resourcesPath, 'bin', executableName(tool, platform))
    const exists = options.existsSync || fs.existsSync
    if (!exists(bundled)) {
      throw new Error(`${tool} is missing from the application bundle (${bundled}).`)
    }
    return bundled
  }

  // Development remains convenient while release builds are self-contained.
  return executableName(tool, platform)
}

module.exports = { executableName, resolveMediaTool }
