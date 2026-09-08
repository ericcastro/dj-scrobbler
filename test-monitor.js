/**
 * Standalone DOM inspector for 1001tracklists.
 * Opens the tracklist directly, waits for the page + player to initialise,
 * then dumps every player-related element and polls for changes.
 * Run with:  node_modules/.bin/electron test-monitor.js
 */
const { app, BrowserWindow } = require('electron')

const URL = 'https://www.1001tracklists.com/tracklist/x9hpj21/sara-landry-boiler-room-teletech-festival-united-kingdom-2023-08-05-2023-08-05.html'

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  win.webContents.session.setPermissionRequestHandler((wc, perm, cb) => cb(true))
  win.loadURL(URL)

  win.webContents.on('did-finish-load', async () => {
    console.log('\n=== did-finish-load ===', win.webContents.getURL())

    // ── 0. Keep hammering ALL frames until consent popup is dismissed ────────
    function clickConsentInFrame(frame) {
      frame.executeJavaScript(`
        (() => {
          for (const btn of document.querySelectorAll('button, [role="button"], a')) {
            const t = (btn.textContent || btn.innerText || '').trim()
            if (/accept|reject all|refuse all|got it|i agree|agree/i.test(t)) {
              console.log('[consent] clicking:', t)
              btn.click()
              return true
            }
          }
          return false
        })()
      `).catch(() => {})
      for (const child of frame.frames) {
        clickConsentInFrame(child)
      }
    }

    let consentAttempts = 0
    const consentIv = setInterval(() => {
      consentAttempts++
      clickConsentInFrame(win.webContents.mainFrame)
      if (consentAttempts > 60) clearInterval(consentIv)
    }, 500)

    // Wait up to 20 s for consent to clear and player JS to initialise
    await new Promise(r => setTimeout(r, 20000))
    console.log('=== Starting DOM inspection after 20s wait ===')

    // ── 1. Dump every element that looks player-related ──────────────────────
    const snapshot = await win.webContents.executeJavaScript(`
      (() => {
        const ids = [
          'playerWidget','playerWidgetMessage','playerWidgetPause',
          'playerWidgetCurrentTime','playerWidgetMarquee',
          'playerWidgetFields','playerWidgetSlider',
          'playerWidgetVolume','playerWidgetPlay',
        ]
        const result = {}
        for (const id of ids) {
          const el = document.getElementById(id)
          if (el) {
            result[id] = {
              exists: true,
              visible: el.offsetParent !== null || el.style.display !== 'none',
              display: window.getComputedStyle(el).display,
              text: el.textContent.trim().substring(0, 120),
              className: el.className,
              innerHTML: el.innerHTML.substring(0, 400),
              childCount: el.childElementCount,
            }
          } else {
            result[id] = { exists: false }
          }
        }

        // Any element containing "Track #" text
        const trackLike = Array.from(document.querySelectorAll('*')).filter(el => {
          if (el.children.length > 3) return false
          const t = el.textContent.trim()
          return t.startsWith('Track #') && t.length < 300
        }).map(el => ({
          tag: el.tagName, id: el.id, cls: el.className.substring(0,60), text: el.textContent.trim().substring(0,120)
        }))

        // Scan for any iframes on the page (player might be in one)
        const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({
          id: f.id, src: (f.src || '').substring(0,120), cls: f.className.substring(0,60)
        }))

        // Any element with "player" in id/class
        const playerEls = Array.from(document.querySelectorAll('[id*="player" i], [class*="player" i]'))
          .filter(el => el.id || el.className)
          .slice(0, 20)
          .map(el => ({ tag: el.tagName, id: el.id, cls: (el.className||'').substring(0,60), text: el.textContent.trim().substring(0,80) }))

        return { ids: result, trackLike, iframes, playerEls }
      })()
    `)

    console.log('\n── Player element snapshot ──')
    for (const [id, info] of Object.entries(snapshot.ids)) {
      console.log(id, ':', JSON.stringify(info))
    }
    console.log('\n── Elements with "Track #" text ──')
    snapshot.trackLike.forEach(e => console.log(e))
    console.log('\n── Iframes on page ──')
    snapshot.iframes.forEach(e => console.log(e))
    console.log('\n── Elements with "player" in id/class ──')
    snapshot.playerEls.forEach(e => console.log(JSON.stringify(e)))

    // ── 2. Start a poll that logs any change in player-related elements ───────
    let prev = {}
    setInterval(async () => {
      try {
        const state = await win.webContents.executeJavaScript(`
          (() => {
            const msg      = document.getElementById('playerWidgetMessage')
            const pause    = document.getElementById('playerWidgetPause')
            const time     = document.getElementById('playerWidgetCurrentTime')
            const marquee  = document.getElementById('playerWidgetMarquee')
            const fields   = document.getElementById('playerWidgetFields')

            // Deep-scan any element with "Track #" text, regardless of nesting
            const trackEls = Array.from(document.querySelectorAll('*')).filter(el => {
              const t = (el.textContent || '').trim()
              return t.startsWith('Track #') && t.length < 300 && el.children.length < 6
            }).map(el => ({ tag: el.tagName, id: el.id, cls: (el.className||'').substring(0,40), text: el.textContent.trim().substring(0,120) }))

            return {
              msgExists:   !!msg,
              msgText:     msg     ? msg.textContent.trim()           : '__no_element__',
              msgHTML:     msg     ? msg.innerHTML.trim().substring(0,400) : '',
              msgChildren: msg     ? Array.from(msg.children).map(c => ({ tag: c.tagName, cls: c.className, text: c.textContent.trim().substring(0,80) })) : [],
              pauseClass:  pause   ? pause.className                  : '__no_element__',
              timeText:    time    ? time.textContent.trim()           : '__no_element__',
              marqueeHTML: marquee ? marquee.innerHTML.trim().substring(0,300) : '__no_element__',
              fieldsHTML:  fields  ? fields.innerHTML.trim().substring(0,400) : '__no_element__',
              trackEls,
            }
          })()
        `)

        // Only log when something changes
        const key = JSON.stringify(state)
        if (key !== JSON.stringify(prev)) {
          console.log('\n[CHANGE]', new Date().toISOString())
          console.log('  msgExists   :', state.msgExists)
          console.log('  msgText     :', state.msgText)
          console.log('  msgHTML     :', state.msgHTML)
          console.log('  msgChildren :', JSON.stringify(state.msgChildren))
          console.log('  pauseClass  :', state.pauseClass)
          console.log('  timeText    :', state.timeText)
          console.log('  marqueeHTML :', state.marqueeHTML)
          console.log('  fieldsHTML  :', state.fieldsHTML)
          if (state.trackEls.length) {
            console.log('  trackEls    :', JSON.stringify(state.trackEls))
          }
          prev = state
        }
      } catch (e) {
        console.error('[poll error]', e.message)
      }
    }, 800)
  })
})
