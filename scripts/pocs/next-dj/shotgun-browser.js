#!/usr/bin/env electron

// The archived CLI POC shares the hidden-browser transport now used by the
// desktop app, so Shotgun fixes can be verified once without implementation
// drift between the two versions.
const { app } = require('electron')
const { searchShotgunInBrowser } = require('../../../lib/shotgun-browser')

const RESULT_MARKER = '__SHOTGUN_BROWSER_RESULT__'
const query = process.argv[2] || ''
const timeoutMs = Number(process.argv[3]) || 25_000

function output(value) {
  process.stdout.write(`${RESULT_MARKER}${JSON.stringify(value)}\n`)
}

app.commandLine.appendSwitch('disable-gpu')
app.whenReady()
  .then(async () => output({ ok: true, events: await searchShotgunInBrowser(query, { timeoutMs }) }))
  .catch(error => {
    output({ ok: false, error: error.message })
    process.exitCode = 1
  })
  .finally(() => app.quit())
