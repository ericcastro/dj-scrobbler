# FFmpeg redistribution check

This records the technical checks for DJ Scrobbler 0.7.0's separate FFmpeg command-line tool. It is not an all-platform license clearance for the entire application bundle.

## All platforms: LGPL 2.1 or later

DJ Scrobbler invokes FFmpeg as a child process using ordinary command-line arguments, files, and media pipes. It does not link the app to that tool's libraries. Our assessment is that these are independent programs distributed together, so the app's own code can remain MIT. This follows the [FSF's distinction between separate programs and combined works](https://www.gnu.org/licenses/gpl-faq.en.html#MereAggregation); process separation alone would not settle the question if the programs exchanged private internal data structures.

The FFmpeg executable itself statically incorporates its LGPL libraries. We supply the complete, unmodified source, including the command-line program and library sources, plus the build script. Static linking inside that executable therefore does not rely on an exemption for dynamic linking. See [LGPL 2.1 sections 4 and 6](https://raw.githubusercontent.com/FFmpeg/FFmpeg/n6.1.1/COPYING.LGPLv2.1).

| Item | Implementation / verification |
| --- | --- |
| LGPL configuration | GPL, nonfree, license-version upgrades, and host dependency autodetection are disabled. Configure must report LGPL 2.1-or-later; the native executable's license report is checked too. |
| Corresponding source | The exact checksum-pinned, unmodified FFmpeg 6.1.1 source archive is included inside every app download, beside the executable. |
| Build materials | The matching build script and prerequisites/rebuild instructions accompany the source. All upstream source notices are retained. |
| Full license and warranty notice | Complete LGPL 2.1 text is included as `ffmpeg.LICENSE`; attribution and no-warranty wording are in the bundled notices. |
| Prominent attribution/access | About identifies FFmpeg and the platform's license. “Licenses & sources” opens the directory containing licenses, source, and rebuild instructions. |
| Modifications | No upstream FFmpeg source files are changed. The build options, rather than source patches, select the package's feature set. |
| User modification/replacement | `DJ_SCROBBLER_FFMPEG` selects a compatible rebuilt executable outside the signed app bundle. No app terms restrict these rights. |
| App's MIT license and runtime notices | The app license is explicitly packaged and copied beside the media tools; it does not replace FFmpeg's license. The official Electron and Chromium notices are copied into that accessible directory too. |
| Package enforcement | Preparation verifies the source/license checksums, copied build recipe, and required notices before packaging can finish. |

Providing source inside the same download follows LGPL section 4's source-accompaniment route; it does not depend on a future written source offer or the continued availability of an upstream URL.

[FFmpeg's own checklist](https://ffmpeg.org/legal.html) also recommends attribution on download pages and an accessible source link. Its dynamic-linking recipe is aimed at applications linking FFmpeg libraries; this app invokes an independent executable. Before publishing, the website and release page should say that the app download includes FFmpeg under LGPL 2.1-or-later and includes its corresponding source and build materials. The live website was not edited during this check.

Suggested download-page copy:

> The app includes FFmpeg under LGPL 2.1-or-later. Its complete corresponding source, license, and build instructions are included in the download and accessible through About → Licenses & sources.

## Windows and Linux recognition builds

0.7.0 replaces the GPL prebuilts with builds from the same pinned, unmodified FFmpeg source. GPL/nonfree components and dependency autodetection are disabled. These builds decode source audio and encode/mux float PCM for recognition; they include no H.264 casting encoder. The exact source, recipe, full LGPL text, notices, and compiler/runtime notices accompany each package. Native CI checks AAC and Opus decoding plus the material/license guards before packaging.

Casting is experimental and macOS-only. Windows/Linux discovery and casting preparation are disabled, with “coming soon” copy in the app and release notes.

Other bundled components, including Electron/Chromium, yt-dlp, native recognition modules, and JavaScript dependencies, have their own notices and obligations. Their license files are retained; a complete dependency-license audit is a separate release check.
