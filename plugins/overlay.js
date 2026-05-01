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
 * @param {object} config
 *   @param {string}   [config.finderScript]  JS expression that evaluates to the
 *                                            player element (most reliable when the
 *                                            page exposes a JS API for its player).
 *   @param {string[]} [config.selectors]     CSS selector fallbacks tried in order.
 * @param {string} bgColor  Hex color from the current app theme.
 */
function buildOverlayScript({ finderScript = null, selectors = [] }, bgColor) {
  const finderExpr = finderScript
    ? `(function(){ try { return (${finderScript}); } catch(e) { return null; } })()`
    : 'null'

  return `(function attempt(tries) {
  if (document.getElementById('_djs_overlay')) return;

  // 1. Try the direct JS expression (page-specific API — most reliable)
  let player = ${finderExpr};

  // 2. Fall back to CSS selectors
  if (!player || !player.tagName) {
    const candidates = ${JSON.stringify(selectors)};
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el && (el.offsetWidth > 50 || el.tagName === 'IFRAME')) {
        player = el;
        break;
      }
    }
  }

  // Not ready yet — retry up to ~3 s
  if (!player) {
    if (tries > 0) setTimeout(() => attempt(tries - 1), 300);
    return;
  }

  // ── Backdrop ──────────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = '_djs_overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;background:${bgColor};opacity:1;' +
    'z-index:9000;pointer-events:none;transition:background .3s;';
  document.body.appendChild(overlay);

  // ── Remove overflow clipping on ancestor chain ─────────────────────────────
  // Required so the player can visually escape its layout box.
  let el = player.parentElement;
  while (el && el !== document.body) {
    if (window.getComputedStyle(el).overflow !== 'visible') el.style.overflow = 'visible';
    el = el.parentElement;
  }

  // ── Float the player full-width above the overlay ─────────────────────────
  // 16:9 → height = 56.25 vw
  const ps = player.style;
  ps.setProperty('position', 'fixed',     'important');
  ps.setProperty('top',      '0',         'important');
  ps.setProperty('left',     '0',         'important');
  ps.setProperty('width',    '100vw',     'important');
  ps.setProperty('height',   '56.25vw',  'important');
  ps.setProperty('z-index',  '9001',     'important');
  ps.setProperty('border',   'none',     'important');
  ps.setProperty('margin',   '0',        'important');
  ps.setProperty('padding',  '0',        'important');

  // If the matched element is a container (not the iframe itself),
  // also stretch any inner iframe to fill it.
  if (player.tagName !== 'IFRAME') {
    const inner = player.querySelector('iframe');
    if (inner) {
      inner.style.setProperty('position', 'absolute', 'important');
      inner.style.setProperty('inset',    '0',        'important');
      inner.style.setProperty('width',    '100%',     'important');
      inner.style.setProperty('height',   '100%',     'important');
      inner.style.setProperty('border',   'none',     'important');
    }
  }
})(10)`   // 10 retries × 300 ms = 3 s max wait
}

/**
 * Builds a tiny JS snippet to live-update the backdrop color on theme change.
 */
function buildColorUpdateScript(bgColor) {
  return `(function(){
  const el = document.getElementById('_djs_overlay');
  if (el) el.style.background = ${JSON.stringify(bgColor)};
})()`
}

module.exports = { buildOverlayScript, buildColorUpdateScript, bgForTheme }
