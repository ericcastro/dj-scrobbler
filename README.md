# DJ Scrobbler

DJ Scrobbler is a desktop music app for people who listen to long-form DJ sets on YouTube and SoundCloud, but still want precise Last.fm listening history.

It searches for a matching tracklist, follows the currently playing track, and scrobbles individual songs instead of flattening a one-hour mix into a single play.

[Website](https://www.djscrobbler.com) · [Releases](https://github.com/ericcastro/dj-scrobbler/releases) · [Architecture](./ARCHITECTURE.md)

## What It Does

- Browse and search DJ sets from YouTube and SoundCloud.
- Save favorite sets so you can come back to them later.
- Match sets to tracklists from providers like 1001Tracklists and set79.
- Show the active tracklist inside the app while the set plays.
- Connect a Last.fm account and scrobble each track as it plays.
- Keep the DJ set title as the album in Last.fm, so listening history still has context.

## Why

Streaming platforms still do a poor job with DJ sets, radio shows, mixes, and other long-form music. A tracklist may exist somewhere on the web, but the player usually treats the whole set as one item.

DJ Scrobbler tries to bridge that gap: browser-native DJ set sources on one side, tracklist communities on the other, and Last.fm as the permanent listening history.

It is also a small love letter to Last.fm, which remains one of the most useful social music platforms ever made.

## Download

Installers are published on the [GitHub Releases page](https://github.com/ericcastro/dj-scrobbler/releases).

DJ Scrobbler is built for:

- macOS
- Windows
- Linux

## Development

Requirements:

- Node.js 20 or newer
- npm

Install dependencies:

```sh
npm install
```

Run the app locally:

```sh
npm start
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

## Release

The app uses Electron Builder and publishes release assets to GitHub.

Create and push a version tag:

```sh
git tag v0.4.0
git push origin v0.4.0
```

The release workflow builds macOS, Windows, and Linux packages and uploads them to GitHub Releases.

You can also publish from a configured local environment:

```sh
npm run release
```

## Project Structure

```text
dj-scrobbler/
├── main.js                 # Electron main process, webview wiring, Last.fm API
├── preload.js              # Safe renderer/main bridge
├── webview-preload.js      # Scripts injected into source and tracklist webviews
├── renderer/               # App UI
├── plugins/
│   ├── index.js            # Source and tracklist registry
│   ├── sources/            # YouTube and SoundCloud source plugins
│   └── tracklists/         # 1001Tracklists and set79 tracklist plugins
├── images/                 # App icons and visual assets
├── build-resources/        # Packaging resources
└── ARCHITECTURE.md         # Detailed technical architecture
```

## How It Works

DJ Scrobbler has two plugin layers:

- Source plugins understand playable set URLs, currently YouTube and SoundCloud.
- Tracklist plugins know how to find and monitor tracklist pages, currently 1001Tracklists and set79.

When you open a DJ set, the app extracts metadata from the source page, searches for a matching tracklist, loads it in an internal webview, and monitors the active track. As tracks change, DJ Scrobbler updates Now Playing and scrobbles to Last.fm when the track has played long enough.

For a deeper breakdown, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Data

DJ Scrobbler stores local app data in Electron's user data directory as `dj-scrobbler.json`.

That file contains favorites, history, search queries, settings, and the Last.fm session after authorization.

## Status

This is an early open-source app. Expect rough edges, especially around matching sets to external tracklists, because the app depends on source websites and tracklist providers that can change their markup or behavior.

## License

MIT
