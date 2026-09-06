# Scrobble Targets sit behind a small internal interface, not a plugin system

Scrobbling goes through a minimal interface (`connect / disconnect / nowPlaying / scrobble / status`). Last.fm is refactored to be the first implementation; Multi-Scrobbler (ListenBrainz protocol) is the second. The settings UI offers a target dropdown; Last.fm remains the default.

Rejected alternatives: (i) a parallel hardcoded path behind a hidden flag — not PR-quality, no UI, incoherent shape; (iii) a full plugin registry mirroring `plugins/sources` — over-engineering for two targets. A secondary constraint: upstream's announced v0.5 refactor will rework scrobbling, so this abstraction is deliberately kept shallow to limit rebase conflicts.
