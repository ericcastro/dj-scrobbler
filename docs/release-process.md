# Release process

Use this checklist for every versioned release:

1. Review the complete diff since the previous release tag.
2. Run `npm test` and build at least one local platform target.
3. Update `package.json`, `package-lock.json`, and `CHANGELOG.md` together.
4. Write release notes as readable Markdown with short sections such as Added, Changed, Fixed, and Verification.
5. Release notes must contain no HTML tags. Use Markdown links, lists, and headings instead.
6. Commit the release preparation, push the branch, then push the matching `vX.Y.Z` tag to trigger CI publishing.
7. Confirm the GitHub release assets and workflow results before announcing the release.

For GitHub releases, prefer `gh release create <tag> --title "..." --notes-file CHANGELOG.md`
or pass a dedicated Markdown notes file. Do not paste generated HTML into the release body.
