# DJ Scrobbler

[![Tests](https://github.com/ericcastro/dj-scrobbler/actions/workflows/test.yml/badge.svg)](https://github.com/ericcastro/dj-scrobbler/actions/workflows/test.yml)
[![Release](https://github.com/ericcastro/dj-scrobbler/actions/workflows/release.yml/badge.svg)](https://github.com/ericcastro/dj-scrobbler/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

DJ Scrobbler is a desktop music app for people who listen to long-form DJ sets on YouTube, but still want precise Last.fm listening history.

It searches for a matching tracklist, follows the currently playing track, and scrobbles individual songs instead of flattening a one-hour mix into a single play.

[Website](https://www.djscrobbler.com) · [Releases](https://github.com/ericcastro/dj-scrobbler/releases) · [Changelog](./CHANGELOG.md) · [Architecture](./ARCHITECTURE.md) · [Roadmap](./ROADMAP.md)

## What It Does

- Search YouTube for DJ sets directly inside the app.
- Save favorite sets and browse listening history across sessions.
- Search 1001Tracklists, YouTube descriptions/comments, and set79 in parallel, preferring an exact 1001Tracklists match.
- Build an editable Shazam tracklist in the background when published tracklists are unavailable.
- Show the active tracklist in sync with playback, highlighting the current track.
- Enrich identified tracks with artwork when a provider has none.
- Connect a Last.fm account and scrobble each individual track as it plays.
- Keep the DJ set title as the album in Last.fm, so listening history retains context.
- Resume interrupted sets from where you left off.
- Edit set metadata and browse favorites by DJ, event, or venue.
- Track local listening totals and show upcoming DJ events near a saved location.
- Send the focus view and audio to Chromecast or AirPlay on macOS (**experimental, macOS only**). Windows and Linux casting support is coming soon.
- Use focus mode, always-on-top playback, keyboard seeking, and YouTube quality controls.
- Three visual themes: Neon Night, Signal Teal, Sunset Deck.

## Why

Streaming platforms still do a poor job with DJ sets, radio shows, mixes, and other long-form music. A tracklist may exist somewhere on the web, but the player usually treats the whole set as one item.

DJ Scrobbler tries to bridge that gap: an app-owned YouTube player on one side, tracklist communities on the other, and Last.fm as the permanent listening history.

It is also a small love letter to Last.fm, which remains one of the most useful social music platforms ever made.

## Download

Installers are published on the [GitHub Releases page](https://github.com/ericcastro/dj-scrobbler/releases).

DJ Scrobbler is built for:

- macOS 12 or newer (Apple Silicon and Intel)
- Windows
- Linux

Casting is **experimental and available on macOS only** in 0.7.x. Windows and Linux casting support is coming soon; their apps continue to support playback, tracklists, recognition, and scrobbling. Linux packages require Ubuntu 22.04 or a compatible system with glibc 2.35 or newer.

### macOS

DJ Scrobbler isn't notarized with Apple yet, so a copy downloaded through the browser is
blocked by Gatekeeper. Install it with one command instead — no Gatekeeper dialog, no
workarounds:

```sh
curl -fsSL https://raw.githubusercontent.com/ericcastro/dj-scrobbler/main/install.sh | bash
```

After that the app keeps itself up to date: when a new release is available it downloads
and installs it in place with one click.

## Development

Use Node.js 22.12 or newer and run `npm ci`. Installation downloads the matching Electron runtime through `install-electron`. Run `npm test` and `osv-scanner scan .` before preparing a release. CI tests Node.js 22 and 24 on all platforms and blocks releases on OSV findings.

## How It Works

DJ Scrobbler has three plugin layers:

- **Source plugins** understand playable set URLs (currently YouTube).
- **Tracklist plugins** find and extract tracklists (currently 1001Tracklists, YouTube descriptions/comments, and set79).
- **Event plugins** find upcoming appearances for tagged DJs (currently Resident Advisor and Shotgun).

When you open a DJ set, the app starts its own YouTube player and searches the published tracklist providers in parallel. An exact 1001Tracklists match wins, followed by timestamped YouTube descriptions/comments, then set79's title and duration match. If none has a usable tracklist, Shazam analyzes sparse samples from a temporary audio download in the background without seeking the visible player. Repeated matches build a timestamped recognition timeline; confirmed tracks are scrobbled only when visible playback reaches them. You can correct IDs and switch between available providers.

Recognition and casting use bundled FFmpeg and yt-dlp binaries. Development commands prepare the same pinned, checksum-verified tools used in release builds; no separate system installation is required. macOS AirPlay also uses a small native helper (`npm run build:airplay` during development), included automatically in packaged apps.

The first media preparation builds FFmpeg from pinned upstream source; subsequent runs reuse the cached build. macOS requires Xcode Command Line Tools. Linux requires gcc, make, binutils, tar, and xz. Windows builds use MSYS2 UCRT64; the package workflow configures its compiler and license paths. Packages include the FFmpeg source archive, build script, and full LGPL text. Windows/Linux use decoder-only builds for recognition while casting support is developed.

Tracklists, provider preferences, set metadata, and artwork results are cached locally. User-facing history, favorites, edits, settings, and listening statistics remain local to the machine.

For a deeper breakdown, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Development

Requirements: Node.js 20+, npm.

```sh
npm install   # install dependencies
npm start     # run the app
npm run dev   # run with developer extras enabled
npm test      # run the test suite
npm run check:release # verify version and changelog consistency
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

Bundled components keep their own licenses. Each platform includes a separate FFmpeg executable under LGPL 2.1-or-later, with its complete source, license, and build instructions supplied in the same download. Use **About → Licenses & sources** to find them. See [third-party notices](./THIRD_PARTY_NOTICES.md) and [the scoped FFmpeg compliance check](./docs/ffmpeg-compliance.md) for details.
