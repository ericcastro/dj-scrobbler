function settleProviderLookup(provider, lookup) {
  if (!provider) return Promise.resolve(null)

  try {
    return Promise.resolve(lookup(provider)).then(
      result => ({ provider, result, error: null }),
      error => ({ provider, result: null, error })
    )
  } catch (error) {
    return Promise.resolve({ provider, result: null, error })
  }
}

function isUsable(outcome) {
  return !!outcome?.result?.usable
}

/**
 * Start both provider lookups immediately. By default, `selected` resolves as
 * soon as the primary is usable; a persisted explicit preference can reverse
 * that choice for one set. Each lookup settles into an outcome object so one
 * provider can never reject or cancel the other.
 */
function startPrimaryWithFallback({ primaryProvider, fallbackProvider, preferredProviderId = null, lookup }) {
  const primary = settleProviderLookup(primaryProvider, lookup)
  const fallback = settleProviderLookup(fallbackProvider, lookup)

  const selected = (async () => {
    // A previous explicit choice reverses precedence for this set only. If the
    // preferred provider is no longer usable, gracefully fall back to primary.
    if (fallbackProvider?.id === preferredProviderId) {
      const fallbackOutcome = await fallback
      if (isUsable(fallbackOutcome)) {
        return { selected: fallbackOutcome, primary: null, fallback: fallbackOutcome }
      }
      const primaryOutcome = await primary
      return {
        selected: isUsable(primaryOutcome) ? primaryOutcome : null,
        primary: primaryOutcome,
        fallback: fallbackOutcome,
      }
    }

    const primaryOutcome = await primary
    if (isUsable(primaryOutcome)) {
      return { selected: primaryOutcome, primary: primaryOutcome, fallback: null }
    }

    const fallbackOutcome = await fallback
    return {
      selected: isUsable(fallbackOutcome) ? fallbackOutcome : null,
      primary: primaryOutcome,
      fallback: fallbackOutcome,
    }
  })()

  return { primary, fallback, selected }
}

module.exports = {
  isUsable,
  settleProviderLookup,
  startPrimaryWithFallback,
}
