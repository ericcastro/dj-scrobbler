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

function developmentMediaToolsDirectory(options = {}) {
  const platform = options.platform || process.platform
  const arch = options.arch || process.arch
  const projectRoot = options.projectRoot || path.join(__dirname, '..')
  return path.join(projectRoot, 'node_modules', '.cache', 'dj-scrobbler-media-tools', `runtime-${platform}-${arch}`)
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

  // Development uses the same pinned, checksum-verified tools as release builds.
  // Falling back to PATH made recognition depend on whatever yt-dlp happened to
  // be installed on the machine; stale versions can resolve media URLs that
  // YouTube immediately rejects with HTTP 403.
  const developmentTool = path.join(
    developmentMediaToolsDirectory({ ...options, platform }),
    executableName(tool, platform),
  )
  const exists = options.existsSync || fs.existsSync
  if (!exists(developmentTool)) {
    throw new Error(`${tool} is missing from the development runtime (${developmentTool}). Run npm run prepare:media.`)
  }
  return developmentTool
}

module.exports = { developmentMediaToolsDirectory, executableName, resolveMediaTool }
