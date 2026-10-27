# Release process

Use this checklist for every versioned release:

1. Review the complete diff since the previous release tag.
2. Run `npm test`, `npm run check:release`, and build at least one local platform target with publishing disabled (for example, `npm run build -- --mac dmg zip --arm64 --publish never`).
3. Update `package.json`, `package-lock.json`, and `CHANGELOG.md` together.
4. Write release notes as readable Markdown with short sections such as Added, Changed, Fixed, and Verification.
5. Release notes must contain no HTML tags. Use Markdown links, lists, and headings instead.
6. Commit the release preparation, push the branch, then push the matching `vX.Y.Z` tag to trigger CI publishing.
7. Confirm the GitHub release assets and workflow results before announcing the release.

Release preparation stops before pushing or publishing unless those actions were explicitly requested. Record local build results, signature verification, outstanding platform/device smoke checks, and any unavailable dependency audit in a version-specific verification document. Use an isolated user-data directory for launch smoke checks so release validation does not modify normal listening history or Last.fm settings.

Check the actual FFmpeg binary's `-L` report, not only its downloaded license file. Native packaging rejects nonfree/unredistributable reports. macOS builds compile pinned upstream source with GPL and nonfree components disabled and ship the source, build recipe, and full LGPL text; Xcode Command Line Tools are required. Verify PCM decoding and a short HLS encode when changing that toolchain.

Review [FFmpeg redistribution checks](ffmpeg-compliance.md) for each platform. A passing executable-license guard is not a corresponding-source audit. Windows/Linux must use the controlled LGPL decoder builds and include their exact source/build materials. Run `npm run test:media` on each native platform before publishing. Keep FFmpeg attribution in About and on download pages.

CI checks that the manifest, lockfile, first changelog entry, and release tag agree before publishing platform assets.

For GitHub releases, prefer `gh release create <tag> --title "..." --notes-file CHANGELOG.md`
or pass a dedicated Markdown notes file. Do not paste generated HTML into the release body.

For 0.7.0, use `docs/releases/v0.7.0.md` as the public release body. Casting must be described as experimental and macOS-only, with Windows/Linux support coming soon. Keep the release a draft until every platform job passes and its assets are present, then publish it.
