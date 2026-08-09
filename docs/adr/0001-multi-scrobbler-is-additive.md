# Multi-Scrobbler support is additive; Last.fm stays the default Scrobble Target

The fork adds Multi-Scrobbler as a selectable Scrobble Target rather than replacing Last.fm. Reason: the fork is intended to become an upstream PR, and a PR that breaks existing users' Last.fm scrobbling would be rejected. This constrains the design toward a small abstraction over scrobble targets instead of a repoint-and-hack patch.
