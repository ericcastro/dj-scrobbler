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
 *   This runs after electron-builder assembles the .app but before it
 *   creates the DMG, so the packaged installer contains the fixed binary.
 */

const { execSync } = require('child_process')
const path = require('path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productName}.app`
  )

  console.log(`\n[afterPack] ad-hoc signing: ${appPath}`)

  try {
    // codesign --deep signs nested helpers and frameworks in the right order
    // (deepest first). --force replaces Electron's existing signatures.
    execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: 'inherit' })
    console.log('[afterPack] done\n')
  } catch (e) {
    // Log but don't throw — a codesign failure should not abort the release.
    // The app will still run; it just won't have the ad-hoc fix for macOS 15.
    console.warn('[afterPack] codesign failed (non-fatal):', e.message)
  }
}
