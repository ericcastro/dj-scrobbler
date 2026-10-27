const CASTING_COMING_SOON = 'Casting is experimental and available on macOS only. Windows and Linux support is coming soon.'

function castingSupportForPlatform(platform = process.platform) {
  return {
    supported: platform === 'darwin',
    experimental: true,
    availabilityMessage: CASTING_COMING_SOON,
  }
}

module.exports = { CASTING_COMING_SOON, castingSupportForPlatform }
