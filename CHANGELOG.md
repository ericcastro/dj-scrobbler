# Changelog

## [0.6.1] - 2026-09-09

### Added

- Cache event lookups privately until the next local day to avoid repeat network checks.
- Show upcoming local DJ events as compact announcements with source links and rotating understated emotes.

### Changed

- Refine the metadata editor with title-based suggestions, one-click acceptance, clearer recovery wording, and manual entry paths.
- Make lookup and event-source status more legible with loading animation, reduced-motion support, and compact source pills.
- Polish event announcement hierarchy, location controls, and sidebar selected-state behavior.

### Fixed

- Skip automatic tracklist, metadata, and event lookups for confirmed videos under ten minutes; **Auto** remains an explicit override.
- Keep useful metadata suggestions visible after a no-match response.
- Restore `ID - ID` in the mini-player for unidentified tracks.
- Prevent short-video duration detection from racing ahead of cached metadata and triggering event lookups.

### Verification

- 224 automated tests pass locally.

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
