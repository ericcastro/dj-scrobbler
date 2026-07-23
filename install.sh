#!/bin/bash
# DJ Scrobbler installer for macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/ericcastro/dj-scrobbler/main/install.sh | bash
#
# Why this exists: DJ Scrobbler isn't notarized with Apple (yet), so a copy
# downloaded through a browser gets the com.apple.quarantine attribute and
# Gatekeeper blocks it. curl doesn't apply quarantine, so installing this way
# means the app just opens — no "damaged app" dialog, no xattr commands.
# After that, updates are handled inside the app itself.
set -euo pipefail

REPO="ericcastro/dj-scrobbler"
APP="/Applications/DJ Scrobbler.app"
ARCH="$(uname -m)"

echo "==> Finding the latest DJ Scrobbler release"
# The releases list includes pre-releases; /releases/latest would not.
URLS="$(curl -fsSL "https://api.github.com/repos/$REPO/releases?per_page=5" \
  | grep -o '"browser_download_url": *"[^"]*"' | cut -d'"' -f4)"

if [ "$ARCH" = "arm64" ]; then
  URL="$(echo "$URLS" | grep -- '-arm64-mac\.zip$' | head -1 || true)"
else
  URL="$(echo "$URLS" | grep -- '-mac\.zip$' | grep -v arm64 | head -1 || true)"
fi
[ -n "$URL" ] || { echo "No macOS ($ARCH) build found in the latest releases."; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Downloading $(basename "$URL")"
curl -fL --progress-bar "$URL" -o "$TMP/app.zip"

echo "==> Extracting"
ditto -xk "$TMP/app.zip" "$TMP/extracted"
SRC="$(find "$TMP/extracted" -maxdepth 1 -name '*.app' | head -1)"
[ -n "$SRC" ] || { echo "The download did not contain an app bundle."; exit 1; }

if pgrep -x "DJ Scrobbler" >/dev/null 2>&1; then
  echo "==> Quitting the running DJ Scrobbler"
  osascript -e 'tell application "DJ Scrobbler" to quit' >/dev/null 2>&1 || true
  sleep 2
fi

echo "==> Installing into /Applications"
rm -rf "$APP"
ditto "$SRC" "$APP"
# curl-downloaded files carry no quarantine, but strip defensively anyway.
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo "==> Done — launching DJ Scrobbler $(plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist")"
open "$APP"
