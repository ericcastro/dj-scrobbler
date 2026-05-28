# DJ Scrobbler

[![Tests](https://github.com/ericcastro/dj-scrobbler/actions/workflows/test.yml/badge.svg)](https://github.com/ericcastro/dj-scrobbler/actions/workflows/test.yml)
[![Release](https://github.com/ericcastro/dj-scrobbler/actions/workflows/release.yml/badge.svg)](https://github.com/ericcastro/dj-scrobbler/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

DJ Scrobbler is a desktop music app for people who listen to long-form DJ sets on YouTube, but still want precise Last.fm listening history.

It searches for a matching tracklist, follows the currently playing track, and scrobbles individual songs instead of flattening a one-hour mix into a single play.

[Website](https://www.djscrobbler.com) · [Releases](https://github.com/ericcastro/dj-scrobbler/releases) · [Architecture](./ARCHITECTURE.md)

## What It Does

- Search YouTube for DJ sets directly inside the app.
- Save favorite sets and browse listening history across sessions.
- Match sets to tracklists from 1001Tracklists automatically.
- Show the active tracklist in sync with playback, highlighting the current track.
- Connect a Last.fm account and scrobble each individual track as it plays.
- Keep the DJ set title as the album in Last.fm, so listening history retains context.
- Resume interrupted sets from where you left off.
- Three visual themes: Neon Night, Signal Teal, Sunset Deck.

## Why

Streaming platforms still do a poor job with DJ sets, radio shows, mixes, and other long-form music. A tracklist may exist somewhere on the web, but the player usually treats the whole set as one item.

DJ Scrobbler tries to bridge that gap: an app-owned YouTube player on one side, tracklist communities on the other, and Last.fm as the permanent listening history.

It is also a small love letter to Last.fm, which remains one of the most useful social music platforms ever made.

## Download

Installers are published on the [GitHub Releases page](https://github.com/ericcastro/dj-scrobbler/releases).

DJ Scrobbler is built for:

- macOS (Apple Silicon and Intel)
- Windows
- Linux

## How It Works

DJ Scrobbler has two plugin layers:

- **Source plugins** understand playable set URLs (currently YouTube).
- **Tracklist plugins** know how to find and monitor tracklist pages (currently 1001Tracklists).

When you open a DJ set, the app loads an in-app YouTube player, searches 1001Tracklists for a matching tracklist, and begins polling the active track from the player timeline. As tracks change, DJ Scrobbler updates Now Playing and scrobbles to Last.fm once the track has played long enough.

Tracklist lookups are cached locally for 7 days, so repeat plays skip the network round-trip.

For a deeper breakdown, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Development

Requirements: Node.js 20+, npm.

```sh
npm install   # install dependencies
npm start     # run the app
npm run dev   # run with developer extras enabled
npm test      # run the test suite
```

Enable verbose logging:

```sh
DJ_VERBOSE=1 npm start
```

Load a specific YouTube URL on startup (useful for testing a specific set):

```sh
DJ_DEBUG_LOAD_URL=https://www.youtube.com/watch?v=... npm start
```

## Status

DJ Scrobbler is in active early development, working toward a stable 1.0 release. Rough edges are expected — particularly around tracklist matching, which depends on third-party sites that can change their structure or behaviour at any time.

## License

MIT
