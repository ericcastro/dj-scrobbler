function cleanVersion(version) {
  return String(version || '').trim().replace(/^v/i, '')
}

function compareVersions(a, b) {
  const pa = cleanVersion(a).split(/[.-]/).map(n => Number.parseInt(n, 10) || 0)
  const pb = cleanVersion(b).split(/[.-]/).map(n => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

function releaseFromGitHub(data, { currentVersion, releasesUrl }) {
  const latestVersion = cleanVersion(data?.tag_name || data?.name)
  return {
    currentVersion,
    latestVersion,
    tagName: data?.tag_name || null,
    releaseName: data?.name || `DJ Scrobbler ${latestVersion}`,
    releaseUrl: data?.html_url || releasesUrl,
    publishedAt: data?.published_at || null,
    changelog: (data?.body || '').trim(),
    canInstall: true,
    prerelease: !!data?.prerelease,
  }
}

function releaseFromUpdateInfo(info, { currentVersion, releasesUrl, canInstall }) {
  const latestVersion = cleanVersion(info?.version)
  const notes = Array.isArray(info?.releaseNotes)
    ? info.releaseNotes.map(note => note.note || note).join('\n\n')
    : (info?.releaseNotes || '')
  return {
    currentVersion,
    latestVersion,
    releaseName: info?.releaseName || `DJ Scrobbler ${latestVersion}`,
    releaseUrl: releasesUrl,
    publishedAt: info?.releaseDate || null,
    changelog: String(notes || '').trim(),
    canInstall: !!canInstall,
  }
}

function mergeUpdateStatus(previousState, status, payload = {}) {
  const nextVersion = payload.latestVersion || previousState.latestVersion
  const nextChangelog = String(payload.changelog || '').trim()
  const previousChangelog = String(previousState.changelog || '').trim()
  const shouldKeepPreviousChangelog = !nextChangelog &&
    previousChangelog &&
    cleanVersion(nextVersion) === cleanVersion(previousState.latestVersion)

  return {
    ...previousState,
    ...payload,
    latestVersion: nextVersion,
    changelog: shouldKeepPreviousChangelog ? previousChangelog : (payload.changelog ?? previousState.changelog),
    status,
    isChecking: status === 'checking',
    error: payload.error || null,
  }
}

module.exports = {
  cleanVersion,
  compareVersions,
  releaseFromGitHub,
  releaseFromUpdateInfo,
  mergeUpdateStatus,
}
