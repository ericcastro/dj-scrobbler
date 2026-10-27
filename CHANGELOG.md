# Changelog

## [0.7.1] - 2026-10-28

### Security

- Resolve all 65 unique OSV advisories reported against the 0.7.0 dependency lockfile (77 package/advisory findings). Upgrade Electron to 43.8.4, electron-builder to 26.18.0, electron-updater to 6.8.11, and affected transitive dependencies.
- Remove the vulnerable `extract-zip` package through Electron's maintained extraction dependency. No vulnerability suppressions or dependency overrides are used.
- Add OSV scanning to CI and require a passing scan before release builds start.
- Require Node.js 22.12 or newer for development and install Electron explicitly after dependency installation.

### Casting availability

- Casting remains **experimental and macOS only**. **Windows and Linux casting support is coming soon.** Installers remain available for all three platforms, and macOS 12 support is retained.
- See [the SCA remediation record](docs/security/2026-10-28-sca.md) for affected packages and verification scope.

## [0.7.0] - 2026-10-27

### Experimental casting

- **Casting is experimental and macOS-only** in this release, supporting Chromecast and AirPlay.
- **Windows and Linux casting support is coming soon.** Casting is disabled there; playback, tracklists, recognition, and scrobbling remain available.

### Added

- Build editable, timestamped tracklists with background Shazam recognition when published providers have no usable result.
- Prefer timestamped YouTube descriptions, then inspect a bounded number of comments for community tracklists.
- Send the focus view, player audio, and overlays to Chromecast or AirPlay on macOS through an experimental HLS stream.
- Bundle pinned, checksum-verified FFmpeg and yt-dlp tools for recognition and casting.
- Add focus-window controls, always-on-top playback, YouTube quality selection, and improved keyboard seeking.

### Changed

- Keep provider lookup progress compact while playback and the tracklist layout remain visible.
- Consolidate hidden provider-page extraction and subprocess shutdown, with runtime coverage for failure and cancellation paths.
- Validate release versions, changelog entries, and publishing tags in CI.

### Fixed

- Preserve complete audio command output and wait for process shutdown before removing temporary files.
- Close failed Chromecast connections and pending response waits; handle buffering and playing messages arriving together.
- Prevent stale casting failures or cleanup from stopping a replacement session, and close active HLS requests during teardown.
- Stop provider windows and readiness polling on failure or timeout; recover browser navigation after a provider error.
- Keep pending cover lookups running after an ID edit and prevent old ambiguous splits from overwriting manual corrections.
- Put accepted YouTube cue rows in playback order while preserving their saved edit identities.
- Keep absent timestamps distinct from a real cue at zero and restrict external links to supported URL schemes and hosts.
- Restrict media permission grants to app-owned capture frames, deny unrelated permissions, and prevent the privileged app window from navigating to remote pages or opening popups.
- Remove unused titlebar and seeking helpers and make event-ordering tests independent of the current date.
- Replace the nonfree macOS FFmpeg prebuilt with an upstream LGPL source build, include its source and full license, and reject native tools that report non-redistributable licensing.
- Credit FFmpeg in About, expose the bundled licenses/source directory, and verify the corresponding source, full license, build recipe, and notices during macOS packaging.
- Replace the Windows/Linux FFmpeg prebuilts with controlled LGPL source builds for recognition, and include the corresponding source and build materials on every platform.

### Verification

- See [release preparation and verification](docs/release-0.7.0.md) for local checks and remaining platform/device checks.

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
