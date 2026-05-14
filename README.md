# DJ Scrobbler

DJ Scrobbler is a desktop music app for people who listen to long-form DJ sets on YouTube, but still want precise Last.fm listening history.

> v0.5 refactor branch: active playback and tracklist work is focused on YouTube + 1001Tracklists. SoundCloud/set79 code remains in the repo as dormant reference material for the upcoming YouTube-to-SoundCloud matching bridge.

It searches for a matching tracklist, follows the currently playing track, and scrobbles individual songs instead of flattening a one-hour mix into a single play.

[Website](https://www.djscrobbler.com) · [Releases](https://github.com/ericcastro/dj-scrobbler/releases) · [Architecture](./ARCHITECTURE.md)

## What It Does

- Browse and search DJ sets from YouTube.
- Save favorite sets so you can come back to them later.
- Match sets to tracklists from providers like 1001Tracklists.
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

## How It Works

DJ Scrobbler has two plugin layers:

- Source plugins understand playable set URLs, currently YouTube.
- Tracklist plugins know how to find and monitor tracklist pages, currently 1001Tracklists.

When you open a DJ set, the app loads its own YouTube player, searches for a matching tracklist, extracts provider metadata in the background, and follows the active track from the player timeline. As tracks change, DJ Scrobbler updates Now Playing and scrobbles to Last.fm when the track has played long enough.

For a deeper breakdown, see [ARCHITECTURE.md](./ARCHITECTURE.md).

## Status

DJ Scrobbler is in active early development, working toward a stable 1.0 release. Rough edges are expected — particularly around tracklist matching, which depends on third-party sites that can change their structure or behavior at any time.

## License

MIT
