/**
 * Shared overlay injection for tracklist plugins.
 *
 * Goal: dim all page noise with a theme-colored backdrop, then surface
 * the player element full-width above it — pure CSS/DOM manipulation,
 * no iframe reparenting (which would cause a reload).
 */

const THEME_BG = {
  'neon-night':  '#0c1220',
  'signal-teal': '#061a1e',
  'sunset-deck': '#160d1a',
}

function bgForTheme(theme) {
  return THEME_BG[theme] || THEME_BG['neon-night']
}

/**
 * Builds a self-contained JS string to inject into a tracklist webview.
 *
 * @param {string[]} selectors  Ordered list of CSS selectors to try for the player
 *                              container. First match with a rendered size wins.
 * @param {string}   bgColor   Hex color from the current app theme.
 */
function buildOverlayScript(selectors, bgColor) {
  return `(function attempt(tries) {
  if (document.getElementById('_djs_overlay')) return;

  // Try each selector in order; require a rendered element
  const candidates = ${JSON.stringify(selectors)};
  let player = null;
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el && (el.offsetWidth > 50 || el.tagName === 'IFRAME')) {
      player = el;
      break;
    }
  }

  // Not ready yet — retry up to ~3 s
  if (!player) {
    if (tries > 0) setTimeout(() => attempt(tries - 1), 300);
    return;
  }

  // ── Backdrop ────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = '_djs_overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;background:${bgColor};opacity:0.5;' +
    'z-index:9000;pointer-events:none;transition:background .3s;';
  document.body.appendChild(overlay);

  // ── Remove overflow clipping on ancestor chain ───────────────────────────
  // Required so the player can visually escape its layout position.
  let el = player.parentElement;
  while (el && el !== document.body) {
    const cs = window.getComputedStyle(el);
    if (cs.overflow !== 'visible') el.style.overflow = 'visible';
    el = el.parentElement;
  }

  // ── Float the player full-width above the overlay ───────────────────────
  // 16:9 aspect ratio → height = 56.25 vw
  const ps = player.style;
  ps.setProperty('position', 'fixed',    'important');
  ps.setProperty('top',      '0',        'important');
  ps.setProperty('left',     '0',        'important');
  ps.setProperty('width',    '100vw',    'important');
  ps.setProperty('height',   '56.25vw', 'important');
  ps.setProperty('z-index',  '9001',    'important');
  ps.setProperty('border',   'none',    'important');
  ps.setProperty('margin',   '0',       'important');
  ps.setProperty('padding',  '0',       'important');

  // If the player is a container (not the iframe itself), stretch the
  // inner iframe/player element to fill it.
  if (player.tagName !== 'IFRAME') {
    const inner = player.querySelector('iframe');
    if (inner) {
      inner.style.setProperty('position', 'absolute', 'important');
      inner.style.setProperty('top',      '0',        'important');
      inner.style.setProperty('left',     '0',        'important');
      inner.style.setProperty('width',    '100%',     'important');
      inner.style.setProperty('height',   '100%',     'important');
      inner.style.setProperty('border',   'none',     'important');
    }
  }
})(10)`   // 10 retries × 300 ms = 3 s max wait
}

/**
 * Builds a tiny JS snippet that updates the backdrop color.
 * Call this when the user changes theme.
 */
function buildColorUpdateScript(bgColor) {
  return `(function(){
  const el = document.getElementById('_djs_overlay');
  if (el) el.style.background = ${JSON.stringify(bgColor)};
})()`
}

module.exports = { buildOverlayScript, buildColorUpdateScript, bgForTheme }
