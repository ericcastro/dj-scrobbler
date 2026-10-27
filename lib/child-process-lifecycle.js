// `exit` can precede the final stdout/stderr chunks. Consumers and temporary
// file cleanup must wait for `close`, including when spawning fails.
function observeProcessClose(child) {
  return new Promise(resolve => {
    let error = null
    child.on('error', value => { error ||= value })
    child.once('close', (code, signal) => resolve({ code, signal, error }))
  })
}

async function terminateProcess(child, closed, graceMs = 3000) {
  const running = () => child.exitCode === null && child.signalCode === null
  if (running()) child.kill('SIGTERM')
  const timer = setTimeout(() => {
    if (running()) child.kill('SIGKILL')
  }, graceMs)
  timer.unref?.()
  try {
    return await closed
  } finally {
    clearTimeout(timer)
  }
}

module.exports = { observeProcessClose, terminateProcess }
