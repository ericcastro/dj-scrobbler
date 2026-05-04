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

const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

function sign(target) {
  if (!fs.existsSync(target)) return
  try {
    execSync(`codesign --force --sign - --timestamp=none "${target}"`, { stdio: 'pipe' })
    console.log(`[afterPack]   signed: ${path.basename(target)}`)
  } catch (e) {
    console.warn(`[afterPack]   warning: ${path.basename(target)}: ${e.stderr?.toString().trim() || e.message}`)
  }
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productName}.app`
  )
  const contents    = path.join(appPath, 'Contents')
  const frameworks  = path.join(contents, 'Frameworks')
  const macOS       = path.join(contents, 'MacOS')

  console.log(`\n[afterPack] ad-hoc signing ${appPath}\n`)

  // 1. Sign all .dylib and .so files
  try {
    execSync(`find "${appPath}" -type f \\( -name "*.dylib" -o -name "*.so" \\)`, { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .forEach(sign)
  } catch {}

  // 2. Sign the Electron Framework binary directly (versioned path)
  sign(path.join(frameworks, 'Electron Framework.framework', 'Versions', 'A', 'Electron Framework'))

  // 3. Sign the Electron Framework bundle (must come after the binary)
  sign(path.join(frameworks, 'Electron Framework.framework'))

  // 4. Sign each Helper .app
  try {
    execSync(`find "${frameworks}" -maxdepth 1 -name "*.app" -type d`, { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean)
      .forEach(sign)
  } catch {}

  // 5. Sign the main executable
  sign(path.join(macOS, context.packager.appInfo.productName))

  // 6. Sign the outer app bundle last
  sign(appPath)

  console.log('\n[afterPack] done\n')
}
