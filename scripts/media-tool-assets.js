const FFMPEG_VERSION = '6.1.1'
const YTDLP_VERSION = '2026.08.19'
const FFMPEG_SOURCE = {
  url: 'https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz',
  sha256: '8684f4b00f94b85461884c3719382f1261f0d9eb3d59640a1f4ac0873616f968',
}

const platforms = {
  'darwin-arm64': {
    ytdlp: ['yt-dlp_macos', '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202'],
  },
  'darwin-x64': {
    ytdlp: ['yt-dlp_macos', '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202'],
  },
  'linux-arm64': {
    ytdlp: ['yt-dlp_linux_aarch64', 'b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc'],
  },
  'linux-x64': {
    ytdlp: ['yt-dlp_linux', '58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a'],
  },
  'win32-x64': {
    ytdlp: ['yt-dlp.exe', '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a'],
  },
}

function assetsFor(platform, arch) {
  const entry = platforms[`${platform}-${arch}`]
  if (!entry) throw new Error(`Unsupported media-tool target: ${platform}-${arch}`)
  const ytdlpBase = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}`
  return [
    { tool: 'ffmpeg', output: platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg', ...FFMPEG_SOURCE, buildFromSource: true },
    { tool: 'ffmpeg-license', output: 'ffmpeg.LICENSE', url: 'https://raw.githubusercontent.com/FFmpeg/FFmpeg/n6.1.1/COPYING.LGPLv2.1', sha256: 'b634ab5640e258563c536e658cad87080553df6f34f62269a21d554844e58bfe' },
    { tool: 'yt-dlp', output: platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp', url: `${ytdlpBase}/${entry.ytdlp[0]}`, sha256: entry.ytdlp[1], executable: true },
    { tool: 'yt-dlp-license', output: 'yt-dlp.LICENSE', url: `https://raw.githubusercontent.com/yt-dlp/yt-dlp/${YTDLP_VERSION}/LICENSE`, sha256: '7e12e5df4bae12cb21581ba157ced20e1986a0508dd10d0e8a4ab9a4cf94e85c' },
  ]
}

module.exports = { FFMPEG_VERSION, FFMPEG_SOURCE, YTDLP_VERSION, assetsFor, platforms }
