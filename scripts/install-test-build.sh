#!/bin/bash
# End-to-end test for the unsigned macOS auto-update path.
#
# Builds DJ Scrobbler with a deliberately low version number, installs it into
# /Applications (replacing whatever is there), launches it, and watches it
# self-update to the latest GitHub release — no clicks, no terminal hacks.
#
# Usage:
#   scripts/install-test-build.sh                 # build 0.1.0, hands-free update, watch result
#   scripts/install-test-build.sh --version 0.2.0 # use a different fake version
#   scripts/install-test-build.sh --manual        # launch normally: exercise the update dialog by hand
#   scripts/install-test-build.sh --no-watch      # install + launch, don't wait for the update
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="0.1.0"
AUTO=1
WATCH=1
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --manual)  AUTO=0; shift ;;
    --no-watch) WATCH=0; shift ;;
    *) echo "unknown argument: $1"; exit 1 ;;
  esac
done

APP="/Applications/DJ Scrobbler.app"
ARCH="$(uname -m)"
if [ "$ARCH" = "arm64" ]; then
  BUILD_ARCH="--arm64"
  BUILT="dist/mac-arm64/DJ Scrobbler.app"
else
  BUILD_ARCH="--x64"
  BUILT="dist/mac/DJ Scrobbler.app"
fi

echo "==> Building DJ Scrobbler $VERSION ($ARCH)"
npx electron-builder --mac dir "$BUILD_ARCH" -c.extraMetadata.version="$VERSION"
[ -d "$BUILT" ] || { echo "build output not found: $BUILT"; exit 1; }

echo "==> Quitting any running DJ Scrobbler"
osascript -e 'tell application "DJ Scrobbler" to quit' >/dev/null 2>&1 || true
sleep 1
pkill -x "DJ Scrobbler" >/dev/null 2>&1 || true
sleep 1

echo "==> Installing test build $VERSION into /Applications (replaces the current install)"
rm -rf "$APP"
ditto "$BUILT" "$APP"

INSTALLED="$(plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist")"
echo "==> Installed version: $INSTALLED"

if [ "$AUTO" = 1 ]; then
  echo "==> Launching with --auto-update-test (hands-free update)"
  open -n "$APP" --args --auto-update-test
else
  echo "==> Launching normally — use the in-app update dialog"
  open -n "$APP"
fi

[ "$WATCH" = 1 ] || exit 0

DEBUG_LOG="$(getconf DARWIN_USER_TEMP_DIR)djscrobbler-debug.log"
HELPER_LOG="$HOME/Library/Application Support/DJ Scrobbler/updates/install-update.log"

echo "==> Waiting for the app to replace itself (timeout 10 min)"
echo "    app log:    $DEBUG_LOG"
echo "    helper log: $HELPER_LOG"
for i in $(seq 1 300); do
  sleep 2
  V="$(plutil -extract CFBundleShortVersionString raw -o - "$APP/Contents/Info.plist" 2>/dev/null || echo '?')"
  if [ "$V" != "$VERSION" ] && [ "$V" != "?" ]; then
    echo "==> SUCCESS: /Applications now has DJ Scrobbler $V (was $VERSION)"
    exit 0
  fi
  if [ $((i % 10)) -eq 0 ]; then
    LAST="$(grep -E '\[mac-updater\]|\[update\]' "$DEBUG_LOG" 2>/dev/null | tail -1 || true)"
    echo "    still $V... ${LAST:-no updater log lines yet}"
  fi
done

echo "==> TIMED OUT — the installed app is still $VERSION"
echo "--- last app log lines ---"
tail -20 "$DEBUG_LOG" 2>/dev/null || echo "(no app log)"
echo "--- helper log ---"
cat "$HELPER_LOG" 2>/dev/null || echo "(no helper log)"
exit 1
