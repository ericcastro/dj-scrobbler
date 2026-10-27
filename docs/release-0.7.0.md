# 0.7.0 release preparation

**Release scope:** casting is experimental and macOS-only. Windows/Linux casting support is coming soon and disabled in both the UI and main process. All three platform apps retain playback, tracklists, recognition, and scrobbling.


Prepared on 2026-10-27 from `codex/youtube-comments-tracklist`, following review of the changes since `v0.6.1` and the surrounding runtime, renderer, provider, persistence, update, native-helper, test, and packaging code.

## Changes from the scan

- Share subprocess completion and termination across background audio, FFmpeg, and AirPlay. Wait for closed pipes before consuming final output or removing temporary files, reject pre-cancelled work before spawning, and force termination after a grace period.
- Bound AirPlay startup and cancel FFmpeg readiness polling after shutdown or early exit. Handle missing executables without unhandled rejections or stuck cleanup.
- Close failed Chromecast sockets, clear pending response waits, permit connection retry, and handle BUFFERING and PLAYING arriving in the same TCP packet.
- Protect replacement casting sessions from old preparation, startup errors, and delayed cleanup. Close active HTTP connections during HLS teardown and destroy file streams when receivers disconnect.
- Consolidate hidden provider-page extraction, observe navigation promise rejections, deny popups, and close windows on completion, timeout, or renderer failure. Browser source failures now release the lookup latch.
- Preserve every pending artwork row when an ID edit replaces its lookup generation. Persist an explicit override for obsolete ambiguous artist/title splits.
- Normalize accepted YouTube cue rows into playback order without changing saved edit identities. Keep null, missing, empty, and invalid timestamps distinct from a real cue at zero.
- Share YouTube text extraction, restrict interception to HTTPS YouTube hosts, and validate both the scheme and hostname of external links.
- Replace blanket session permission grants with media access scoped to app-owned capture frames and deny unrelated permissions. Prevent the privileged app window from navigating to remote pages or opening popups.
- Remove the unused titlebar palette/helper and relative-seek helper. Replace tests of dead titlebar code with runtime checks of the actual creation and theme-update functions. Pin the event-ordering fixture's date.
- Add CI checks for manifest, lockfile, changelog, and publishing-tag consistency.

## macOS FFmpeg nonfree blocker resolved

The previously pinned Apple Silicon FFmpeg prebuilt reported `--enable-nonfree` and identified itself as not redistributable. A downloaded generic license description had hidden that distinction. The new packaging guard rejects that binary.

Both macOS architectures now build unmodified FFmpeg 6.1.1 from the official source archive, pinned to SHA-256 `8684f4b00f94b85461884c3719382f1261f0d9eb3d59640a1f4ac0873616f968`. The build disables GPL, nonfree, version-3 license upgrades, and dependency autodetection. It uses Apple system frameworks for hardware H.264 encoding. Configure's generated LGPL 2.1-or-later result is checked even for cross-compilation; native packaging also checks the executable's license report.

The macOS bundle includes the source archive, build recipe, and complete LGPL text alongside the executable. See [FFmpeg's upstream license explanation](https://github.com/FFmpeg/FFmpeg/blob/n6.1.1/LICENSE.md) for the effect of its configure options. Windows and Linux now build a decoder-only LGPL FFmpeg from the same pinned source. This retains recognition without a casting encoder; native decoder tests and the material/license guards run before packaging.

## Local verification

- `npm test`: **391 passed, 0 failed, 0 skipped**, using Node 24.14.0. CI retains its Node 20 matrix.
- New behavioral coverage includes process cancellation and pipe completion, missing executables, hidden-window failures, Chromecast transport failures, coalesced receiver statuses, stale casting sessions, artwork generation replacement, timestamp normalization, navigation recovery, cue ordering, saved corrections, and license rejection.
- `npm run check:release` passes, including the matching `v0.7.0` tag environment. A deliberately mismatched tag is rejected.
- `git diff --check` passes. JavaScript syntax checks run as part of the suite; shell syntax was checked separately.
- macOS arm64 ZIP and DMG packaging completes with publishing disabled. The app is ad-hoc signed and passes `codesign --verify --deep --strict`.
- Packaged application sources match the final workspace files, the bundled FFmpeg source checksum matches its pin, and updater SHA-512 values match the generated installers. `dist/SHA256SUMS` provides local artifact checksums.
- The bundled FFmpeg decodes a synthetic VP8/Opus WebM fixture to exactly 64,000 bytes of one-second, mono, 16 kHz float PCM. The same replacement binary encodes the fixture through Apple VideoToolbox and AAC into four HLS segments.
- The packaged renderer and preload start under Electron 41.3.0 with an isolated temporary profile, outbound browser requests disabled, and discovery stubbed. YouTube source registration, empty listening stats, tracklist UI, focus controls, and casting controls respond. This is an offline startup check of the packaged code, not a live service/device test.
- An app-owned display-capture request reaches a stub capture handler that denies the stream, while geolocation permission is denied. No screen/audio recording is made by this permission check.
- The final About notice and “Licenses & sources” IPC/button were smoke-tested offline and visually checked. Source/license/recipe/notice checks pass for the actual bundle; missing source and a truncated license are rejected. Electron/Chromium notice copies match the official installed runtime byte-for-byte.
- The bundled yt-dlp starts and reports `2026.08.19`. The AirPlay helper contains both `x86_64` and `arm64` slices.

Local artifacts are under `dist/`:

- `DJ Scrobbler-0.7.0-arm64.dmg`
- `DJ Scrobbler-0.7.0-arm64-mac.zip`
- Update blockmaps and `latest-mac.yml`

Build command: `npm run build -- --mac zip dmg --arm64 --publish never`.

## Remaining release checks

- Windows/Linux packages must pass the native decoder and package workflow using the new controlled LGPL source builds. See [the scoped FFmpeg compliance check](ffmpeg-compliance.md).
- Add the FFmpeg license/source attribution to public download pages before publication, following FFmpeg's recommended checklist. The dedicated public release notes include this attribution. The app now includes prominent About attribution and opens its bundled licenses/source directory.
- Dependency advisory audit: automatic approval review rejected `npm audit` because it sends dependency metadata to npm's advisory service. Explicit user approval is needed before retrying. No audit result or clean vulnerability status is claimed.
- Run the Windows/Linux CI matrix and Intel macOS packaging. The macOS source-build recipe supports Intel, but that target was not built locally.
- Smoke-test live YouTube playback, provider switching and edited IDs, recognition, Last.fm authorization/scrobbling, Chromecast, AirPlay route selection, and update installation on the final packages.
- Review and commit the prepared changes. Pushing a matching version tag publishes through CI; the public release is created only after CI completes.

## Follow-up maintainability work

The main-process and renderer entry points remain large and contain substantial stateful orchestration. Continue extracting small services behind behavioral tests as their behavior changes. Existing source-contract tests remain useful wiring checks, but should not substitute for runtime tests of new asynchronous behavior. A broader rewrite of the stable player was deliberately left out of this release preparation.
