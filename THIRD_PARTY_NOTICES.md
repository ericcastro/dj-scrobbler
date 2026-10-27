# Third-party software notices

DJ Scrobbler's own code is licensed under MIT; see `LICENSE` (also copied as
`DJ-Scrobbler.LICENSE` beside the bundled media tools). Bundled components retain
their own licenses and copyright notices.

## FFmpeg

FFmpeg is copyright © 2000–2023 the FFmpeg developers, including Fabrice Bellard
and the other authors identified in its source files. Project: https://ffmpeg.org/

Every platform package includes FFmpeg 6.1.1 under the GNU Lesser General Public License,
version 2.1 or later. It is an independent command-line executable. DJ Scrobbler
communicates with it through command-line arguments, media files, and pipes; the
application does not link to the bundled FFmpeg libraries.

Each build uses unmodified upstream source with GPL, nonfree, version-3
license upgrades, and dependency autodetection disabled. Its bundle contains:

- `ffmpeg.LICENSE`: the complete LGPL 2.1 text, including its warranty disclaimer.
- `ffmpeg-SOURCE.tar.xz`: the complete, unmodified corresponding FFmpeg source,
  including its original copyright notices and component licenses.
- `ffmpeg-BUILD.sh`: the build recipe and configure options.
- `FFmpeg-README.txt`: rebuilding and replacement instructions.

This software is based in part on the work of the Independent JPEG Group.
The upstream JPEG-derived files are unmodified.

The macOS build uses Apple VideoToolbox for experimental casting. Windows and
Linux builds support recognition decoding only; casting support is coming soon.
Windows packages also include compiler/runtime notices in `toolchain-licenses`.

FFmpeg is provided without warranty, as described in its applicable license.
Recipients retain the rights to inspect, modify, rebuild, replace, and redistribute
FFmpeg under that license. DJ Scrobbler adds no restriction on those rights or on
reverse engineering for debugging modifications. The application's MIT license
does not replace or narrow the FFmpeg license.

Use About → Licenses & sources to open the bundled media-tool directory. On macOS
this is `DJ Scrobbler.app/Contents/Resources/bin/`; the source is supplied inside
the same app download as the executable. FFmpeg can be replaced without changing
the app bundle by setting `DJ_SCROBBLER_FFMPEG` to an executable's absolute path
before starting the app.

## yt-dlp

The media downloader is yt-dlp: https://github.com/yt-dlp/yt-dlp
Its supplied license text is included as `yt-dlp.LICENSE`.

## Electron and JavaScript dependencies

Electron's license and Chromium license information are included beside these
notices as `Electron.LICENSE` and `Chromium.LICENSES.html`. JavaScript dependencies retain their license files in the
application archive's `node_modules` directory.
