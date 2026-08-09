# DJ Scrobbler (fork)

A desktop app that plays DJ sets (YouTube), follows a tracklist (1001Tracklists), and scrobbles individual tracks to a user-chosen Scrobble Target. This fork adds Multi-Scrobbler as a Scrobble Target alongside Last.fm.

## Language

**Scrobble**:
A record that a single track was played, sent to a Scrobble Target once the track has played long enough. Includes artist, title, timestamp, and the set title as album.
_Avoid_: listen (that's ListenBrainz's term for what a scrobble becomes after ingestion)

**Scrobble Target**:
The external service the app scrobbles to. One is active at a time; the user picks it in settings. Last.fm remains the default; Multi-Scrobbler is added by this fork.
_Avoid_: backend, provider (the codebase already uses "source" and "tracklist plugin" for other concepts; don't add a third word for this)

**Multi-Scrobbler**:
The user's self-hosted scrobble relay (multi-scrobbler instance). Receives scrobbles from the app and forwards them to their local ListenBrainz. The app talks to Multi-Scrobbler, never to ListenBrainz directly.

**Now Playing**:
A live "currently playing" signal sent to the Scrobble Target when a track starts; distinct from a Scrobble, which is only sent after the track has played long enough.

**Set**:
A long-form DJ mix (typically a single YouTube video) containing many tracks. The set title is scrobbled as the album so listening history retains context.
_Avoid_: mix, video

**Tracklist**:
The timed list of tracks within a Set, sourced from 1001Tracklists. Track timing boundaries determine when Scrobbles fire.
