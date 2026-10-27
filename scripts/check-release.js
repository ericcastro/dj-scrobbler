const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const manifest = require(path.join(root, 'package.json'))
const lock = require(path.join(root, 'package-lock.json'))
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8')
const version = manifest.version
const errors = []

if (lock.version !== version || lock.packages?.['']?.version !== version) {
  errors.push('package.json and package-lock.json versions must match.')
}
const heading = changelog.match(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})\s*$/m)
if (heading?.[1] !== version) errors.push(`The first CHANGELOG.md release must be ${version} with a release date.`)
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) {
  errors.push(`Release tag ${process.env.GITHUB_REF_NAME} does not match v${version}.`)
}

if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Release metadata is consistent for v${version}.`)
}
