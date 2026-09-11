# CLI proofs of concept

Small, disposable experiments that answer a product question before the idea is
promoted into the desktop app.

## Digital YouTube audio recognition

Run:

```sh
npm run poc:shazam
```

The Electron app chooses the currently loaded saved YouTube favorite, or the
first saved YouTube favorite when none is active. It seeks to four interior
points, captures ten seconds of the app-owned player at each point, restores the
previous player position/state, and exits only when you close the app. The same
run is also available in developer mode from **View → Run Shazam Audio Capture
POC**.

Look for `[recognition:capture]`, `[shazam-poc:fingerprint]`, and
`[shazam-poc:recognition]` in the terminal. A healthy capture identifies itself
as `Tab audio`, reports non-zero peak/RMS values, and contains about 160,000 mono
samples at 16 kHz. `no-match` is a valid recognition outcome, not a capture
failure.

The latest structured result is written to `shazam-poc-results.json` in
Electron's DJ Scrobbler user-data directory. It contains capture diagnostics,
set playback timestamps, normalized matches, and a de-duplicated recognition
timeline; captured PCM is never written to disk.

For the larger cross-check against published tracklists, run:

```sh
npm run poc:shazam:validate
```

This selects five saved sets with cached tracklists from different DJs where
possible, then captures five safely spaced identified tracks from each set. Its
`shazam-validation-results.json` report records the published expectation and
Shazam result independently and classifies them as exact, near, related,
different, or no-match. A disagreement is evidence to inspect, not a capture
failure.

The capture request is granted only to the armed player webContents and keeps
local audio output enabled. It never requests microphone input.

The same capture path now activates automatically when both published
tracklist providers finish without a usable result. It captures ten seconds
every 30 seconds while playback is running, stores only normalized recognition
observations, and builds the local timeline without sending recognition-derived
tracks to Last.fm. Seeking into an unresolved part of that timeline schedules a
sample after a short settling delay, subject to request and seek cooldowns.

The Shazam endpoint is reverse-engineered and unsupported. Shazam publishes no
rate-limit contract for it, so the 30-second cadence is an intentionally sparse
product default rather than a guaranteed service allowance. Endpoint changes,
blocking, and platform-specific Chromium display-audio behavior remain
experimental.

## When is this DJ playing next in my city? (v2)

Run:

```sh
npm run poc:next-dj
```

The first run asks for a city and country. Later launches begin with
`Change location? [n]:`; Enter keeps the saved location and `y` reopens the city
and country prompts with their existing values as defaults. The CLI then asks
for a DJ and radius. Pressing Enter at the DJ prompt reuses the last artist.
Pressing Enter at the radius prompt means an exact city/metro match.

Configuration is stored outside the repository at
`~/.config/dj-scrobbler/next-dj.json` (or under `XDG_CONFIG_HOME`). Use
`--configure` to change location. Use `--help` for non-interactive flags.

The active POC treats event providers like source plugins. Each adapter declares
its geographic scope and returns the same small event shape:

| Source | Intended coverage | Current transport |
| --- | --- | --- |
| Resident Advisor | Global | Working, undocumented GraphQL endpoint |
| Edmtrain | United States and Canada | Official API; key required, with extra permission for multi-source use |
| Shotgun | Brazil and Europe | Working public-site search through the project's hidden Electron browser |
| Passline | Argentina and Chile | Public country search/event pages; direct requests may be challenged |

The aggregator asks applicable sources in parallel, chooses the earliest calendar
date, and merges only obvious same-title or same-venue duplicates. It keeps other
matches on that same date and discards later results from the announcement. This
is intentionally not a tour database.

Use `--sources resident-advisor,shotgun` to isolate adapters and `--verbose` to
see all source statuses.

Edmtrain's published terms prohibit combining its API data with other event
sources in a competing discovery service. An isolated `--sources edmtrain`
lookup therefore needs `EDMTRAIN_CLIENT_KEY` only. When Edmtrain is selected
alongside another source, its adapter stays disabled unless
`EDMTRAIN_COMBINATION_APPROVED=1` is also set. The second flag is an assertion
that permission for this use has been obtained; it is not a bypass.

Shotgun uses its public search UI rather than guessing artist URL slugs. A hidden
Electron window is started only for a Shotgun lookup, then matching event pages'
structured `MusicEvent` data is filtered to the exact artist and city. This is a
POC browser transport rather than a supported partner API and should remain
low-volume.

RA remains the baseline because its event and artist coverage is purpose-built
for electronic music and includes smaller club listings. Its public GraphQL
endpoint requires no login but is undocumented and unsupported. A production
version should cache responses, rate-limit lookups, and replace challenged page
adapters with authorized APIs or partner feeds.

Postal code is intentionally omitted for exact matching because RA models a
location as a city/metro area. It becomes useful for radius search, where it can
be geocoded and compared with venue coordinates.

### Archive

The original working RA-only POC is frozen at
`archive/next-dj-v1-ra.js`. It is retained for comparison and is not called by
the npm script.
