#!/usr/bin/env bash
set -euo pipefail

archive="$1"
platform="$2"
arch="$3"
output="$4"
flags=()
case "$platform-$arch" in
  linux-x64|linux-arm64)
    # Build natively on the corresponding Linux runner.
    if [[ "$(uname -m)" != "$([[ "$arch" == arm64 ]] && echo aarch64 || echo x86_64)" ]]; then
      echo 'The decoder build requires a native Linux runner for this architecture.' >&2
      exit 1
    fi
    ;;
  win32-x64)
    # Run under MSYS2 UCRT64 so Windows paths and the compiler are unambiguous.
    archive="$(cygpath -u "$archive")"
    output="$(cygpath -u "$output")"
    flags+=(--target-os=mingw32 --arch=x86_64 --cc=gcc --extra-ldflags=-static)
    ;;
  *) echo "Unsupported decoder build target: $platform-$arch" >&2; exit 1 ;;
esac

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
tar -xf "$archive" -C "$work_dir" --strip-components=1
cd "$work_dir"

# Windows/Linux recognition needs file decoding and float PCM output. Casting
# is disabled there in this release, so no GPL H.264 encoder is required.
./configure \
  --disable-autodetect --disable-gpl --disable-nonfree --disable-version3 \
  --disable-doc --disable-debug --disable-ffplay --disable-ffprobe \
  --enable-static --disable-shared --disable-x86asm --disable-avdevice \
  --disable-encoders --enable-encoder=pcm_f32le \
  --disable-muxers --enable-muxer=pcm_f32le \
  "${flags[@]}" || {
    tail -60 ffbuild/config.log >&2
    exit 1
  }

if ! grep -q '^#define FFMPEG_LICENSE "LGPL version 2.1 or later"' config.h; then
  echo 'Refusing to package an unexpected FFmpeg license configuration.' >&2
  exit 1
fi
jobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 2)"
if (( jobs > 8 )); then jobs=8; fi
program=ffmpeg
if [[ "$platform" == win32 ]]; then program=ffmpeg.exe; fi
make -j "$jobs" "$program"
mkdir -p "$(dirname "$output")"
cp "$program" "$output"
chmod +x "$output"
