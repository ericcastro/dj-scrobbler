# Scrobble to Multi-Scrobbler via its ListenBrainz endpoint, not its Last.fm endpoint

The fork's Multi-Scrobbler target speaks the ListenBrainz submit-listens API (token auth, plain POST) to the user's Multi-Scrobbler instance, instead of reusing the app's existing Last.fm-protocol machinery against Multi-Scrobbler's Last.fm endpoint.

Chosen because the Last.fm protocol flattens multi-artist tracks into a single artist string (bad for DJ sets, where b2b artists are common), Multi-Scrobbler's docs recommend the ListenBrainz endpoint, and a protocol-neutral Scrobble Target abstraction makes a better upstream PR than "Last.fm with a different hostname." The rejected alternative (Last.fm endpoint) had a smaller diff but would have baked Last.fm's API shape into the abstraction permanently.
