const { developmentMediaToolsDirectory } = require('../lib/media-tools')
const { prepareMediaTools } = require('./prepare-media-tools')

prepareMediaTools({
  platform: process.platform,
  arch: process.arch,
  destination: developmentMediaToolsDirectory(),
}).catch(error => {
  console.error(error)
  process.exitCode = 1
})
