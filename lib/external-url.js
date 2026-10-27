function isAllowedExternalUrl(value, allowedHosts) {
  try {
    const { hostname, protocol } = new URL(value)
    if (protocol === 'mailto:') return true
    if (protocol !== 'https:' && protocol !== 'http:') return false
    return allowedHosts.some(host => hostname === host || hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}

module.exports = { isAllowedExternalUrl }
