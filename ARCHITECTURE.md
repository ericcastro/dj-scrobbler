# DJ Scrobbler — Architecture

## Overview

DJ Scrobbler is an Electron app that embeds an app-owned YouTube player in a webview,
intercepts navigation to DJ set pages, finds a matching tracklist on a third-party
provider, and scrobbles the currently-playing track to Last.fm in real time.

> v0.5 branch note: SoundCloud/set79 is dormant while playback moves to an app-owned YouTube player. Several diagrams below still describe the v0.4 provider-page playback model; see `docs/v0.5-refactor-plan.md` for the active refactor direction.

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
│  Last.fm API calls         │        │  renderer/style.css         │
│  File I/O (store)          │        │                             │
│                            │        │  window.api  (contextBridge)│
└────────────────────────────┘        └─────────────────────────────┘
                                                    │
                                       ┌────────────▼────────────┐
                                       │   <webview> tag         │
                                       │   (isolated renderer)   │
                                       │                         │
                                       │   youtube.com           │
                                       │   soundcloud.com        │
                                       │   1001tracklists.com    │
                                       │   set79.com             │
                                       └─────────────────────────┘
```

IPC channels used:

| Direction        | Channel / method       | Purpose                           |
|------------------|------------------------|-----------------------------------|
| renderer → main  | `store-get`            | Load persisted state              |
| renderer → main  | `store-set`            | Persist state                     |
| renderer → main  | `player-toggle`        | Click play/pause in webview       |
| renderer → main  | `open-devtools`        | Open webview DevTools             |
| renderer → main  | `lfm-connect/disconnect/session/status-get` | Last.fm auth |
| main → renderer  | `now-playing`          | Track changed                     |
| main → renderer  | `tracklist-loaded`     | Tracklist page loaded             |
| main → renderer  | `wv-status`            | loading / no-tracklist / hide-overlay |
| main → renderer  | `lfm-status`           | `ok` / `error` / `unconfigured`   |

---

## Plugin Architecture

```
plugins/
├── index.js               ← registry + routing + titleSimilarity
├── sources/
│   ├── youtube.js         ← YouTube source plugin
│   └── soundcloud.js      ← SoundCloud source plugin
└── tracklists/
    ├── 1001tracklists.js  ← 1001Tracklists provider plugin
    └── set79.js           ← set79 provider plugin
```

### Routing

Source and tracklist plugins are decoupled. The registry maps source → tracklist:

```
youtube    ──► 1001tracklists
soundcloud ──► set79
```

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
  name: string,
  matchUrl(url): boolean,             // is this URL a tracklist page?
  findTracklists(meta): [{ url, title }], // search for matching tracklists
  nowPlayingScript: string,           // JS evaluated in webview every 500ms
  autoplayScript: string|null,        // JS run once after tracklist loads
  autoplayDelay: number,              // ms to wait before running autoplayScript
}
```

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
   └── youtube.getMeta(url)   → oEmbed API → { title, channel }
   └── 1001tl.findTracklists(meta) → POST search → [{ url, title }]
   └── titleSimilarity score each result (Jaccard word overlap)
   └── wvContents.loadURL(best match)
        │
        ▼
 1001tracklists page loads
 main: 'did-finish-load'
   └── send 'tracklist-loaded' → renderer shows set info
   └── startMonitoring(wvContents, 1001tlPlugin)
   └── setTimeout → autoplayScript (ytPlayer.playVideo)
```

### SoundCloud → set79

```
User navigates to soundcloud.com/<artist>/<track>
        │
        ▼
 main: wvContents 'will-navigate' or 'did-navigate-in-page'
 source.matchUrl(url) → soundcloud plugin matches
        │
        ▼
 handleSourceUrl(soundcloud, url, wvContents)
   └── soundcloud.getMeta(url)  → { url } (title from path)
   └── set79.findTracklists(meta) → builds set79.com/tracklist/soundcloud.com/<path>
   └── wvContents.loadURL(set79 url)
        │
        ▼
 set79 page loads → startMonitoring(wvContents, set79Plugin)
```

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

A single JSON file at `app.getPath('userData')/dj-scrobbler.json`:

```json
{
  "favorites":     [{ "title": "...", "url": "...", "source": "1001tl|set79" }],
  "history":       [{ "title": "...", "url": "...", "source": "...", "playedAt": 1234567890 }],
  "searchQueries": ["bicep live", "charlotte de witte", "..."],
  "settings": {
    "lfmSession": { "key": "...", "name": "..." }
  }
}
```

`lfmSession` is always re-injected by the main process `store-set` handler before writing,
so the renderer can never accidentally wipe it.

---

## Development

Requirements: Node.js 20+, npm.

```sh
npm install   # install dependencies
npm start     # run the app locally
```

Build for the current platform:

```sh
npm run build
```

Platform-specific builds:

```sh
npm run build:mac
npm run build:win
npm run build:linux
```

Enable verbose lookup logging:

```sh
DJ_VERBOSE=1 npm start
```

Releases are triggered by pushing a version tag:

```sh
git tag v0.4.0 && git push origin v0.4.0
```

GitHub Actions builds macOS, Windows, and Linux packages and publishes them to GitHub Releases.

---

## File Map

```
dj-scrobbler/
├── main.js                 ← Main process: window, webview wiring, IPC, Last.fm
├── preload.js              ← contextBridge — exposes window.api to renderer
├── plugins/
│   ├── index.js            ← Registry, routing, titleSimilarity
│   ├── sources/
│   │   ├── youtube.js      ← YouTube source plugin
│   │   └── soundcloud.js   ← SoundCloud source plugin
│   └── tracklists/
│       ├── 1001tracklists.js ← 1001Tracklists plugin (search + monitor)
│       └── set79.js          ← set79 plugin (direct URL + monitor)
└── renderer/
    ├── index.html          ← App shell HTML
    ├── app.js              ← All UI logic (state, events, IPC listeners)
    └── style.css           ← Dark-theme styles
```
