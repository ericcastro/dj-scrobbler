# TV casting plan

Status: researched; implementation has not started.

## Product contract

- The TV must receive the configured focus/enhanced view, including both overlays.
- After a target has been chosen once, the Cast button is a true toggle: click to start on that TV, click again to stop.
- If there is no saved target, selecting one from discovery starts playback immediately. If the saved target is unavailable, discovery replaces a failed silent guess.
- The desktop remains the playback controller. A context menu can change the preferred TV without complicating the primary button.

## What established products do

Netflix, Disney+, and Hulu use the sender as a remote and launch a receiver that fetches the media itself. Spotify Connect similarly transfers playback to another playback endpoint. Plex is the closest fit for DJ Scrobbler: the receiver streams from Plex Media Server, while the server chooses direct play, remuxing, or transcoding based on receiver capabilities.

This app cannot simply launch YouTube's Cast receiver because a separate receiver cannot draw DJ Scrobbler's overlays. Embedding YouTube inside an arbitrary Custom Web Receiver is also intentionally unsupported. The reliable common denominator is therefore a composed video stream whose pixels already contain the overlays.

## Recommended architecture

1. Capture the focus/enhanced composition with video and audio as one synchronized `MediaStream`.
2. Encode 1080p H.264/AAC into a short rolling HLS window. Start with one-second segments and tune only after measuring real devices.
3. Serve the manifest and segments from a tokenized, LAN-only HTTP endpoint with the required CORS headers.
4. Discover Cast targets over mDNS and persist the selected device identity rather than its changeable IP address.
5. Launch Google's Default Media Receiver over CASTV2 and load the local HLS URL. A connected click sends stop and tears down capture, encoder, files, HTTP server, and Cast session.

The Default Media Receiver supports HLS and needs no receiver registration. Electron still does not expose Chrome's Media Router, so the sender side needs a small CASTV2 integration. The existing `node-castv2-client` proves the protocol route, but it is old; prefer a small audited/vendored adapter with contract tests over letting an abandoned dependency own application state.

## Delivery phases

### 1. Device and transport spike

- Discover receivers, select one, persist it, launch/stop the Default Media Receiver.
- Serve a generated HLS test card containing moving overlay-like content and audio.
- Measure start time, steady latency, reconnect behavior, and teardown on macOS plus at least one Cast target.

### 2. Existing-window capture

- Capture the current focus/enhanced window using Electron's frame/window capture support.
- Feed the unified audio/video stream to the encoder and Cast target.
- This proves the full path with the real overlays before building a second renderer.

### 3. Dedicated TV compositor

- Render a fixed 1920×1080 hidden/offscreen presentation surface using the same overlay components and persisted configuration.
- Synchronize it with the existing player so casting does not resize, obscure, or otherwise alter the desktop window.
- Prefer platform hardware H.264 encoders where available, with a conservative software fallback.

### 4. AirPlay adapter

- Reuse the same HLS output with a small macOS AVPlayer/AVRoutePickerView helper.
- Apple deliberately owns route selection UI, so the first connection cannot be silently targeted through public APIs. Chromecast remains the path that can most closely satisfy the saved-target, one-click toggle.

## Rejected primary approaches

- **Chrome tab mirroring:** exact pixels, but Electron has no supported Media Router/Cast integration and driving Chrome's toolbar UI would add a second visible application and fragile OS automation.
- **YouTube receiver plus separate overlay:** Cast runs one receiver application; DJ Scrobbler cannot draw over YouTube's receiver.
- **YouTube iframe in a Custom Web Receiver:** Google records this as intended unsupported behavior.
- **Extract YouTube CDN URLs and rebuild the UI on the receiver:** potentially more efficient, but substantially more brittle than capture, complicates A/V stream assembly, and still duplicates the overlay renderer.
- **AirPlay screen mirroring as the only path:** visually exact but does not meet the reliability or one-click control goals.

## Research references

- [Google Cast overview](https://developers.google.com/cast/docs/overview)
- [Default and Custom Web Receivers](https://developers.google.com/cast/docs/web_receiver)
- [Cast-supported media, including HLS](https://developers.google.com/cast/docs/media)
- [Electron desktop capture](https://www.electronjs.org/docs/latest/api/desktop-capturer)
- [Electron's unresolved/closed Cast integration request](https://github.com/electron/electron/issues/7024)
- [YouTube iframe in a Custom Receiver: intended unsupported behavior](https://issuetracker.google.com/issues/35176103)
- [Plex direct play, remux, and transcoding model](https://support.plex.tv/articles/200430303-streaming-overview/)
- [Plex receiver streams from the server, not through the controller](https://support.plex.tv/articles/201214366-casting-support/)
- [Netflix Chromecast controller flow](https://help.netflix.com/en/node/23924)
- [Disney+ Chromecast controller flow](https://help.disneyplus.com/article/disneyplus-cast-airplay-tv)
- [Hulu casting and AirPlay flow](https://help.hulu.com/article/hulu-video-out)
- [Spotify Connect's controller/playback-device model](https://support.spotify.com/us/article/spotify-connect/)
- [AirPlay route picker](https://developer.apple.com/documentation/avkit/avroutepickerview)
