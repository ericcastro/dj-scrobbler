# Changelog

## [0.6.0] - 2026-09-08

### Added

- Search 1001Tracklists and set79 in parallel, with provider switching and cached results.
- Add set metadata for DJs, events, venues, and dates, with Library views grouped by each.
- Show upcoming DJ events near a saved city using Resident Advisor and Shotgun.
- Record listening time, track counts, daily history, and DJ/set attribution locally.
- Enrich missing track artwork through conservative Deezer matching.
- Add themed mini-player source status, playback progress, and richer set metadata UI.

### Changed

- Keep playback app-owned and independent from tracklist provider timing.
- Prefer exact artist, city, country, and provider matches over fuzzy substitutions.
- Persist application data atomically and keep private caches in the main process.
- Refresh stale tracklist data after its seven-day cache lifetime.

### Fixed

- Prevent stale or overlapping player polls from updating a newer set.
- Make Last.fm scrobble thresholds use validated playback intervals rather than wall-clock gaps.
- Preserve explicit metadata removals across restarts and cache backfills.
- Bound browser-backed event lookups so navigation or page scripts cannot hang indefinitely.
- Correct undefined CSS variables and remove obsolete playback hooks and preload code.
- Fix macOS nested-framework signing and verify the completed bundle before publishing.

### Verification

- 220 automated tests pass.
- macOS arm64 packaging and strict code-signature verification pass.

## [0.5.8] - 2026-05-04

- Previous stable release.
