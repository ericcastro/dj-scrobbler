# Roadmap

These are things that are being actively considered or already in progress. Nothing here is a commitment or a timeline — this is an honest list of what's coming, roughly in order of likelihood.

---

## Planned

### Custom Linux window controls
Right now the Linux build uses a native OS title bar (so your window manager draws the close/minimize/maximize buttons). It works across all DEs but doesn't match the app's custom look. The goal is a fully frameless window on Linux with custom controls that match macOS and Windows, without the drag-and-resize bugs that currently make this tricky under Wayland/XWayland.

### Favorite individual tracks
You can already favorite whole sets. The idea is to also star individual tracks from the Now Playing bar or the tracklist — so you end up with a short list of tracks you actually want to revisit, not just the full sets they appeared in.

### Cross-device sync
Favorites, history, and resume positions synced across your devices using your Last.fm account as the identity. No separate account, no extra sign-up — if you're connected to Last.fm, your listening state follows you.

### Sharing sets and tracks
Share a set or a specific track moment with someone. The details are still fuzzy — a deep link, a small share card, something — but the intent is to make it easy to send "listen to this from 42:00" to a friend.

---

## Exploratory

### Android app
An Android wrapper around the core functionality. Electron doesn't run on Android, so this would be a native or hybrid app (React Native or a WebView shell) that talks to the same Last.fm scrobbling flow. More permissive platform for this use case than Apple's ecosystem, and the conversion from the existing JS logic is relatively straightforward.

### iOS / App Store
A natural partner to the Android build. Requires a native or hybrid wrapper since Electron doesn't run on iOS, so more work than Android — but it's coming.

---

## Notes for contributors

If you're interested in picking up any of these, open an issue first so we can talk through the approach. Some of these (sync in particular) have architectural implications that are worth aligning on before code gets written.
