/**
 * electron-builder afterPack hook — ad-hoc sign the macOS app bundle.
 *
 * Problem (macOS 15 / Sequoia):
 *   Electron Framework ships pre-signed with Electron's own Team ID.
 *   An unsigned app wrapper has no Team ID. macOS 15 enforces that all
 *   frameworks loaded by a process share the same Team ID, so dyld refuses
 *   to load and the app crashes immediately at launch.
 *
 * Fix:
 *   Re-sign every binary in the bundle with an ad-hoc identity (`-`).
 *   Ad-hoc signatures carry no Team ID, so the mismatch disappears.
 *
 *   We sign in explicit inside-out order (deepest first) rather than
 *   relying on codesign --deep, which has known issues with Electron's
 *   versioned framework structure.
 *
 *   package.json sets "identity": null so electron-builder does NOT run its
 *   own signing step after this hook. That step used "type=distribution"
 *   which adds Library Validation (CS_REQUIRE_LV), causing macOS to enforce
 *   Team ID consistency and crash even after our re-signing.
 */

const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

function sign(target) {
  execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', target], { stdio: 'pipe' })
  console.log(`[afterPack]   signed: ${path.basename(target)}`)
}

function collectSignablePaths(root) {
  const binaries = []
  const bundles = []
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        walk(target)
        if (/\.(?:app|framework|xpc)$/.test(entry.name)) bundles.push(target)
        continue
      }
      if (!entry.isFile()) continue
      const mode = fs.statSync(target).mode
      if ((mode & 0o111) || /\.(?:dylib|so)$/.test(entry.name)) binaries.push(target)
    }
  }
  walk(root)
  const deepestFirst = (left, right) => right.split(path.sep).length - left.split(path.sep).length
  return {
    binaries: binaries.sort(deepestFirst),
    bundles: bundles.sort(deepestFirst),
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productName}.app`
  )
  console.log(`\n[afterPack] ad-hoc signing ${appPath}\n`)

  // A dynamic walk covers framework helpers such as Squirrel's ShipIt and
  // remains correct when Electron changes its nested component inventory.
  const { binaries, bundles } = collectSignablePaths(appPath)
  binaries.forEach(sign)
  bundles.forEach(sign)
  sign(appPath)

  // A failed seal means the bundle may not launch; do not publish it silently.
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'pipe' })
  console.log('\n[afterPack] signature verified\n')
}

exports._test = { collectSignablePaths }
