const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const ignoredDirs = new Set(['.git', 'dist', 'node_modules'])

function collectJavaScriptFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (ignoredDirs.has(entry.name)) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath)
    }
  }
  return files
}

test('all JavaScript files pass Node syntax checks', () => {
  const files = collectJavaScriptFiles(root)
  const failures = []

  for (const file of files) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
    } catch (err) {
      failures.push(`${path.relative(root, file)}\n${String(err.stderr || err.message)}`)
    }
  }

  assert.deepEqual(failures, [])
})
