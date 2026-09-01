# DJ Scrobbler — Architecture

## Overview

DJ Scrobbler is an Electron app that hosts an app-owned YouTube player in a `<webview>`,
intercepts navigation to DJ set pages, finds a matching tracklist on 1001Tracklists,
and scrobbles the currently-playing track to Last.fm in real time.

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
│    │  │  Tracklist Plugin            │  │                          │
│    │  │  findTracklists (+ scoring)  │  │                          │
│    │  │  nowPlayingScript            │  │                          │
│    │  │  autoplayScript              │  │                          │
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
│  lib/update-utils.js       │        │  renderer/style.css         │
│  Last.fm API calls         │        │                             │
│  File I/O (store)          │        │  window.api  (contextBridge)│
└────────────────────────────┘        └─────────────────────────────┘
                                                    │
                                       ┌────────────▼────────────┐
                                       │   <webview> tag         │
                                       │   (isolated renderer)   │
                                       │                         │
                                       │   youtube.com           │
                                       │   1001tracklists.com    │
                                       └─────────────────────────┘
```

IPC channels used:

| Direction        | Channel / method                            | Purpose                                      |
|------------------|---------------------------------------------|----------------------------------------------|
| renderer → main  | `store-get`                                 | Load persisted state                         |
| renderer → main  | `store-set`                                 | Persist state                                |
| renderer → main  | `stats-get` / `stats-set`                   | Load / persist listening stats               |
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
| renderer → main  | `updates-check` / `updates-download` / `updates-install` | Update lifecycle             |
| renderer → main  | `updates-notifications-disabled-set`        | Suppress update toasts                       |
| renderer → main  | `get-recent-logs`                           | Retrieve last 30 debug log lines             |
| renderer → main  | `is-developer`                              | Whether app was launched with `--developer`  |
| renderer → main  | `set-display-fullscreen`                    | Toggle theater / fullscreen video mode       |
| renderer → main  | `window-drag-start/move/end`                | Custom frameless drag (Linux)                |
| renderer → main  | `open-external`                             | Open a URL in the system browser             |
| main → renderer  | `now-playing`                               | Track changed                                |
| main → renderer  | `tracklist-loaded`                          | Tracklist page loaded                        |
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
└── tracklists/
    ├── 1001tracklists.js  ← 1001Tracklists provider plugin (active)
    └── set79.js           ← set79 provider plugin (active, opt-in)
```

### Routing

Source and tracklist plugins are decoupled. The registry maps source → tracklist:

```
ROUTING            youtube ──► 1001tracklists       searched automatically
ALTERNATE_ROUTING  youtube ──► [set79]              searched only on request
```

`ROUTING` is the provider searched when a set is opened. `ALTERNATE_ROUTING`
lists providers the user can reach with a button press from the "no tracklist"
panel — they match on weaker signals (set79 matches by title, not by media ID),
so they never run unprompted.

Once an alternate has produced a tracklist for a set, its cache entry is
restored automatically on reopen — but only *after* the primary provider has
been retried and missed again, so a set is never permanently pinned to the
alternate.

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
  nowPlayingScript: string,           // JS evaluated in webview every 500ms
  autoplayScript: string|null,        // JS run once after tracklist loads
  autoplayDelay: number,              // ms to wait before running autoplayScript
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

## Navigation Flow

### YouTube → 1001Tracklists

```
User clicks a video link on youtube.com
        │
        ▼
 [interceptScript] capture-phase DOM listener fires
 preventDefault() + stopImmediatePropagation()
 console.log('__INTERCEPT__youtube__<url>')
        │
        ▼
 main: wvContents 'console-message' event
 source.parseIntercept(msg) → watch URL
        │
        ▼
 handleSourceUrl(youtube, watchUrl, wvContents)
   └── check tracklist cache (7-day TTL)
         ├── cache hit  → load cached tracklist URL directly
         └── cache miss → youtube.getMeta(url) → oEmbed API → { title, channel }
                        → 1001tl.findTracklists(meta) → POST search → [{ url, title }]
                        → titleSimilarity score each result (Jaccard word overlap)
                        → store best match in cache
                        → wvContents.loadURL(best match)
        │
        ▼
 1001tracklists page loads
 main: 'did-finish-load'
   └── send 'tracklist-loaded' → renderer shows set info
   └── startMonitoring(wvContents, 1001tlPlugin)
   └── setTimeout → autoplayScript (ytPlayer.playVideo)
```

### No tracklist → set79 (opt-in)

When the routed provider finds nothing, the panel below the player offers the
source's alternates instead of the "create one yourself" link. Only one offer
is on screen at a time, and the contribute link is what is left once every
alternate has been tried:

```
1001tracklists search returns nothing
        │
        ▼
 send 'tracklist-loaded' { isFallback: true, alternateProviders: [set79] }
 renderer: "You can also try fetching a tracklist from set79.com"
           [ Try set79.com instead (experimental) ]
        │
        ▼ user presses the button
 renderer: window.api.tryTracklistProvider('set79')
 main: tryTracklistProvider → runTracklistLookup(set79, currentSourceMeta, …)
        │
        ▼
 set79 /search { query: <YouTube title> }  → url_identity (SoundCloud path)
 https://set79.com/tracklist/<identity>    → tracklistExtractScript
        │
        ▼
 send 'tracklist-data' → renderer renders the set79 tracklist
 (playback never stops — only the tracklist half of the state is rebuilt)
```

A miss re-sends the fallback with `alternateProviders: []`, which brings the
1001Tracklists contribute button back.

---

## Now-Playing & Scrobbling

```
setInterval 500ms
   └── wvContents.executeJavaScript(tlPlugin.nowPlayingScript)
          │
          ▼ returns { artist, title, raw, trackNum, isPlaying }
          │
   emitNowPlaying(data)
   ├── raw unchanged?  → skip (de-duplicate)
   ├── previous track played ≥ 30s?  → lfmScrobble(artist, title, startedAt)
   ├── lastNowPlaying = data.raw
   ├── trackStartedAt = Date.now()
   ├── lfmUpdateNowPlaying(artist, title)   → track.updateNowPlaying
   └── send 'now-playing' → renderer updates footer
```

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
  "favorites":  [{ "title": "...", "url": "...", "thumbnailUrl": "...", "source": "1001tl" }],
  "history":    [{ "title": "...", "url": "...", "source": "...", "playedAt": 1234567890 }],
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
  "settings": {
    "lfmSession":           { "key": "...", "name": "..." },
    "theme":                "neon-night",
    "windowBounds":         { "x": 0, "y": 0, "width": 1400, "height": 900 },
    "activeSidebarPanel":   "favorites",
    "resumeMode":           "ask",
    "updateNotificationsDisabled": false
  }
}
```

`lfmSession` is always re-injected by the main process `store-set` handler before writing,
so the renderer can never accidentally wipe it.

The tracklist cache has a 7-day TTL and is capped at 200 entries (oldest pruned first).

### `dj-scrobbler-stats.json` — listening stats

Tracks cumulative listening time, set count, and scrobble count. Written separately to avoid
touching the main store on every scrobble tick.

---

## Platform-Specific Titlebar

The main window uses a different titlebar strategy per platform:

| Platform | Strategy                                          |
|----------|---------------------------------------------------|
| macOS    | `titleBarStyle: 'hiddenInset'` (native traffic lights, inset) |
| Windows  | `titleBarStyle: 'hidden'` + `titleBarOverlay` (native Win32 buttons, theme-coloured) |
| Linux    | `frame: false` (custom drag region via `window-drag-*` IPC) |

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
git tag v0.5.3 && git push origin v0.5.3
```

GitHub Actions builds macOS, Windows, and Linux packages and publishes them to GitHub Releases.

---

## File Map

```
dj-scrobbler/
├── main.js                 ← Main process: window, webview wiring, IPC, Last.fm, updates
├── preload.js              ← contextBridge — exposes window.api to renderer
├── lib/
│   └── update-utils.js     ← Version comparison + update payload normalisation
├── plugins/
│   ├── index.js            ← Registry, routing, titleSimilarity
│   ├── sources/
│   │   ├── youtube.js      ← YouTube source plugin (active)
│   │   └── soundcloud.js   ← SoundCloud source plugin (dormant)
│   └── tracklists/
│       ├── 1001tracklists.js ← 1001Tracklists plugin (search + monitor)
│       └── set79.js          ← set79 plugin (opt-in alternate for YouTube)
├── renderer/
│   ├── index.html          ← App shell HTML
│   ├── app.js              ← All UI logic (state, events, IPC listeners)
│   └── style.css           ← Dark-theme styles (three colour themes)
└── tests/
    ├── run-tests.js          ← Test runner (collects *.test.js)
    ├── renderer-contract.test.js ← DOM/CSS/app.js contract tests
    ├── main-contract.test.js     ← main.js contract tests (IPC, titlebar, store)
    ├── update-utils.test.js      ← Update payload and version comparison
    ├── youtube-source.test.js    ← YouTube source plugin
    ├── tracklists-1001.test.js   ← 1001Tracklists plugin
    └── set79-tracklist.test.js   ← set79 plugin
```
