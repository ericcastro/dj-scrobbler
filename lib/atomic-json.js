const fs = require('node:fs')

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2))
    fs.renameSync(temporaryPath, filePath)
  } catch (error) {
    try { fs.unlinkSync(temporaryPath) } catch {}
    throw error
  }
}

module.exports = { writeJsonAtomic }
