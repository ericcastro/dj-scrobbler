const FFMPEG_VERSION = 'b6.1.1'
const YTDLP_VERSION = '2026.08.19'

const platforms = {
  'darwin-arm64': {
    ffmpeg: ['ffmpeg-darwin-arm64', 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584'],
    ffmpegLicense: ['darwin-arm64.LICENSE', 'cb48bf09a11f5fb576cddb0431c8f5ed0a60157a9ec942adffc13907cbe083f2'],
    ytdlp: ['yt-dlp_macos', '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202'],
  },
  'darwin-x64': {
    ffmpeg: ['ffmpeg-darwin-x64', 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894'],
    ffmpegLicense: ['darwin-x64.LICENSE', '2e1d16c72fd74e12063776371da757322f8b77589386532f4fd8634bde7de1af'],
    ytdlp: ['yt-dlp_macos', '0f192b7ec147ab6288885d6351d9ab67367640029b4377576ef46dd79cf7b202'],
  },
  'linux-arm64': {
    ffmpeg: ['ffmpeg-linux-arm64', '6bb182d0d75d23028db82e9e4f723ca69b853d055698486e6984ddb2c06fb8ce'],
    ffmpegLicense: ['linux-arm64.LICENSE', '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903'],
    ytdlp: ['yt-dlp_linux_aarch64', 'b16e4dab368a816cd05d477d698a605a6ae87ccee1c8ffd38fa21d7254141fcc'],
  },
  'linux-x64': {
    ffmpeg: ['ffmpeg-linux-x64', 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99'],
    ffmpegLicense: ['linux-x64.LICENSE', '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903'],
    ytdlp: ['yt-dlp_linux', '58162f9bfdc27458ea47bfcb311cf47028f17d8154a8bf7d689861d46399230a'],
  },
  'win32-x64': {
    ffmpeg: ['ffmpeg-win32-x64', '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00'],
    ffmpegLicense: ['win32-x64.LICENSE', '8ceb4b9ee5adedde47b31e975c1d90c73ad27b6b165a1dcd80c7c545eb65b903'],
    ytdlp: ['yt-dlp.exe', '66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a'],
  },
}

function assetsFor(platform, arch) {
  const entry = platforms[`${platform}-${arch}`]
  if (!entry) throw new Error(`Unsupported media-tool target: ${platform}-${arch}`)
  const ffmpegBase = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_VERSION}`
  const ytdlpBase = `https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}`
  return [
    { tool: 'ffmpeg', output: platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg', url: `${ffmpegBase}/${entry.ffmpeg[0]}`, sha256: entry.ffmpeg[1], executable: true },
    { tool: 'ffmpeg-license', output: 'ffmpeg.LICENSE', url: `${ffmpegBase}/${entry.ffmpegLicense[0]}`, sha256: entry.ffmpegLicense[1] },
    { tool: 'yt-dlp', output: platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp', url: `${ytdlpBase}/${entry.ytdlp[0]}`, sha256: entry.ytdlp[1], executable: true },
    { tool: 'yt-dlp-license', output: 'yt-dlp.LICENSE', url: `https://raw.githubusercontent.com/yt-dlp/yt-dlp/${YTDLP_VERSION}/LICENSE`, sha256: '7e12e5df4bae12cb21581ba157ced20e1986a0508dd10d0e8a4ab9a4cf94e85c' },
  ]
}

module.exports = { FFMPEG_VERSION, YTDLP_VERSION, assetsFor, platforms }
