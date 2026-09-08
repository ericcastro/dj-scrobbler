# DJ Scrobbler — Architecture

## Overview

DJ Scrobbler is an Electron app that hosts an app-owned YouTube player in a `<webview>`,
searches independent tracklist providers in parallel, maps cue points onto the player's
timeline, and scrobbles the currently-playing track to Last.fm in real time. It also keeps
local listening statistics, set metadata, a browsable library, and nearby event suggestions.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Electron Main Process  (main.js)                                   │
│                                                                     │
│   ┌──────────────┐   IPC (invoke/send)   ┌──────────────────────┐  │
│   │  Plugin      │ ◄───────────────────► │  Renderer Process    │  │
│   │  Registry    │                       │  (index.html/app.js) │  │
│   └──────┬───────┘                       └──────────────────────┘  │
│          │                                                          │
│    ┌─────▼──────────────────────────────┐                          │
│    │  WebView wiring  (wireWebview)     │                          │
│    │                                    │                          │
│    │  ┌──────────────────────────────┐  │                          │
│    │  │  Source Plugin               │  │                          │
│    │  │  matchUrl / interceptScript  │  │                          │
│    │  │  getMeta                     │  │                          │
│    │  └──────────────┬───────────────┘  │                          │
│    │                 │ meta             │                          │
│    │  ┌──────────────▼───────────────┐  │                          │
│    │  │  Tracklist Plugins           │  │                          │
│    │  │  parallel lookup + scoring   │  │                          │
│    │  │  extraction + metadata       │  │                          │
│    │  └──────────────┬───────────────┘  │                          │
│    │                 │ IPC events       │                          │
│    └─────────────────┼──────────────────┘                          │
│                      │                                             │
│   ┌──────────────────▼──────────────┐                              │
│   │  Last.fm  (lfmUpdateNowPlaying  │                              │
│   │            lfmScrobble)         │                              │
│   └─────────────────────────────────┘                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Process Boundaries

```
┌────────────────────────────┐        ┌─────────────────────────────┐
│   Main Process             │        │   Renderer Process          │
│   (Node.js / full access)  │        │   (sandboxed browser)       │
│                            │        │                             │
│  main.js                   │◄──────►│  renderer/index.html        │
│  plugins/                  │  IPC   │  renderer/app.js            │
│  lib/ + plugins/           │        │  renderer/style.css         │
│  Last.fm API calls         │        │                             │
│  File I/O (store)          │        │  window.api  (contextBridge)│
└────────────────────────────┘        └─────────────────────────────┘
                                                    │
                                       ┌────────────▼────────────┐
                                       │   <webview> tag         │
                                       │   (isolated renderer)   │
                                       │                         │
                                       │   YouTube browsing      │
                                       │   + app-owned player    │
                                       └─────────────────────────┘
```

IPC channels used:

| Direction        | Channel / method                            | Purpose                                      |
|------------------|---------------------------------------------|----------------------------------------------|
| renderer → main  | `store-get`                                 | Load persisted state                         |
| renderer → main  | `store-set`                                 | Persist state                                |
| renderer → main  | `stats-get`                                 | Load authoritative listening totals           |
| renderer → main  | `player-toggle`                             | Play / pause the active webview              |
| renderer → main  | `player-seek`                               | Seek to a position in seconds                |
| renderer → main  | `player-goto-track`                         | Seek to a specific track cue point           |
| renderer → main  | `player-volume-get` / `player-volume-set`   | Get / set webview volume                     |
| renderer → main  | `open-devtools`                             | Open webview DevTools                        |
| renderer → main  | `lfm-connect` / `lfm-disconnect`            | Last.fm auth                                 |
| renderer → main  | `lfm-session` / `lfm-status-get`            | Read current Last.fm session / status        |
| renderer → main  | `get-sources`                               | List registered source plugins               |
| renderer → main  | `get-version`                               | App version string                           |
| renderer → main  | `get-platform`                              | `darwin` / `win32` / `linux`                 |
| renderer → main  | `set-theme`                                 | Persist theme, update dock icon + titlebar   |
| renderer → main  | `tracklist-cache-clear`                     | Wipe the tracklist cache                     |
| renderer → main  | `tracklist-refresh` / `tracklist-select-provider` | Refresh or switch tracklist source      |
| renderer → main  | `set-metadata-auto`                         | Refresh set79 metadata                       |
| renderer → main  | `event-location-resolve` / `event-lookup`   | Validate location and find upcoming events   |
| renderer → main  | `updates-check` / `updates-download` / `updates-install` | Update lifecycle             |
| renderer → main  | `updates-notifications-disabled-set`        | Suppress update toasts                       |
| renderer → main  | `get-recent-logs`                           | Retrieve last 30 debug log lines             |
| renderer → main  | `is-developer`                              | Whether app was launched with `--developer`  |
| renderer → main  | `set-display-fullscreen`                    | Toggle theater / fullscreen video mode       |
| renderer → main  | `window-drag-start/move/end`                | Drag app-defined blank surfaces              |
| renderer → main  | `open-external`                             | Open a URL in the system browser             |
| main → renderer  | `now-playing`                               | Track changed                                |
| main → renderer  | `tracklist-loaded`                          | Tracklist page loaded                        |
| main → renderer  | `tracklist-data` / `tracklist-options`      | Extracted rows and usable provider choices   |
| main → renderer  | `set-metadata` / `source-metadata`          | Set details and source popularity/date       |
| main → renderer  | `set-availability` / `event-lookup-progress` | Provider status and event lookup progress  |
| main → renderer  | `playback-progress` / `track-artwork`       | Player timeline and artwork enrichment       |
| main → renderer  | `stats-updated`                             | Throttled authoritative listening totals      |
| main → renderer  | `wv-status`                                 | `loading` / `no-tracklist` / `hide-overlay`  |
| main → renderer  | `lfm-status`                                | `ok` / `error` / `unconfigured`              |
| main → renderer  | `update-status`                             | Update check / download / ready state        |

---

## Plugin Architecture

```
plugins/
├── index.js               ← registry + routing + titleSimilarity
├── sources/
│   ├── youtube.js         ← YouTube source plugin (active)
│   └── soundcloud.js      ← SoundCloud source plugin (dormant)
├── tracklists/
│   ├── 1001tracklists.js  ← 1001Tracklists provider plugin (active)
│   └── set79.js           ← set79 provider plugin (automatic fallback)
└── events/
    ├── resident-advisor.js ← exact artist/city event lookup
    └── shotgun.js          ← browser-backed event lookup
```

### Routing

Source and tracklist plugins are decoupled. The registry maps source → tracklist:

```
ROUTING                     youtube ──► 1001tracklists  primary, exact-ID capable
AUTOMATIC_FALLBACK_ROUTING  youtube ──► [set79]         starts in parallel
ALTERNATE_ROUTING           youtube ──► [set79]         remains manually retryable
```

`ROUTING` identifies the preferred provider. Automatic fallbacks start beside it, but a
usable primary result always wins. set79 matches across YouTube and SoundCloud using title
and duration evidence, so it is selected only when the primary has no usable result.
`ALTERNATE_ROUTING` keeps unsuccessful providers reachable for an explicit retry.

Usable provider results are cached separately and can be switched in the renderer. A saved
provider preference controls presentation without preventing the primary from being checked.

Adding a new source (e.g. Mixcloud) requires:
1. `plugins/sources/mixcloud.js` implementing the source interface
2. A new entry in `ROUTING` in `plugins/index.js`
3. A compatible tracklist plugin (or a new one)

### Source Plugin Interface

```js
{
  id: string,                    // e.g. 'youtube'
  name: string,                  // display name
  matchUrl(url): boolean,        // is this URL a playable set on this source?
  shouldInjectOn(url): boolean,  // should interceptScript be injected on this page?
  interceptScript: string|null,  // JS injected into the webview to intercept clicks
  parseIntercept(msg): url|null, // extracts URL from a console-message signal
  getMeta(url): { title, channel, url }, // fetch metadata for a source URL
}
```

### Tracklist Plugin Interface

```js
{
  id: string,                         // e.g. '1001tracklists'
  name: string,                       // display name, shown as the attribution
  matchUrl(url): boolean,             // is this URL a tracklist page?
  findTracklists(meta): [{ url, title }], // search for matching tracklists
  tracklistExtractScript: string,     // JS evaluated on the tracklist page
  metadataExtractScript?: string,     // optional normalized set metadata
  normalizeTracklist?(tracks): tracks,
  sourceUrlForTracklistUrl?(url): string|null,
  candidateInfoExtractScript?: string,// optional evidence such as duration
  minMatchScore?: number,             // min titleSimilarity to accept (default 1)
  footerLabel?: string,               // "found an error? <label>" under the list
  contributeInfo?: { label, note, url(sourceUrl) },  // submit-a-tracklist offer
  alternateInfo?: { prompt, label, note },           // copy for the opt-in button
}
```

`tracklistExtractScript` returns one object per track. The fields the app-owned
timeline needs are `trackNum`, `artist`, `title`, `raw`, `cueSeconds` (seconds
from the start of the set) and `hasTimestamp`; rows are expected in cue order.
Note that providers disagree on name order — 1001Tracklists renders
"Artist - Title", set79 renders "Title - Artist" — so each plugin splits its
own.

---

## Navigation and Lookup Flow

```
User selects a YouTube watch URL
        │
        ├── app-owned YouTube embed starts immediately
        │      └── one serialized 500 ms poll reports time, duration and play state
        │
        └── source metadata lookup
               ├── 1001Tracklists primary ─┐
               └── set79 fallback ─────────┴── run in parallel
                                                │
                           exact primary wins ──┤
                       otherwise usable fallback
                                                │
                                                ▼
                        hidden provider page extracts rows + metadata
                                                │
                                                ▼
                     renderer receives tracklist, provider choices and status
```

Playback does not depend on either provider. Cached provider results can be displayed without
a network round trip, while explicit refresh bypasses the caches. Providers that return usable
results stay available as switchable choices. If none succeeds, the fallback panel offers a
manual retry and then the 1001Tracklists contribution link.

---

## Now-Playing & Scrobbling

The main process polls only the app-owned player and maps its current time to the extracted cue
timeline. Polls are serialized and generation-scoped, so a slow response from an old player
cannot update a newer set. The shared playback sampler accepts adjacent forward progress and
rejects pauses, seeks, stalls, and long gaps; that validated duration drives both local stats
and the 30-second Last.fm threshold. Track changes update Last.fm Now Playing and the renderer.

### Last.fm Auth Flow

```
Renderer: btn-lfm-connect click
   └── window.api.lfmConnect()
          │
          ▼ main: auth.getToken → Last.fm API
          shell.openExternal(last.fm/api/auth?token=...)
          poll auth.getSession every 2s (max 45 attempts / ~90s)
          session saved to store.settings.lfmSession
          └── resolve { key, name } → renderer shows connected state
```

---

## Persistence

Two JSON files under `app.getPath('userData')`:

### `dj-scrobbler.json` — main store

```json
{
  "favorites":  [{ "title": "...", "url": "...", "djNames": ["..."], "event": "..." }],
  "history":    [{ "title": "...", "url": "...", "playedAt": 1234567890, "progressTime": 123 }],
  "searchQueries": ["bicep live", "charlotte de witte"],
  "tracklistCache": {
    "<key>": {
      "version": 2,
      "sourceUrl": "...",
      "providerId": "1001tracklists",
      "tracklistUrl": "...",
      "tracks": [...],
      "cachedAt": 1234567890,
      "expiresAt": 1234567890
    }
  },
  "tracklistPreferences": { "<source URL>": "set79" },
  "artworkCache": { "<artist/title key>": { "url": "...", "cachedAt": 1234567890 } },
  "settings": {
    "lfmSession":           { "key": "...", "name": "..." },
    "theme":                "neon-night",
    "windowBounds":         { "x": 0, "y": 0, "width": 1400, "height": 900 },
    "activeSidebarPanel":   "favorites",
    "resumeBehavior":       "ask",
    "eventLocation":        { "city": "Paris", "country": "France", "countryCode": "FR" },
    "updateNotificationsDisabled": false
  }
}
```

`lfmSession` and the main-owned caches are always re-injected by the `store-set` handler,
so ordinary renderer persistence cannot accidentally wipe private or internal state. User
metadata removals are stored as exact-value exclusions so cache backfill does not undo edits.
The store and stats files are both replaced atomically.

The tracklist cache has a 7-day TTL and is capped at 200 entries (oldest pruned first).

### `dj-scrobbler-stats.json` — listening stats

The main process owns this versioned file and records wall-clock listening time from adjacent
player polls. Time and track progress are bucketed by local calendar day and stable set ID;
set records carry normalized DJ IDs so weekly set and DJ rankings can be derived later. A set
with multiple DJs gives each DJ full credit for the set's listening time.

Version 1 lifetime totals are retained as unattributed legacy values during migration because
the old format does not contain enough information to reconstruct historical set or DJ totals.
Writes are debounced, atomic, and flushed on pause, set changes, monitor shutdown, and app quit.
The renderer receives throttled snapshots for display and never mutates the persisted model.

---

## Platform-Specific Titlebar

The main window uses a different titlebar strategy per platform:

| Platform | Strategy                                          |
|----------|---------------------------------------------------|
| macOS    | `titleBarStyle: 'hiddenInset'` (native traffic lights, inset) |
| Windows  | `titleBarStyle: 'hidden'` + `titleBarOverlay` (native Win32 buttons, theme-coloured) |
| Linux    | `frame: true` (native window-manager title bar and controls) |

On Windows, the overlay colours update in real time when the user switches themes via
`mainWindow.setTitleBarOverlay()`. Each theme defines a `color` and `symbolColor` in
`TITLEBAR_OVERLAY_THEMES`.

---

## Updates

All platforms check GitHub Releases via the API first; `lib/update-utils.js` normalises
release data into a shared `UpdateStatus` shape consumed by the renderer's update dialog.
Installation then diverges per platform:

- **Windows / Linux** — `electron-updater` downloads and installs.
- **macOS** — builds are ad-hoc signed (no Apple Developer ID), and Squirrel.Mac refuses
  to install updates for apps without a valid Apple signature, so `lib/mac-updater.js`
  implements the install itself: it picks the `-mac.zip` release asset matching the CPU
  architecture, downloads and extracts it with `ditto -xk`, verifies the bundle version,
  then hands off to a detached shell script that waits for the app to quit, swaps the
  bundle in place (keeping a backup for rollback), and relaunches. Because the app —
  not a browser — downloads the zip, the new bundle never receives the
  `com.apple.quarantine` attribute, so Gatekeeper never re-prompts and no `xattr`
  workaround is needed for updates. First-time installs get the same treatment via
  `install.sh` (curl doesn't quarantine either).

`scripts/install-test-build.sh` tests the macOS path end-to-end: it builds the app with a
deliberately low version, installs it into `/Applications`, launches it with
`--auto-update-test` (check on launch, then download and install with no clicks), and
watches `/Applications` until the bundle reports the latest released version.

---

## Development

Requirements: Node.js 20+, npm.

```sh
npm install        # install dependencies
npm start          # run the app
npm run dev        # run with developer extras enabled
npm test           # run the test suite
```

Enable verbose lookup logging:

```sh
DJ_VERBOSE=1 npm start
```

Load a specific YouTube URL on startup:

```sh
DJ_DEBUG_LOAD_URL=https://www.youtube.com/watch?v=... npm start
```

Releases are triggered by pushing a version tag:

```sh
git tag v0.6.0 && git push origin v0.6.0
```

GitHub Actions builds macOS, Windows, and Linux packages and publishes them to GitHub Releases.

---

## File Map

```
dj-scrobbler/
├── main.js                 ← Main process: window, webview wiring, IPC, Last.fm, updates
├── preload.js              ← contextBridge — exposes window.api to renderer
├── lib/
│   ├── listening-stats.js  ← versioned listening model + playback sampler
│   ├── event-lookup-core.js← shared exact artist/location/event matching
│   ├── deezer-artwork.js   ← conservative artwork lookup and matching
│   └── update-utils.js     ← version comparison + update payload normalisation
├── plugins/
│   ├── index.js            ← Registry, routing, titleSimilarity
│   ├── sources/
│   │   ├── youtube.js      ← YouTube source plugin (active)
│   │   └── soundcloud.js   ← SoundCloud source plugin (dormant)
│   ├── tracklists/
│   │   ├── 1001tracklists.js ← primary exact-ID tracklist provider
│   │   └── set79.js          ← title/duration-scored automatic fallback
│   └── events/
│       ├── resident-advisor.js
│       └── shotgun.js
├── renderer/
│   ├── index.html          ← App shell HTML
│   ├── app.js              ← All UI logic (state, events, IPC listeners)
│   └── style.css           ← Dark-theme styles (three colour themes)
└── tests/
    ├── run-tests.js          ← Test runner (collects *.test.js)
    ├── listening-stats.test.js   ← sampling, attribution and migration
    ├── event-lookup.test.js      ← multi-source exact matching
    ├── renderer-contract.test.js ← DOM/CSS/app.js integration contracts
    └── main-contract.test.js     ← main-process integration contracts
```
