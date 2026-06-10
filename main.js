// Multi Plus Desktop v6 — Full Chrome Mode, No Crash, Messages Fixed, Right-Click Menu
'use strict';

const {
  app, BrowserWindow, BrowserView, Menu, MenuItem,
  ipcMain, clipboard, shell, session: electronSession, nativeTheme,
  Tray, nativeImage, Notification
} = require('electron');

// Force dark theme globally — prevents system light/white mode from overriding
nativeTheme.themeSource = 'dark';
const path  = require('path');
const fs    = require('fs');
const Store = require('electron-store');

const store = new Store();

// ── Global proxy credentials (for app.on('login') — catches ALL sessions) ─
// Updated whenever lp:setProxy / lp:clearProxy / lp:setContainerProxy fires.
// Stores the MOST RECENTLY ACTIVATED proxy credentials.
let _gProxyUser = '';
let _gProxyPass = '';

// app-level login event — catches proxy 407 for EVERY session in the app,
// including temp test sessions, default session, and named partitions.
// This is the most reliable proxy auth approach (Grok/GoLogin pattern).
app.on('login', (event, _webContents, _request, authInfo, callback) => {
  if (authInfo.isProxy) {
    event.preventDefault();
    callback(_gProxyUser, _gProxyPass);
  }
});

// ── Global uncaught exception guard ───────────────────────────────────────
// Prevents native crash dialogs from Electron's net.request tunnel errors
// (e.g. ERR_TUNNEL_CONNECTION_FAILED) escaping into the main process.
process.on('uncaughtException', (err) => {
  // Silently swallow known network errors so Electron doesn't show crash dialog
  const NET_ERRS = ['ERR_TUNNEL_CONNECTION_FAILED','ERR_CONNECTION_REFUSED',
    'ERR_NAME_NOT_RESOLVED','ERR_PROXY_CONNECTION_FAILED','ERR_TIMED_OUT',
    'ERR_CONNECTION_TIMED_OUT','ERR_EMPTY_RESPONSE','ERR_FAILED'];
  if (err && NET_ERRS.some(e => String(err.message || '').includes(e))) return;
  console.error('[MultiPlus uncaughtException]', err);
});

// ── Chrome 124 Desktop identity ───────────────────────────────────────────
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

// Samsung Galaxy S24 Ultra — Android 14 — Chrome 124
const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; SM-S928B Build/UP1A.231005.007) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Mobile Safari/537.36';

// S24 Ultra logical viewport  (1440 physical / 3.5 DPR = 411.4 → 412)
const SAMSUNG_W  = 412;
const SAMSUNG_H  = 915;
const SAMSUNG_DPR = 3.5;

// Chrome client-hint headers — required for Facebook to treat us as real Chrome
const DESKTOP_EXTRA_HEADERS = {
  'Accept-Language':    'en-US,en;q=0.9',
  'sec-ch-ua':          '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile':   '?0',
  'sec-ch-ua-platform': '"Windows"',
};

const MOBILE_EXTRA_HEADERS = {
  'Accept-Language':    'en-US,en;q=0.9',
  'sec-ch-ua':          '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'sec-ch-ua-mobile':   '?1',
  'sec-ch-ua-platform': '"Android"',
};

// Anti-bot-detection script — injected before page scripts run
// Makes Electron look exactly like real Chrome to Facebook's JS checks
const ANTI_DETECT_SCRIPT = `
(function() {
  try {
    // Remove webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    // Realistic plugin list
    Object.defineProperty(navigator, 'plugins', { get: () => ({
      length: 3,
      0: { name:'Chrome PDF Plugin',  filename:'internal-pdf-viewer', description:'Portable Document Format' },
      1: { name:'Chrome PDF Viewer',  filename:'mhjfbmdgcfjbbpaeojofohoefgiehjai', description:'' },
      2: { name:'Native Client',      filename:'internal-nacl-plugin', description:'' },
      namedItem: function(n){ return null; }, item: function(i){ return this[i]||null; },
      refresh: function(){}
    }), configurable: true });
    // Language
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true });
    // Chrome object that real Chrome has
    if (!window.chrome) {
      window.chrome = {
        runtime: { id: undefined, sendMessage: function(){}, onMessage: { addListener: function(){}, removeListener: function(){} } },
        loadTimes: function() { return { requestTime: Date.now()/1000, startLoadTime: Date.now()/1000, commitLoadTime: Date.now()/1000, finishDocumentLoadTime: Date.now()/1000, finishLoadTime: Date.now()/1000, firstPaintTime: 0, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: false, wasNpnNegotiated: false, npnNegotiatedProtocol: '', wasAlternateProtocolAvailable: false, connectionInfo: 'h2' }; },
        csi: function() { return { startE: Date.now(), onloadT: Date.now(), pageT: Date.now(), tran: 15 }; },
        app: { isInstalled: false, getDetails: function(){return null;}, runningState: function(){return 'cannot_run';} }
      };
    }
    // Consistent screen values
    Object.defineProperty(screen, 'colorDepth', { get: () => 24, configurable: true });
    Object.defineProperty(screen, 'pixelDepth',  { get: () => 24, configurable: true });
  } catch(e) {}
})();
`;

// Mouse → Touch simulation script for mobile mode
// Short click (< 6 px movement) → real mouse click (links still work)
// Drag (≥ 6 px movement)        → touchstart/touchmove/touchend (scrolls page)
const MOUSE_TO_TOUCH_SCRIPT = `
(function() {
  if (window.__mpMouseToTouch) return;
  window.__mpMouseToTouch = true;
  var isDown = false, isSwiping = false;
  var startX = 0, startY = 0, lastX = 0, lastY = 0;
  var THRESHOLD = 6;
  var activeTouchTarget = null;
  function sendTouch(type, x, y) {
    var el = document.elementFromPoint(x, y) || document.body;
    if (type === 'touchstart') activeTouchTarget = el;
    var target = activeTouchTarget || el;
    try {
      var touch = new Touch({ identifier: Date.now(), target: target,
        clientX: x, clientY: y, screenX: x, screenY: y,
        pageX: x + window.scrollX, pageY: y + window.scrollY,
        radiusX: 10, radiusY: 10, rotationAngle: 0, force: 1 });
      var noTouches = type === 'touchend' || type === 'touchcancel';
      target.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: noTouches ? [] : [touch],
        changedTouches: [touch],
        targetTouches: noTouches ? [] : [touch]
      }));
    } catch(_) {}
    if (type === 'touchend' || type === 'touchcancel') activeTouchTarget = null;
  }
  document.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    isDown = true; isSwiping = false;
    startX = lastX = e.clientX; startY = lastY = e.clientY;
  }, true);
  document.addEventListener('mousemove', function(e) {
    if (!isDown) return;
    var dx = e.clientX - startX, dy = e.clientY - startY;
    if (!isSwiping && Math.sqrt(dx*dx + dy*dy) >= THRESHOLD) {
      isSwiping = true;
      sendTouch('touchstart', startX, startY);
    }
    if (isSwiping) { sendTouch('touchmove', e.clientX, e.clientY); }
    lastX = e.clientX; lastY = e.clientY;
  }, true);
  document.addEventListener('mouseup', function(e) {
    if (!isDown) return;
    if (isSwiping) sendTouch('touchend', lastX, lastY);
    isDown = false; isSwiping = false;
  }, true);
  document.addEventListener('mouseleave', function() {
    if (isDown && isSwiping) sendTouch('touchcancel', lastX, lastY);
    isDown = false; isSwiping = false;
  }, true);
})();
`;

const FB_HOME    = 'https://www.facebook.com/';
const FB_MOBILE  = 'https://m.facebook.com/';
const TOOLBAR_H  = 46;   // main title/nav bar
const TAB_BAR_H = 36;   // per-container tab strip
const VIEW_TOP  = TOOLBAR_H + TAB_BAR_H;      // BrowserView starts exactly below toolbar + tab strip — no thin background gap

// ── Tab management ─────────────────────────────────────────────────────────
// containerTabs      { cid: [{id, title, url}] }
// containerActiveTab { cid: tabId }
// tabViewMap         { tabId: BrowserView }
const containerTabs      = {};
const containerActiveTab = {};
const tabViewMap         = {};
let   _tabCounter        = 0;
function mkTabId() { return 'tb' + Date.now() + '_' + (++_tabCounter); }


function makeContainerId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}
function nextContainerName(list) {
  const n = Array.isArray(list) ? list.length + 1 : 1;
  return 'Facebook ' + String(n).padStart(2, '0');
}

function sendTabsState(activeCid) {
  if (!mainWin) return;

  // Row 1 — one "container anchor" tab per open container (type:'container')
  const ctrTabs = Object.keys(containerTabs)
    .filter(cid => containerTabs[cid] && containerTabs[cid].length > 0)
    .map(cid => {
      const first = containerTabs[cid][0];
      return { id: first.id, title: first.title || 'Facebook', url: first.url || '', containerId: cid, type: 'container' };
    });

  // Row 2 — extra normal tabs within the active container (index 1+, type:'tab')
  const nrmTabs = (activeCid ? (containerTabs[activeCid] || []).slice(1) : [])
    .map(t => ({ id: t.id, title: t.title || 'Facebook', url: t.url || '', containerId: activeCid, type: 'tab' }));

  mainWin.webContents.send('lp:tabsState', {
    tabs:        [...ctrTabs, ...nrmTabs],
    activeTabId: activeCid ? (containerActiveTab[activeCid] || null) : null,
  });
  // Persist currently open container-tab IDs so they can be restored after app restart.
  try {
    const openIds = Object.keys(containerTabs).filter(cid => containerTabs[cid] && containerTabs[cid].length > 0);
    store.set('openContainerTabIds', JSON.stringify(openIds));
    store.set('openContainerTabsSnapshot', JSON.stringify(openIds.map(cid => ({ id: cid, activeTabId: containerActiveTab[cid] || ((containerTabs[cid] || [])[0] || {}).id || '' }))));
    if (activeCid) store.set('lastActiveContainerId', activeCid);
  } catch (_) {}
}

function destroyContainerTabs(cid) {
  (containerTabs[cid] || []).forEach(t => {
    const v = tabViewMap[t.id];
    if (v) {
      try { mainWin && mainWin.removeBrowserView(v); } catch (_) {}
      try { v.webContents.destroy(); }                 catch (_) {}
      delete tabViewMap[t.id];
    }
  });
  delete containerTabs[cid];
  delete containerActiveTab[cid];
}

// Only these domains open IN the BrowserView; everything else → system browser
const META_HOSTS = [
  'facebook.com', 'fbcdn.net', 'fbsbx.com', 'fbpigeon.com',
  'connect.facebook.net', 'staticxx.facebook.com',
  'accountscenter.facebook.com', 'accounts.facebook.com',
  'graph.facebook.com', 'b-api.facebook.com',
  'edge-chat.facebook.com', 'mqtt-mini.facebook.com',
  'instagram.com', 'cdninstagram.com',
  'messenger.com', 'whatsapp.com',
  'oculus.com', 'workplace.com',
  'accounts.google.com',   // Google SSO login
  'login.live.com',        // Microsoft SSO
];

function isMetaHost(url) {
  if (!url) return false;
  try {
    const h = new URL(url).hostname;
    return META_HOSTS.some(m => h === m || h.endsWith('.' + m));
  } catch (_) { return false; }
}
function isHttp(url) {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
}
function isAccountCenter(url) {
  try { return new URL(url).hostname === 'accountscenter.facebook.com'; } catch(_) { return false; }
}

// ── Account Center — open in a dedicated child BrowserWindow ──────────────
// Account Center is a heavy React SPA that crashes inside BrowserView.
// A separate BrowserWindow gives it full browser capabilities.
function closeAccountCenterView() {
  if (!mainWin || !accountCenterView) return;
  try { mainWin.removeBrowserView(accountCenterView); } catch (_) {}
  try { accountCenterView.webContents.destroy(); } catch (_) {}
  accountCenterView = null;
  if (fbView) {
    try { mainWin.addBrowserView(fbView); stretchFbView(); } catch (_) {}
  }
}

// ── Account Center — embedded inside the app, never outside ───────────────
function openAccountCenter(containerId, initialUrl) {
  if (!mainWin) return;
  const ses = getSession(containerId || activeId);
  setupSession(ses, false, containerId || activeId);
  applyProxy(ses, containerId || activeId).catch(() => {});

  if (accountCenterView) {
    try {
      mainWin.addBrowserView(accountCenterView);
      stretchAccountCenterView();
      accountCenterView.webContents.loadURL(initialUrl || 'https://accountscenter.facebook.com/', {
        httpReferrer: 'https://www.facebook.com/',
      });
      return;
    } catch (_) { closeAccountCenterView(); }
  }

  accountCenterView = new BrowserView({
    webPreferences: {
      session: ses,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  mainWin.addBrowserView(accountCenterView);
  stretchAccountCenterView();
  const wc = accountCenterView.webContents;
  wc.setUserAgent(DESKTOP_UA);

  wc.loadURL(initialUrl || 'https://accountscenter.facebook.com/', {
    httpReferrer: 'https://www.facebook.com/',
  });

  wc.on('render-process-gone', (_e, details) => {
    console.error('AccountCenter renderer gone:', details.reason);
    try { wc.loadURL('https://accountscenter.facebook.com/'); } catch (_) {}
  });

  wc.on('will-navigate', (_e, url) => {
    if (!isHttp(url) && !url.startsWith('about:') && !url.startsWith('data:')) {
      _e.preventDefault();
    } else if (isHttp(url) && !isMetaHost(url)) {
      _e.preventDefault();
      shell.openExternal(url).catch(() => {});
    }
  });

  wc.setWindowOpenHandler(({ url }) => {
    if (isHttp(url) && isMetaHost(url)) {
      setImmediate(() => wc.loadURL(url));
    } else if (isHttp(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  wc.on('before-input-event', (_ev, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') closeAccountCenterView();
    if (input.type === 'keyDown' && (input.key === 'F5' || (input.control && input.key === 'r'))) wc.reload();
    if (input.type === 'keyDown' && input.alt && input.key === 'ArrowLeft' && wc.canGoBack()) wc.goBack();
    if (input.type === 'keyDown' && input.alt && input.key === 'ArrowRight' && wc.canGoForward()) wc.goForward();
  });

  wc.on('context-menu', (_e, p) => {
    const m = new Menu();
    if (p.selectionText || p.isEditable) {
      if (p.selectionText && p.isEditable) m.append(new MenuItem({ label: 'Cut', role: 'cut' }));
      if (p.selectionText) m.append(new MenuItem({ label: 'Copy', role: 'copy' }));
      if (p.isEditable) {
        m.append(new MenuItem({ label: 'Paste', role: 'paste' }));
        m.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
      }
      m.append(new MenuItem({ type: 'separator' }));
    }
    if (p.linkURL) {
      m.append(new MenuItem({ label: 'Open Link', click: () => wc.loadURL(p.linkURL) }));
      m.append(new MenuItem({ label: 'Copy Link URL', click: () => clipboard.writeText(p.linkURL) }));
      m.append(new MenuItem({ type: 'separator' }));
    }
    m.append(new MenuItem({ label: '← Back', enabled: wc.canGoBack(), click: () => wc.goBack() }));
    m.append(new MenuItem({ label: '→ Forward', enabled: wc.canGoForward(), click: () => wc.goForward() }));
    m.append(new MenuItem({ label: '⟳  Reload', click: () => wc.reload() }));
    m.append(new MenuItem({ type: 'separator' }));
    m.append(new MenuItem({ label: 'Close Account Center', click: () => closeAccountCenterView() }));
    m.popup({ window: mainWin });
  });
}

function stretchAccountCenterView() {
  if (!mainWin || !accountCenterView) return;
  const b = mainWin.getContentBounds();
  const top = VIEW_TOP;
  accountCenterView.setBounds({ x: 0, y: top, width: b.width, height: b.height - top });
}

// ── State ──────────────────────────────────────────────────────────────────
let mainWin        = null;
let fbView            = null;
let accountCenterView = null;
let _mobileZoomFactor = 1.0;
let activeId       = '';
let mobileMode     = false;
let _nrmTabVisible = false;   // is Row-2 (normal tabs) visible?
let _panelOpen     = false;   // is containers panel open?
let _containerCache = [];     // in-memory cache for instant panel open

// v10.6.12: one reliable tab-switch shortcut path for BrowserView + main UI.
// Visual order: Left/Up = previous, Right/Down = next.
let _lastPlainTabSwitchAt = 0;
function tabShortcutDirFromKey(key) {
  if (key === 'ArrowLeft' || key === 'ArrowUp') return -1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return 1;
  return 0;
}
function switchRelativeTabShortcut(dir) {
  const normalized = dir === -1 ? -1 : 1;
  const now = Date.now();
  // BrowserView before-input and injected-page keydown can both fire for one key press.
  // This guard prevents double switching while still allowing fast repeated presses.
  if (now - _lastPlainTabSwitchAt < 90) return;
  _lastPlainTabSwitchAt = now;
  switchRelativeTab(normalized);
}

// ══════════════════════════════════════════════════════════════════════════
//  Main window
// ══════════════════════════════════════════════════════════════════════════
function createWindow() {
  mainWin = new BrowserWindow({
    width:  1280, height: 840, minWidth: 360, minHeight: 300,
    frame:  false, titleBarStyle: 'hidden',
    backgroundColor: '#060912', title: 'Multi Plus',
    icon:   path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      nodeIntegration:  false,
      contextIsolation: true,
    },
  });
  mainWin.loadFile('index.html');

  // v10.6.12: plain arrow next/previous from the main window too.
  // This makes tab switching work without first clicking/hovering the tab bar.
  mainWin.webContents.on('before-input-event', (_ev, input) => {
    if (input.type !== 'keyDown') return;
    if (input.alt || input.control || input.meta || input.shift) return;
    const dir = tabShortcutDirFromKey(input.key);
    if (!dir || !activeId) return;
    _ev.preventDefault();
    switchRelativeTabShortcut(dir);
  });

  mainWin.on('resize',     () => { if (fbView) stretchFbView(); if (accountCenterView) stretchAccountCenterView(); });
  mainWin.on('maximize',   () => mainWin.webContents.send('lp:winState', 'maximized'));
  mainWin.on('unmaximize', () => mainWin.webContents.send('lp:winState', 'normal'));
  mainWin.on('closed',     () => { mainWin = null; });

  // ── Right-click context menu for all inputs in the main UI ────────────
  // Works on every textarea / text input inside index.html:
  //   Cookie import, 2FA key, Proxy fields, Rename, Container Proxy modal, etc.
  mainWin.webContents.on('context-menu', (_e, p) => {
    const m = new Menu();
    if (p.isEditable || p.selectionText) {
      if (p.isEditable && p.selectionText) {
        m.append(new MenuItem({
          label: 'Cut',
          accelerator: 'CmdOrCtrl+X',
          click: () => mainWin.webContents.cut(),
        }));
      }
      if (p.selectionText) {
        m.append(new MenuItem({
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          click: () => mainWin.webContents.copy(),
        }));
      }
      if (p.isEditable) {
        m.append(new MenuItem({
          label: 'Paste',
          accelerator: 'CmdOrCtrl+V',
          click: () => mainWin.webContents.paste(),
        }));
        m.append(new MenuItem({
          label: 'Paste and Match Style',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: () => mainWin.webContents.pasteAndMatchStyle(),
        }));
        m.append(new MenuItem({ type: 'separator' }));
        m.append(new MenuItem({
          label: 'Select All',
          accelerator: 'CmdOrCtrl+A',
          click: () => mainWin.webContents.selectAll(),
        }));
      }
      if (p.selectionText) {
        m.append(new MenuItem({ type: 'separator' }));
        m.append(new MenuItem({
          label: 'Copy to Clipboard',
          click: () => clipboard.writeText(p.selectionText),
        }));
      }
    } else {
      // Right-click on non-editable area
      m.append(new MenuItem({
        label: 'Select All',
        click: () => mainWin.webContents.selectAll(),
        enabled: false,
      }));
    }
    if (m.items.length) m.popup({ window: mainWin });
  });
}

function stretchFbView(view) {
  const v = view || fbView;
  if (!v || !mainWin) return;
  const b   = mainWin.getContentBounds();
  // Row-2 (normal tabs) pushes the BrowserView down so the tab bar is visible
  // Panel is now injected INSIDE the BrowserView — no horizontal resize needed
  const top = VIEW_TOP + (_nrmTabVisible ? TAB_BAR_H : 0);      // toolbar -> container tabs -> optional normal tabs -> page, no gap
  if (mobileMode) {
    // BrowserView width scales with _mobileZoomFactor so the scaled mobile
    // content (scale parameter in enableDeviceEmulation) has room to render
    const scaledW = Math.round(SAMSUNG_W * _mobileZoomFactor);
    const x = Math.max(0, Math.floor((b.width - scaledW) / 2));
    v.setBounds({ x, y: top, width: scaledW, height: b.height - top });
  } else {
    v.setBounds({ x: 0, y: top, width: b.width, height: b.height - top });
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  Session — Chrome-native UA injection (NO onBeforeSendHeaders hack)
// ══════════════════════════════════════════════════════════════════════════
function getSession(id) {
  return electronSession.fromPartition(`persist:mp_${id}`);
}

function setupSession(ses, useMobile, containerId) {
  ses.setUserAgent(useMobile ? MOBILE_UA : DESKTOP_UA);
  // NOTE: sec-ch-ua, sec-ch-ua-mobile, sec-ch-ua-platform are auto-generated
  // by Chromium from the UA string above — setExtraHTTPHeaders is NOT used
  // because adding them manually can create duplicate/conflicting headers that
  // cause Facebook's request validation to fail and break messaging.

  // Strip CSP / X-Frame-Options from HTML page responses only.
  // CRITICAL exclusions (must NEVER be intercepted):
  //   edge-chat.facebook.com  — Messenger WebSocket (101 upgrade)
  //   mqtt-mini.facebook.com  — Messenger MQTT WebSocket
  // Intercepting their 101 responses breaks real-time messaging.
  const cspFilter = { urls: [
    'https://www.facebook.com/*',
    'https://m.facebook.com/*',
    'https://l.facebook.com/*',
    'https://static.facebook.com/*',
    'https://staticxx.facebook.com/*',
    'https://fbsbx.com/*',
    'https://*.fbsbx.com/*',
    'https://connect.facebook.net/*',
    'https://graph.facebook.com/*',
    'https://b-api.facebook.com/*',
    'https://www.instagram.com/*',
    'https://www.messenger.com/*',
    // Account Center — needs CSP stripped to load embedded frames
    'https://accountscenter.facebook.com/*',
    'https://accounts.facebook.com/*',
  ]};

  ses.webRequest.onHeadersReceived(cspFilter, (details, callback) => {
    try {
      const h = Object.assign({}, details.responseHeaders || {});
      for (const k of Object.keys(h)) {
        const l = k.toLowerCase();
        if (l === 'content-security-policy' ||
            l === 'content-security-policy-report-only' ||
            l === 'x-frame-options') {
          delete h[k];
        }
      }
      callback({ responseHeaders: h });
    } catch (_) {
      callback({});
    }
  });

  // Proxy auth guard — suppresses the native blocking auth dialog when a
  // proxy sends 407.  Non-proxy server auth is left untouched (no call to
  // event.preventDefault there, so the normal auth flow continues).
  // Electron 29+: session 'login' event has 5 params:
  //   (event, webContents, authenticationResponseDetails, authInfo, callback)
  // Earlier code wrongly used 4 params — authInfo was actually the details
  // object {url:...}, so authInfo.isProxy was always undefined and
  // event.preventDefault() was never called → native dialog blocked the UI.
  ses.removeAllListeners('login');
  ses.on('login', (event, _wc, _details, authInfo, callback) => {
    if (!authInfo.isProxy) return; // server auth — let Electron handle it
    event.preventDefault();        // proxy 407 — suppress native dialog
    const perProxy    = containerId ? store.get(`proxy.container.${containerId}`) : null;
    const globalProxy = store.get('proxy.global');
    const proxy       = (perProxy && perProxy.host) ? perProxy
                      : ((globalProxy && globalProxy.host) ? globalProxy : null);
    callback(proxy && proxy.user ? proxy.user : '',
             proxy && proxy.pass ? proxy.pass : '');
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  PROXY ENGINE — Grok-style: setProxy + closeAllConnections + login event
// ══════════════════════════════════════════════════════════════════════════

// Strip URL scheme from proxy host string.
// e.g. "https://proxy.example.com" → "proxy.example.com"
function _cleanProxyHost(raw) {
  return (raw || '').trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^socks[45]:\/\//i, '')
    .split('/')[0]
    .split('?')[0];
}

// Build proxy rules string with credentials IN URL (pre-emptive auth).
// This is the Grok/GoLogin approach — credentials sent with first request,
// no waiting for 407 challenge. login event kept as fallback.
function _buildProxyRules(proxy) {
  if (!proxy || !proxy.host || !proxy.port) return 'direct://';
  const type   = (proxy.type || 'HTTP').toUpperCase();
  const host   = _cleanProxyHost(proxy.host);
  if (!host) return 'direct://';
  const port   = String(proxy.port).trim();
  const scheme = type === 'SOCKS5' ? 'socks5' : type === 'SOCKS4' ? 'socks4' : 'http';
  // Encode special chars in credentials
  const encUser = encodeURIComponent(proxy.user || '');
  const encPass = encodeURIComponent(proxy.pass || '');
  const auth    = (proxy.user && proxy.pass) ? `${encUser}:${encPass}@` : '';
  return `${scheme}://${auth}${host}:${port}`;
}

// Apply proxy to a session.
// KEY: credentials IN URL (pre-emptive auth) + closeAllConnections()
// This forces all existing connections to close and re-open through the proxy.
// login event in setupSession() handles any residual 407 challenges.
function applyProxy(ses, containerId) {
  const perProxy    = containerId ? store.get(`proxy.container.${containerId}`) : null;
  const globalProxy = store.get('proxy.global');
  const proxy       = (perProxy && perProxy.host) ? perProxy
                    : ((globalProxy && globalProxy.host) ? globalProxy : null);

  const rules = proxy && proxy.host ? _buildProxyRules(proxy) : 'direct://';

  return ses.setProxy({ proxyRules: rules })
    .then(() => {
      // CRITICAL: close all existing connections so they re-open through new proxy
      try { ses.closeAllConnections(); } catch (_) {}
    })
    .catch(() => {});
}

// ── Shared Proxy Test Engine ───────────────────────────────────────────────
// ALL IP-check URLs use https:// — forces CONNECT tunnel through proxy.
// Plain http:// was rejected by owlproxy (only supports CONNECT tunnels).
const PROXY_CHECK_APIS = [
  // Primary — ipwho.is: IP + city + country (HTTPS, no rate limit, no paid plan needed)
  { url: 'https://ipwho.is/',
    parse: (b) => {
      const d = JSON.parse(b);
      if (!d.success || !d.ip) throw new Error('ipwho: no-ok');
      const loc = [d.city, d.region, d.country].filter(Boolean).join(', ');
      return { ip: d.ip, loc: loc + (d.connection && d.connection.isp ? ' · ' + d.connection.isp : '') };
    }
  },
  // Fallback 1 — ipify: IP only (HTTPS, always works)
  { url: 'https://api.ipify.org/?format=json',
    parse: (b) => { const d = JSON.parse(b); if (!d.ip) throw new Error('ipify: no-ip'); return { ip: d.ip, loc: '' }; }
  },
  // Fallback 2 — freeipapi.com: IP + city + country (HTTPS)
  { url: 'https://freeipapi.com/api/json',
    parse: (b) => {
      const d = JSON.parse(b);
      if (!d.ipAddress) throw new Error('freeipapi: no-ip');
      const loc = [d.cityName, d.regionName, d.countryName].filter(Boolean).join(', ');
      return { ip: d.ipAddress, loc };
    }
  },
  // Fallback 3 — ip-api.com: IP + city + country + ISP (HTTPS free tier)
  { url: 'https://ip-api.com/json/?fields=status,query,city,regionName,country,isp',
    parse: (b) => {
      const d = JSON.parse(b);
      if (d.status !== 'success') throw new Error('ip-api: ' + (d.message || 'no-ok'));
      const loc = [d.city, d.regionName, d.country].filter(Boolean).join(', ');
      return { ip: d.query, loc: loc + (d.isp ? ' · ' + d.isp : '') };
    }
  },
  // Fallback 4 — amazonaws: plain text IP (HTTPS)
  { url: 'https://checkip.amazonaws.com/',
    parse: (b) => { const ip = (b||'').trim().split('\n')[0].trim(); if (!ip) throw new Error('aws: empty'); return { ip, loc: '' }; }
  },
];

// ── Chunked transfer encoding decoder ─────────────────────────────────────
// Some HTTP/1.1 proxy servers use chunked transfer encoding even when the
// client requests HTTP/1.0. Without decoding, JSON.parse fails and the
// country/location info is lost (falls back to ipify which has no loc).
function _decodeChunked(body) {
  // Fast path: if body doesn't start with a hex chunk-size line, return as-is
  if (!/^[0-9a-fA-F]+\r?\n/.test(body.trimStart())) return body;
  try {
    let result = '';
    let rest   = body;
    while (rest.length > 0) {
      // Find end of chunk-size line (may include chunk extensions after ";")
      const lineEnd = rest.search(/\r?\n/);
      if (lineEnd < 0) break;
      const chunkSizeHex = rest.substring(0, lineEnd).split(';')[0].trim();
      const chunkSize    = parseInt(chunkSizeHex, 16);
      if (isNaN(chunkSize) || chunkSize === 0) break;
      const dataStart = lineEnd + (rest[lineEnd] === '\r' ? 2 : 1);
      result += rest.substring(dataStart, dataStart + chunkSize);
      rest    = rest.substring(dataStart + chunkSize).replace(/^\r?\n/, '');
    }
    return result || body;
  } catch (_) { return body; }
}

// ── Raw proxy HTTP GET ─────────────────────────────────────────────────────
// Directly connects to the proxy via TCP and sends an HTTP/1.0 GET request
// with a Proxy-Authorization header. This COMPLETELY bypasses Electron's
// net.request / session proxy stack — the most reliable way to test a proxy
// regardless of Electron version quirks.
function _rawProxyGet(proxyHost, proxyPort, proxyUser, proxyPass, targetUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const _net2 = require('net');
    const _url2 = require('url');
    const parsed = _url2.parse(targetUrl);

    let settled = false;
    let tid = null;
    const done = (err, data) => {
      if (settled) return; settled = true;
      clearTimeout(tid);
      if (err) reject(err); else resolve(data);
    };

    const sock = _net2.connect(parseInt(proxyPort, 10), proxyHost.trim());
    tid = setTimeout(() => { sock.destroy(); done(new Error('Timeout'), null); }, timeoutMs || 14000);

    sock.on('connect', () => {
      let reqStr = `GET ${targetUrl} HTTP/1.0\r\n`;
      reqStr += `Host: ${parsed.host || parsed.hostname}\r\n`;
      reqStr += `User-Agent: Mozilla/5.0 (compatible; MultiPlus/10.1)\r\n`;
      reqStr += `Accept: application/json, text/plain, */*\r\n`;
      reqStr += `Accept-Encoding: identity\r\n`; // prevent gzip — raw TCP can't decompress
      reqStr += `Cache-Control: no-cache\r\n`;
      if (proxyUser) {
        const creds = Buffer.from(`${proxyUser}:${proxyPass || ''}`).toString('base64');
        reqStr += `Proxy-Authorization: Basic ${creds}\r\n`;
      }
      reqStr += `Connection: close\r\n\r\n`;
      sock.write(reqStr);
    });

    let raw = '';
    sock.on('data', (c) => { raw += c.toString(); });
    sock.on('end', () => {
      const statusLine = raw.split('\r\n')[0] || '';
      const sepIdx     = raw.indexOf('\r\n\r\n');
      const rawBody    = sepIdx >= 0 ? raw.substring(sepIdx + 4) : raw;
      // Decode chunked transfer encoding (some proxies use HTTP/1.1 chunked
      // even though we request HTTP/1.0 — without decoding, JSON.parse fails
      // and country/location data is lost as the fallback APIs have no loc)
      const body = _decodeChunked(rawBody);
      if (statusLine.includes(' 407'))             done(new Error('407 Proxy Auth Required'), null);
      else if (statusLine.match(/HTTP\/[\d.]+ [123]\d\d/)) done(null, body.trim());
      else                                          done(new Error('Proxy error: ' + statusLine.trim()), null);
    });
    sock.on('error', (e) => done(e, null));
  });
}

// ── Direct HTTP GET (no proxy) using Node.js http module ──────────────────
function _directHttpGet(targetUrl, timeoutMs) {
  return new Promise((resolve, reject) => {
    const _http2 = require('http');
    let settled = false;
    const done = (err, data) => { if (settled) return; settled = true; if (err) reject(err); else resolve(data); };
    try {
      const req = _http2.get(targetUrl, {
        timeout: timeoutMs || 14000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache' }
      }, (res) => {
        let body = '';
        res.on('data', c => { body += c.toString(); });
        res.on('end',  () => done(null, body));
        res.on('error', e => done(e, null));
      });
      req.on('error',   e => done(e, null));
      req.on('timeout', () => { req.destroy(); done(new Error('Timeout'), null); });
    } catch(e) { done(e, null); }
  });
}

// ── Electron-session-based IP check (best-effort) ────────────────────────
// Fires all PROXY_CHECK_APIS in parallel, returns first success.
// timeoutMs: how long to wait before giving up (default 10s).
// Does NOT call onDone with error if times out — just stops silently.
// Use _testHttpProxy() as the top-level entry point for HTTP proxies.
function _testViaSession(proxyRules, loginUser, loginPass, onDone, timeoutMs) {
  const { session: _eSes, net: _eNet } = require('electron');
  const tmpSes = _eSes.fromPartition(`temp:ipchk-${Date.now()}`, { cache: false });

  // Temporarily set global creds so app.on('login') uses test credentials.
  // app.on('login') fires BEFORE session.on('login') — it is the authoritative handler.
  const _prevUser = _gProxyUser, _prevPass = _gProxyPass;
  _gProxyUser = loginUser || '';
  _gProxyPass = loginPass || '';

  // session-level login as backup (in case app-level event doesn't fire)
  tmpSes.removeAllListeners('login');
  tmpSes.on('login', (ev, _wc, _det, ai, cb) => {
    ev.preventDefault();
    cb(ai.isProxy ? (loginUser||'') : '', ai.isProxy ? (loginPass||'') : '');
  });

  let settled = false;
  let failCnt = 0;
  const total = PROXY_CHECK_APIS.length;
  const ms    = timeoutMs || 10000;

  const _restoreGlobalCreds = () => {
    _gProxyUser = _prevUser;
    _gProxyPass = _prevPass;
  };

  const tmr = setTimeout(() => {
    if (!settled) { settled = true; _restoreGlobalCreds(); onDone(null); }
  }, ms);

  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(tmr);
    _restoreGlobalCreds();
    try { tmpSes.setProxy({ proxyRules: 'direct://' }).catch(() => {}); } catch(_) {}
    onDone(result);
  };

  tmpSes.setProxy({ proxyRules }).then(() => {
    // CRITICAL: close old connections so new ones go through the proxy
    try { tmpSes.closeAllConnections(); } catch (_) {}

    PROXY_CHECK_APIS.forEach((api) => {
      if (settled) return;
      let body = '';
      const req = _eNet.request({ url: api.url, session: tmpSes, useSessionCookies: false });
      req.setHeader('Accept-Encoding', 'identity');
      req.setHeader('Cache-Control', 'no-cache');
      req.on('response', (r) => {
        r.on('data', c => { body += c.toString(); });
        r.on('end', () => {
          if (settled) return;
          try {
            const rs = api.parse(body);
            finish({ ok: true, ip: rs.ip, loc: rs.loc || '' });
          } catch(_) {
            if (++failCnt >= total && !settled) finish(null);
          }
        });
        r.on('error', () => { if (++failCnt >= total && !settled) finish(null); });
      });
      req.on('error', () => { if (++failCnt >= total && !settled) finish(null); });
      req.end();
    });
  }).catch(() => { if (!settled) finish(null); });
}

// ── TCP CONNECT test directly to proxy (with manual auth header) ───────────
// GoLogin-style: direct CONNECT with Proxy-Authorization header.
// No SuperProxy layer needed.
function _connectViaProxy(host, port, user, pass, onDone) {
  const _net4 = require('net');
  let done = false;
  const finish = (r) => {
    if (done) return;
    done = true;
    clearTimeout(tmr);
    try { sock.destroy(); } catch(_) {}
    onDone(r);
  };

  const sock = _net4.connect(parseInt(port, 10), host.trim());
  const tmr = setTimeout(() => {
    finish({ ok: false, error: 'Proxy server unreachable or not responding — check host/port' });
  }, 15000);

  sock.on('error', (e) => {
    const msg = e.message || '';
    if (msg.includes('ECONNREFUSED')) {
      finish({ ok: false, error: 'Connection refused — proxy server not running on ' + host + ':' + port });
    } else if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
      finish({ ok: false, error: 'Host not found — check proxy hostname: ' + host });
    } else {
      finish({ ok: false, error: 'Cannot reach proxy: ' + msg });
    }
  });

  sock.once('connect', () => {
    const authVal = (user && pass)
      ? 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64')
      : '';
    let req = `CONNECT google.com:443 HTTP/1.1\r\nHost: google.com:443\r\n`;
    if (authVal) req += `Proxy-Authorization: ${authVal}\r\n`;
    req += '\r\n';
    sock.write(req);

    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString();
      if (!buf.includes('\r\n\r\n')) return;
      const line = (buf.split('\r\n')[0] || '').trim();
      if (line.includes(' 200')) {
        finish({ ok: true, loc: '✓ Proxy Connected (CONNECT tunnel verified)' });
      } else if (line.includes(' 407')) {
        finish({ ok: false, error: 'Proxy auth failed (407) — wrong username or password' });
      } else {
        finish({ ok: false, error: 'Proxy error: ' + line });
      }
    });
  });
}

// ── Node.js HTTP-GET-through-proxy test ───────────────────────────────────
// Sends a plain HTTP GET to api.ipify.org VIA the proxy using raw TCP.
// This is the most reliable HTTP proxy test — no Chromium, no TLS, no CONNECT.
// Proxy-Authorization header is sent in the first GET request (pre-emptive).
// Works with OwlProxy, BrightData, and any standard HTTP proxy.
function _testViaNodeHttp(proxyHost, proxyPort, user, pass, onDone) {
  const _net5 = require('net');
  const authB64 = (user && pass)
    ? Buffer.from(`${user}:${pass}`).toString('base64')
    : '';

  // Try multiple plain-HTTP IP-check APIs
  const httpApis = [
    { host: 'api.ipify.org', path: '/?format=json',
      parse: (b) => { const d = JSON.parse(b); if (!d.ip) throw new Error('no ip'); return { ip: d.ip, loc: '' }; } },
    { host: 'ip-api.com', path: '/json/?fields=status,query,city,regionName,country,isp',
      parse: (b) => { const d = JSON.parse(b); if (d.status !== 'success') throw new Error('no-ok'); return { ip: d.query, loc: [d.city, d.regionName, d.country].filter(Boolean).join(', ') + (d.isp ? ' · '+d.isp : '') }; } },
    { host: 'ipwho.is', path: '/',
      parse: (b) => { const d = JSON.parse(b); if (!d.success || !d.ip) throw new Error('no ip'); return { ip: d.ip, loc: [d.city, d.region, d.country].filter(Boolean).join(', ') }; } },
  ];

  let done  = false;
  const finish = (r) => { if (done) return; done = true; clearTimeout(masterTmr); onDone(r); };

  // Master timeout: 18 seconds total
  const masterTmr = setTimeout(() => {
    finish({ ok: false, error: 'Proxy test timed out — check host/port/credentials' });
  }, 18000);

  function tryApi(idx) {
    if (done || idx >= httpApis.length) {
      if (!done) finish({ ok: false, error: 'All proxy test APIs failed — proxy may block outbound requests' });
      return;
    }
    const api = httpApis[idx];
    let buf = '';
    let connected = false;

    const sock = _net5.connect(parseInt(proxyPort, 10), proxyHost.trim());
    const sockTmr = setTimeout(() => {
      try { sock.destroy(); } catch(_) {}
      if (!connected) tryApi(idx + 1); // try next API on timeout
    }, 12000);

    sock.on('error', (e) => {
      clearTimeout(sockTmr);
      try { sock.destroy(); } catch(_) {}
      const msg = e.message || '';
      if (msg.includes('ENOTFOUND') || msg.includes('getaddrinfo')) {
        finish({ ok: false, error: 'Host not found — check proxy hostname: ' + proxyHost });
      } else if (msg.includes('ECONNREFUSED')) {
        finish({ ok: false, error: 'Connection refused — check port: ' + proxyPort });
      } else {
        tryApi(idx + 1);
      }
    });

    sock.once('connect', () => {
      connected = true;
      let req = `GET http://${api.host}${api.path} HTTP/1.1\r\n`;
      req += `Host: ${api.host}\r\n`;
      if (authB64) req += `Proxy-Authorization: Basic ${authB64}\r\n`;
      req += `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0\r\n`;
      req += `Accept: */*\r\nConnection: close\r\n\r\n`;
      sock.write(req);

      sock.on('data', (chunk) => { buf += chunk.toString(); });
      sock.on('end', () => {
        clearTimeout(sockTmr);
        try { sock.destroy(); } catch(_) {}
        if (done) return;
        // Parse status line
        const firstLine = (buf.split('\r\n')[0] || '').trim();
        if (firstLine.includes(' 407')) {
          finish({ ok: false, error: 'Proxy authentication failed (407) — check username/password' });
          return;
        }
        if (!firstLine.includes(' 200') && !firstLine.includes(' 2')) {
          tryApi(idx + 1);
          return;
        }
        // Extract body (after \r\n\r\n)
        const bodyStart = buf.indexOf('\r\n\r\n');
        const body = bodyStart >= 0 ? buf.slice(bodyStart + 4) : buf;
        try {
          const rs = api.parse(body.trim());
          finish({ ok: true, ip: rs.ip, loc: rs.loc || '' });
        } catch(_) {
          tryApi(idx + 1);
        }
      });
      sock.on('error', () => { clearTimeout(sockTmr); tryApi(idx + 1); });
    });
  }

  tryApi(0);
}

// ── Combined HTTP proxy test ───────────────────────────────────────────────
// PRIMARY:  Node.js direct HTTP GET through proxy (most reliable, no Chromium)
// FALLBACK: Electron session (catches proxies that only support HTTPS/CONNECT)
// LAST:     Raw TCP CONNECT (gives specific error: auth fail vs unreachable)
function _testHttpProxy(proxyHost, proxyPort, user, pass, _unusedRules, onDone) {
  let sent = false;
  const sendOnce = (r) => { if (sent) return; sent = true; onDone(r); };

  // Phase 1: Direct Node.js HTTP GET through proxy (fastest, most reliable)
  _testViaNodeHttp(proxyHost, proxyPort, user, pass, (nodeResult) => {
    if (nodeResult && nodeResult.ok) {
      sendOnce(nodeResult);
      return;
    }

    // Phase 2: Electron session (for proxies requiring HTTPS/CONNECT tunnels only)
    const encU = encodeURIComponent(user || '');
    const encP = encodeURIComponent(pass || '');
    const auth  = (user && pass) ? `${encU}:${encP}@` : '';
    const rulesWithCreds = `http://${auth}${proxyHost}:${proxyPort}`;

    _testViaSession(rulesWithCreds, user, pass, (sesResult) => {
      if (sesResult && sesResult.ok) {
        sendOnce(sesResult);
        return;
      }

      // Phase 3: Raw TCP CONNECT — gives specific error (auth fail, unreachable, etc.)
      _connectViaProxy(proxyHost, proxyPort, user, pass, (connResult) => {
        if (sent) return;
        if (connResult && connResult.ok) {
          sendOnce({ ok: true, ip: '(hidden)', loc: '✓ Proxy tunnel OK — IP check blocked by proxy policy' });
        } else {
          // If nodeResult has a more specific error, prefer it
          sendOnce(nodeResult && nodeResult.error ? nodeResult : (connResult || { ok: false, error: 'Proxy connection failed' }));
        }
      });
    }, 15000);
  });

  // Hard timeout: 40 seconds total
  setTimeout(() => sendOnce({ ok: false, error: 'Proxy test timed out (40s) — server may be slow or unreachable' }), 40000);
}

// ── Shared Proxy Test Engine (legacy — kept for SOCKS+direct fallback) ────
// `_ses` and `restoreFn` kept for API compatibility.
function _doProxyTest(_ses, proxyRules, loginUser, loginPass, onDone, restoreFn) {
  const isDirect = !proxyRules || proxyRules === 'direct://';
  const isSocks  = !isDirect && /^socks[45]:\/\//i.test(proxyRules || '');

  // Extract bare host:port (strip credentials from URL before matching)
  let proxyHost = '', proxyPort = '';
  if (!isDirect) {
    const m = proxyRules.match(/^(?:https?|socks[45]):\/\/(?:[^@]+@)?([^:/]+):(\d+)/i);
    if (m) { proxyHost = m[1].trim(); proxyPort = m[2].trim(); }
  }

  let finished = false;
  const done = (result) => {
    if (finished) return;
    finished = true;
    onDone(result);
    if (restoreFn) restoreFn();
  };

  // ── SOCKS proxy: use temporary Electron session (native SOCKS support) ──
  if (isSocks && proxyHost) {
    const { session: _eSes, net: _eNet } = require('electron');
    const tmpSes = _eSes.fromPartition(`temp:socks-${Date.now()}`, { cache: false });
    const tmr    = setTimeout(() => done({ ok: false, error: 'SOCKS proxy timeout (14s)' }), 14000);
    tmpSes.removeAllListeners('login');
    // Electron 29+: 5-param signature (event, wc, details, authInfo, callback)
    tmpSes.on('login', (ev, _w, _det, ai, cb) => {
      ev.preventDefault();
      cb(ai.isProxy ? (loginUser||'') : '', ai.isProxy ? (loginPass||'') : '');
    });
    tmpSes.setProxy({ proxyRules }).then(() => {
      if (finished) return;
      // Try all APIs in parallel through the SOCKS session
      let socksDone = false;
      let socksFailCount = 0;
      PROXY_CHECK_APIS.forEach((api, idx) => {
        if (finished || socksDone) return;
        const req = _eNet.request({ url: api.url, session: tmpSes });
        req.setHeader('Accept-Encoding', 'identity');
        let body = '';
        req.on('response', (r) => {
          r.on('data', c => { body += c.toString(); });
          r.on('end', () => {
            if (finished || socksDone) return;
            try {
              const rs = api.parse(body);
              socksDone = true;
              clearTimeout(tmr);
              done({ ok: true, ip: rs.ip, loc: rs.loc||'' });
              try { tmpSes.setProxy({ proxyRules: 'direct://' }).catch(()=>{}); } catch(_) {}
            } catch(_) {
              socksFailCount++;
              if (!finished && !socksDone && socksFailCount >= PROXY_CHECK_APIS.length) {
                clearTimeout(tmr);
                done({ ok: false, error: 'SOCKS: bad response from all services' });
              }
            }
          });
          r.on('error', () => {
            socksFailCount++;
            if (!finished && !socksDone && socksFailCount >= PROXY_CHECK_APIS.length) {
              clearTimeout(tmr); done({ ok: false, error: 'SOCKS response error' });
            }
          });
        });
        req.on('error', e => {
          socksFailCount++;
          if (!finished && !socksDone && socksFailCount >= PROXY_CHECK_APIS.length) {
            clearTimeout(tmr); done({ ok: false, error: 'SOCKS: ' + e.message });
          }
        });
        req.end();
      });
    }).catch(e => { clearTimeout(tmr); done({ ok: false, error: 'SOCKS setup: ' + e.message }); });
    return;
  }

  // ── HTTP proxy / direct: ALL APIs in parallel — first success wins ───────
  // Parallel strategy: rotating proxies sometimes block specific IP-check sites,
  // so racing all APIs simultaneously guarantees we get a result from whichever
  // endpoint the proxy CAN reach, rather than waiting 14s×N for each serial fail.
  if (finished) return;

  let parallelDone = false;
  let failCount    = 0;
  const total      = PROXY_CHECK_APIS.length;

  PROXY_CHECK_APIS.forEach((api, idx) => {
    if (finished) return;

    const fetcher = (isDirect || !proxyHost)
      ? _directHttpGet(api.url, 12000)
      : _rawProxyGet(proxyHost, proxyPort, loginUser, loginPass, api.url, 12000);

    fetcher
      .then(body => {
        if (finished || parallelDone) return;
        const result = api.parse(body);
        // Prefer results with location info — keep racing if this one has no loc
        if (!parallelDone || (result.loc && result.loc.length > 0)) {
          parallelDone = true;
          done({ ok: true, ip: result.ip, loc: result.loc || '' });
        }
      })
      .catch(err => {
        console.warn(`[ProxyTest] API ${idx} (${api.url}) failed: ${err.message}`);
        failCount++;
        if (!finished && !parallelDone && failCount >= total) {
          done({ ok: false, error: 'All IP check services failed — check proxy host/port' });
        }
      });
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  Tab View Factory — creates + wires a BrowserView for one tab
// ══════════════════════════════════════════════════════════════════════════
function makeTabView(containerId, tabId) {
  const ses = getSession(containerId);
  const view = new BrowserView({
    webPreferences: {
      session:              ses,
      preload:              path.join(__dirname, 'fb-preload.js'),
      nodeIntegration:      false,
      contextIsolation:     true,
      backgroundThrottling: false,
      webgl:                true,
      spellcheck:           true,
    },
  });
  const wc = view.webContents;

  // ── Navigation ──────────────────────────────────────────────────────
  wc.on('will-navigate', (_e, url) => {
    if (isAccountCenter(url)) { _e.preventDefault(); openAccountCenter(containerId, url); return; }
    if (!isHttp(url) && !url.startsWith('about:') && !url.startsWith('data:')) { _e.preventDefault(); }
    else if (isHttp(url) && !isMetaHost(url)) { _e.preventDefault(); shell.openExternal(url).catch(() => {}); }
  });

  wc.setWindowOpenHandler(({ url }) => {
    if (isAccountCenter(url)) { setImmediate(() => openAccountCenter(containerId, url)); return { action: 'deny' }; }
    if (isHttp(url)) {
      if (isMetaHost(url)) setImmediate(() => openNewTab(containerId, url));
      else shell.openExternal(url).catch(() => {});
    }
    return { action: 'deny' };
  });

  // ── Right-click context menu ─────────────────────────────────────────
  wc.on('context-menu', (_e, p) => {
    const m = new Menu();
    if (p.selectionText || p.isEditable) {
      if (p.selectionText && p.isEditable) m.append(new MenuItem({ label: 'Cut',        role: 'cut' }));
      if (p.selectionText)                 m.append(new MenuItem({ label: 'Copy',       role: 'copy' }));
      if (p.isEditable) {
        m.append(new MenuItem({ label: 'Paste',      role: 'paste' }));
        m.append(new MenuItem({ label: 'Select All', role: 'selectAll' }));
      }
      m.append(new MenuItem({ type: 'separator' }));
    }
    if (p.linkURL) {
      m.append(new MenuItem({ label: '✨ Open Link in New Tab', click: () => openNewTab(containerId, p.linkURL) }));
      m.append(new MenuItem({ label: 'Open Link Here', click: () => wc.loadURL(p.linkURL) }));
      m.append(new MenuItem({ label: 'Copy Link URL', click: () => clipboard.writeText(p.linkURL) }));
      m.append(new MenuItem({ type: 'separator' }));
    }
    if (p.mediaType === 'image' && p.srcURL) {
      m.append(new MenuItem({ label: 'Save Image As…', click: () => wc.downloadURL(p.srcURL) }));
      m.append(new MenuItem({ label: 'Copy Image',     click: () => wc.copyImageAt(p.x, p.y) }));
      m.append(new MenuItem({ type: 'separator' }));
    }
    m.append(new MenuItem({ label: '← Back',    enabled: wc.canGoBack(),    click: () => wc.goBack() }));
    m.append(new MenuItem({ label: '→ Forward',  enabled: wc.canGoForward(), click: () => wc.goForward() }));
    m.append(new MenuItem({ label: '⟳  Reload',                              click: () => wc.reload() }));
    m.append(new MenuItem({ label: '+ New Tab',  click: () => openNewTab(containerId) }));
    m.append(new MenuItem({ type: 'separator' }));
    m.append(new MenuItem({ label: '🏠 Home Screen', click: () => closeView(true) }));
    m.append(new MenuItem({ label: '🍪 Copy Cookies', click: async () => {
      const ck = await exportLongCookies(containerId); if (ck) clipboard.writeText(ck);
    }}));
    m.popup({ window: mainWin });
  });

  // ── Anti-detect + inject ─────────────────────────────────────────────
  const injectSrc = fs.readFileSync(path.join(__dirname, 'inject.js'), 'utf8');
  wc.on('did-start-loading', async () => { try { await wc.executeJavaScript(ANTI_DETECT_SCRIPT); } catch (_) {} });
  wc.on('did-finish-load',   async () => {
    // Re-apply mobile device emulation BEFORE injecting scripts
    // (navigation can reset deviceEmulation; must restore here with current zoom)
    if (mobileMode) {
      _applyMobileEmulation(wc, _mobileZoomFactor);
      // Inject mouse→touch swipe simulation so user can drag to scroll
      try { await wc.executeJavaScript(MOUSE_TO_TOUCH_SCRIPT); } catch (_) {}
    }
    try { await wc.executeJavaScript(ANTI_DETECT_SCRIPT); } catch (_) {}
    try { await wc.executeJavaScript(injectSrc); }         catch (_) {}
    sendNav(wc);
  });
  wc.on('did-navigate',         () => sendNav(wc));
  wc.on('did-navigate-in-page', () => sendNav(wc));
  wc.on('did-fail-load', (_e, code) => { if (code !== -3) console.warn('load-fail:', code); });

  // ── Tab title / URL tracking ─────────────────────────────────────────
  wc.on('page-title-updated', (_e, title) => {
    const tab = (containerTabs[containerId] || []).find(t => t.id === tabId);
    if (tab) { tab.title = title || 'Facebook'; sendTabsState(containerId); }
  });
  wc.on('did-navigate', (_e, url) => {
    const tab = (containerTabs[containerId] || []).find(t => t.id === tabId);
    if (tab) { tab.url = url; }
  });

  // ── Crash recovery ───────────────────────────────────────────────────
  wc.on('render-process-gone', async (_e, d) => {
    console.error('Renderer gone:', d.reason);
    try { await wc.loadURL(FB_HOME); } catch (_) { closeView(true); }
  });

  // ── Keyboard shortcuts ───────────────────────────────────────────────
  wc.on('before-input-event', (_ev, input) => {
    if (input.type !== 'keyDown') return;

    // v10.6.12: plain arrow keys switch tabs from anywhere inside Facebook BrowserView.
    // This does not depend on hovering/clicking the tab bar.
    const plainArrowDir = (!input.alt && !input.control && !input.meta && !input.shift) ? tabShortcutDirFromKey(input.key) : 0;
    if (plainArrowDir) {
      _ev.preventDefault();
      switchRelativeTabShortcut(plainArrowDir);
      return;
    }

    if (input.alt && input.key === 'ArrowLeft'  && wc.canGoBack())    wc.goBack();
    if (input.alt && input.key === 'ArrowRight' && wc.canGoForward()) wc.goForward();
    if ((input.control || input.meta) && input.shift && input.key && input.key.toLowerCase && input.key.toLowerCase() === 'r') { _ev.preventDefault(); restoreOpenContainerTabs(); return; }
    if (input.key === 'F5' || (input.control && input.key === 'r'))   wc.reload();
    if ((input.control || input.meta) && input.key === 'Tab') { _ev.preventDefault(); switchRelativeTab(input.shift ? -1 : 1); }
    if (input.alt && (input.key === 'ArrowUp' || input.key === 'ArrowLeft')) { _ev.preventDefault(); switchRelativeTab(-1); }
    if (input.alt && (input.key === 'ArrowDown' || input.key === 'ArrowRight')) { _ev.preventDefault(); switchRelativeTab(1); }
    if ((input.control || input.meta) && input.key.toLowerCase && input.key.toLowerCase() === 'w') { _ev.preventDefault(); closeActiveTab(); }
    if ((input.control || input.meta) && input.key.toLowerCase && input.key.toLowerCase() === 't') { _ev.preventDefault(); openNewTab(containerId); }
  });

  tabViewMap[tabId] = view;
  return view;
}

// ══════════════════════════════════════════════════════════════════════════
//  Open / restore a container — tab-aware
// ══════════════════════════════════════════════════════════════════════════
function openFacebookView(containerId, cookieStr) {
  if (!mainWin) return;
  mobileMode = false;
  _panelOpen = false;

  // Hide whatever is currently showing
  (mainWin.getBrowserViews() || []).forEach(v => { try { mainWin.removeBrowserView(v); } catch (_) {} });

  activeId = containerId;
  const ses = getSession(containerId);
  setupSession(ses, false, containerId);

  // ── Restore existing tabs ──────────────────────────────────────────
  if (containerTabs[containerId] && containerTabs[containerId].length > 0) {
    const tabId = containerActiveTab[containerId] || containerTabs[containerId][0].id;
    fbView = tabViewMap[tabId] || null;
    if (fbView) {
      containerActiveTab[containerId] = tabId;
      mainWin.addBrowserView(fbView);
      stretchFbView();
      // Apply proxy THEN send opened signal — proxy is already set for existing view
      applyProxy(ses, containerId).catch(() => {});
      mainWin.webContents.send('lp:fbOpened', { id: containerId });
      sendTabsState(containerId);
      sendNav(fbView.webContents);
      return;
    }
  }

  // ── First open → create tab 1 ──────────────────────────────────────
  const tabId = mkTabId();
  containerTabs[containerId]      = [{ id: tabId, title: 'Facebook', url: FB_HOME }];
  containerActiveTab[containerId] = tabId;

  fbView = makeTabView(containerId, tabId);
  const thisView = fbView; // important for restore loops: each container keeps its own BrowserView
  mainWin.addBrowserView(thisView);
  stretchFbView(thisView);

  mainWin.webContents.send('lp:fbOpened', { id: containerId });
  sendTabsState(containerId);

  // GoLogin-style: await setProxy before loadURL — ensures proxy is active
  // for the very first network request. Use thisView, not global fbView,
  // otherwise restoring multiple containers can load only the last tab.
  applyProxy(ses, containerId).then(() => {
    if (!thisView || thisView.webContents.isDestroyed()) return;
    if (cookieStr) {
      importCookies(ses, cookieStr)
        .then(() => !thisView.webContents.isDestroyed() && thisView.webContents.loadURL(FB_HOME))
        .catch(()  => !thisView.webContents.isDestroyed() && thisView.webContents.loadURL(FB_HOME));
    } else {
      thisView.webContents.loadURL(FB_HOME);
    }
  }).catch(() => {
    if (thisView && !thisView.webContents.isDestroyed()) thisView.webContents.loadURL(FB_HOME);
  });
}

// ══════════════════════════════════════════════════════════════════════════
//  Open a new tab in the given container (called from context-menu too)
// ══════════════════════════════════════════════════════════════════════════
function openNewTab(containerId, startUrl = FB_HOME) {
  if (!mainWin || !containerId) return null;
  const tabId = mkTabId();
  if (!containerTabs[containerId]) containerTabs[containerId] = [];
  containerTabs[containerId].push({ id: tabId, title: 'Facebook', url: startUrl || FB_HOME });

  makeTabView(containerId, tabId);

  // Switch to the new tab
  (mainWin.getBrowserViews() || []).forEach(v => { try { mainWin.removeBrowserView(v); } catch (_) {} });
  containerActiveTab[containerId] = tabId;
  fbView = tabViewMap[tabId];
  mainWin.addBrowserView(fbView);
  stretchFbView();
  fbView.webContents.loadURL(startUrl || FB_HOME);
  sendTabsState(containerId);
  return tabId;
}

function sendNav(wc) {
  try {
    mainWin && mainWin.webContents.send('lp:fbNav', {
      url: wc.getURL(), title: wc.getTitle(),
      canBack: wc.canGoBack(), canFwd: wc.canGoForward(),
    });
  } catch (_) {}
}

function closeView(sendHomeEvent = true) {
  if (accountCenterView) { try { accountCenterView.webContents.destroy(); } catch(_) {} accountCenterView = null; }
  // Hide all BrowserViews but keep tab views alive (tabs persist when going home)
  if (mainWin) {
    (mainWin.getBrowserViews() || []).forEach(v => { try { mainWin.removeBrowserView(v); } catch (_) {} });
  }
  fbView         = null;
  mobileMode     = false;
  _nrmTabVisible = false;
  _panelOpen     = false;
  if (sendHomeEvent) mainWin && mainWin.webContents.send('lp:onHome');
}

// ══════════════════════════════════════════════════════════════════════════
//  Cookie helpers
// ══════════════════════════════════════════════════════════════════════════
const FAR = () => Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 400;

async function importCookies(ses, cookieStr) {
  if (!cookieStr) return;
  const domains = ['www.facebook.com', 'm.facebook.com', 'mbasic.facebook.com', '.facebook.com',
                   'accountscenter.facebook.com'];
  const pairs   = cookieStr.split(';').map(s => s.trim()).filter(Boolean);
  const tasks   = [];
  for (const domain of domains) {
    for (const pair of pairs) {
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      tasks.push(ses.cookies.set({
        url:            `https://${domain.replace(/^\./, '')}`,
        name:           pair.substring(0, eq).trim(),
        value:          pair.substring(eq + 1).trim(),
        domain, secure: true, httpOnly: false,
        sameSite: 'no_restriction', expirationDate: FAR(),
      }).catch(() => {}));
    }
  }
  await Promise.all(tasks);
  await ses.cookies.flushStore().catch(() => {});
}

async function exportLongCookies(containerId) {
  const ESSENTIAL = ['datr','sb','c_user','xs'];
  const ses = getSession(containerId || activeId);
  try {
    const sources = [
      await ses.cookies.get({ url: 'https://www.facebook.com' }).catch(() => []),
      await ses.cookies.get({ url: 'https://m.facebook.com' }).catch(() => []),
      await ses.cookies.get({ url: 'https://mbasic.facebook.com' }).catch(() => []),
      await ses.cookies.get({ domain: '.facebook.com' }).catch(() => []),
      await ses.cookies.get({ domain: 'facebook.com' }).catch(() => []),
      await ses.cookies.get({ domain: '.messenger.com' }).catch(() => [])
    ];
    const rawCookies = sources.flat().filter(c => c && c.name && c.value !== undefined);

    // Unique by cookie name for clean "name=value; name=value" output.
    // Essential cookies stay first; the rest make the output longer and complete.
    const byName = new Map();
    for (const c of rawCookies) {
      if (!byName.has(c.name)) byName.set(c.name, c);
    }
    const cookies = Array.from(byName.values()).sort((a, b) => {
      const ai = ESSENTIAL.indexOf(a.name), bi = ESSENTIAL.indexOf(b.name);
      if (ai !== -1 && bi === -1) return -1;
      if (bi !== -1 && ai === -1) return  1;
      if (ai !== -1 && bi !== -1) return ai - bi;
      return a.name.localeCompare(b.name);
    });

    // Renew cookies only for Facebook domains; avoid doing more work than needed.
    const domains = ['.facebook.com','www.facebook.com','m.facebook.com','mbasic.facebook.com'];
    const renewTasks = [];
    for (const c of cookies) {
      for (const dom of domains) {
        renewTasks.push(ses.cookies.set({
          url: `https://${dom.replace(/^\./, '')}`,
          name: c.name,
          value: c.value,
          domain: dom,
          path: c.path || '/',
          secure: true,
          httpOnly: !!c.httpOnly,
          sameSite: 'no_restriction',
          expirationDate: FAR(),
        }).catch(() => {}));
      }
    }
    await Promise.all(renewTasks);
    await ses.cookies.flushStore().catch(() => {});

    return cookies.map(c => `${c.name}=${c.value}`).join('; ');
  } catch (_) { return ''; }
}

// ══════════════════════════════════════════════════════════════════════════
//  IPC Handlers
// ══════════════════════════════════════════════════════════════════════════

// ── View layout (called when Row-2 or Container Panel visibility changes) ──
ipcMain.on('lp:viewLayout', (_e, { nrmVisible, panelOpen }) => {
  _nrmTabVisible = !!nrmVisible;
  _panelOpen     = !!panelOpen;
  stretchFbView();
});

// ── Window ────────────────────────────────────────────────────────────────
ipcMain.on('lp:minimize', () => mainWin && mainWin.minimize());
ipcMain.on('lp:maximize', () => { if (!mainWin) return; mainWin.isMaximized() ? mainWin.unmaximize() : mainWin.maximize(); });
ipcMain.on('lp:close',    () => mainWin && mainWin.close());

// ── FB navigation ─────────────────────────────────────────────────────────
ipcMain.on('lp:fbGoBack',    () => fbView && fbView.webContents.canGoBack()    && fbView.webContents.goBack());
ipcMain.on('lp:fbGoForward', () => fbView && fbView.webContents.canGoForward() && fbView.webContents.goForward());
ipcMain.on('lp:fbReload',    () => fbView && fbView.webContents.reload());
ipcMain.on('lp:fbLoadUrl',   (_e, { url }) => { if (fbView && isHttp(url)) fbView.webContents.loadURL(url); });

// ── Mobile simulator ──────────────────────────────────────────────────────
ipcMain.on('lp:toggleMobileMode', (e) => {
  if (!fbView) { e.returnValue = false; return; }
  mobileMode = !mobileMode;
  const wc  = fbView.webContents;
  const ses = wc.session;

  // Set UA at BOTH session-level and webContents-level.
  // Session-level alone is not enough — webContents caches its own UA and
  // a simple reload() sends the OLD UA for the first request.
  ses.setUserAgent(mobileMode ? MOBILE_UA : DESKTOP_UA);
  try { wc.setUserAgent(mobileMode ? MOBILE_UA : DESKTOP_UA); } catch(_) {}
  if (typeof ses.setExtraHTTPHeaders === 'function') {
    ses.setExtraHTTPHeaders(mobileMode ? MOBILE_EXTRA_HEADERS : DESKTOP_EXTRA_HEADERS);
  }

  if (mobileMode) {
    _mobileZoomFactor = 1.0;
    _applyMobileEmulation(wc, 1.0);
    stretchFbView();
    // Navigate to m.facebook.com — mobile UA + emulation → correct mobile site
    wc.loadURL(FB_MOBILE);
  } else {
    _mobileZoomFactor = 1.0;
    wc.disableDeviceEmulation();
    try { wc.setZoomFactor(1.0); } catch(_) {}
    stretchFbView();
    // MUST navigate to www.facebook.com, not wc.reload().
    // reload() reloads the current URL (often m.facebook.com) — with a desktop
    // UA, m.facebook.com would still render mobile layout. Going to FB_HOME
    // guarantees the desktop site is served.
    wc.loadURL(FB_HOME);
  }
  e.returnValue = mobileMode;
});

// Helper — Samsung S24 Ultra device emulation + browser zoom
// viewSize is always fixed at SAMSUNG_W × SAMSUNG_H so that:
//   zoom > 1  → content is bigger (zoom in, text larger, need to scroll)
//   zoom < 1  → content is smaller (zoom out, more visible)
function _applyMobileEmulation(wc, zoomFactor) {
  const z = Math.max(0.5, Math.min(2.0, zoomFactor || 1.0));
  try {
    wc.enableDeviceEmulation({
      screenPosition:    'mobile',
      screenSize:        { width: SAMSUNG_W, height: SAMSUNG_H },
      viewPosition:      { x: 0, y: 0 },
      viewSize:          { width: SAMSUNG_W, height: SAMSUNG_H },
      deviceScaleFactor: SAMSUNG_DPR,
      scale:             z,   // ← scale=z visually enlarges/shrinks the whole screen
    });
    wc.setZoomFactor(1.0);    // always 1.0 — scale handles visual zoom, not setZoomFactor
  } catch(_) {}
}

ipcMain.on('lp:getMobileMode', (e) => { e.returnValue = mobileMode; });

ipcMain.on('lp:setMobileZoom', (e, { factor }) => {
  _mobileZoomFactor = Math.max(0.5, Math.min(2.0, parseFloat(factor) || 1.0));
  if (fbView) {
    // Re-apply device emulation with new scale value (doesn't reset the page)
    try { _applyMobileEmulation(fbView.webContents, _mobileZoomFactor); } catch(_) {}
    // Resize BrowserView to match scaled width so content isn't clipped
    stretchFbView();
    // Tell renderer the new factor (phone frame width update etc.)
    mainWin && mainWin.webContents.send('lp:mobileZoomUpdated', { factor: _mobileZoomFactor });
  }
  e.returnValue = _mobileZoomFactor;
});
ipcMain.on('lp:getMobileZoom', (e) => { e.returnValue = _mobileZoomFactor; });

// ── Cookies ───────────────────────────────────────────────────────────────
ipcMain.handle('lp:exportLongCookies', async (_e, { id } = {}) => exportLongCookies(id || activeId));

ipcMain.on('lp:getCookies', async (e) => {
  try {
    e.returnValue = await exportLongCookies(activeId);
  } catch (_) { e.returnValue = ''; }
});

ipcMain.on('lp:importCookies', async (_e, { id, ck }) => {
  await importCookies(getSession(id || activeId), ck);
  store.set(`session.${id || activeId}`, ck);
});

// ── Navigation ────────────────────────────────────────────────────────────
ipcMain.on('lp:openFacebook',   (_e, { id }) => openFacebookView(id, null));
ipcMain.on('lp:restoreSession', (_e, { id, cookieStr }) => openFacebookView(id, cookieStr || null));
ipcMain.on('lp:goHome',         () => closeView(true));

// ── Container state ───────────────────────────────────────────────────────
ipcMain.on('lp:setActiveId', (_e, { id }) => { activeId = id; });
ipcMain.on('lp:getActiveId', (e)           => { e.returnValue = activeId; });

// ── Session persistence ───────────────────────────────────────────────────
ipcMain.on('lp:saveSession', (_e, { id, ck }) => { if (id && ck) store.set(`session.${id}`, ck); });
ipcMain.on('lp:loadSession', (e, { id })       => { e.returnValue = store.get(`session.${id}`) ? 'auto' : ''; });
ipcMain.on('lp:deleteSession', async (_e, { id }) => {
  store.delete(`session.${id}`);
  const ses = getSession(id);
  await ses.clearStorageData().catch(() => {});
  await ses.cookies.flushStore().catch(() => {});
});

// ── Container list ────────────────────────────────────────────────────────
ipcMain.on('lp:getContainerList',  (e) => { e.returnValue = store.get('containers', '[]'); });
ipcMain.on('lp:saveContainerList', (_e, { json }) => {
  store.set('containers', json);
  // Keep in-memory cache fresh so panel opens instantly
  try { _containerCache = JSON.parse(json || '[]'); } catch (_) { _containerCache = []; }
});

// ── Container Panel — instant open via cached list ────────────────────────

// Show cookie import/export panel INSIDE Facebook BrowserView so it appears above the Facebook page.
ipcMain.on('lp:showFbCookiePanel', () => {
  try { if (fbView) fbView.webContents.send('lp:toggleCookiePanel', { activeId }); } catch (_) {}
});


ipcMain.on('lp:togglePanel', () => {
  if (!fbView) return;
  if (_panelOpen) {
    _panelOpen = false;
    try { fbView.webContents.send('lp:hidePanel'); } catch (_) {}
    return;
  }
  _panelOpen = true;
  const containers = _containerCache.length
    ? _containerCache
    : (() => { try { return JSON.parse(store.get('containers','[]')||'[]'); } catch(_){return[];} })();
  try { fbView.webContents.send('lp:showPanel', { containers, activeId }); } catch (_) {}
});

// ── + Dropdown — inject overlay into Facebook BrowserView ────────────────
ipcMain.on('lp:toggleDropdown', () => {
  if (!fbView) return;
  try { fbView.webContents.send('lp:showDropdown', {}); } catch (_) {}
});

// Actions sent from inject.js overlays back to main
ipcMain.on('lp:panelAction', (_e, { type, data }) => {
  // ── Zoom adjust from Ctrl+Wheel inside BrowserView (panel stays open) ──
  if (type === 'zoomAdjust' && data && data.delta !== undefined) {
    if (fbView) {
      _mobileZoomFactor = Math.max(0.5, Math.min(2.0, (_mobileZoomFactor || 1.0) + data.delta));
      try { _applyMobileEmulation(fbView.webContents, _mobileZoomFactor); } catch(_) {}
      mainWin && mainWin.webContents.send('lp:mobileZoomUpdated', { factor: _mobileZoomFactor });
    }
    return; // keep panel open
  }
  // ── Reorder containers from inject.js drag (panel stays open) ──────────
  if (type === 'reorderContainer' && data && data.fromId && data.toId) {
    let ctrs = [];
    try { ctrs = JSON.parse(store.get('containers', '[]') || '[]'); } catch(_) {}
    const fromIdx = ctrs.findIndex(c => c.id === data.fromId);
    const toIdx   = ctrs.findIndex(c => c.id === data.toId);
    if (fromIdx !== -1 && toIdx !== -1) {
      const [item] = ctrs.splice(fromIdx, 1);
      ctrs.splice(toIdx, 0, item);
      store.set('containers', JSON.stringify(ctrs));
      _containerCache = ctrs; // update cache
      mainWin && mainWin.webContents.send('lp:containersUpdated', ctrs);
      // Refresh inject.js panel in-place
      if (fbView) {
        fbView.webContents.send('lp:showPanel', { containers: ctrs, activeId });
      }
    }
    return; // keep panel open
  }


  // ── Cookie import from Facebook overlay keeps old behavior: active container only.
  // Home-page cookie import creates a new container via lp:importCookies + openFacebook(id).
  if (type === 'importCookieNewContainer' && data && (data.ck || data.cookies)) {
    const ck = String(data.ck || data.cookies || '').trim();
    if (!ck || !activeId) return;
    importCookies(getSession(activeId), ck)
      .then(() => { try { fbView && fbView.webContents.reload(); } catch (_) {} })
      .catch(() => {});
    return;
  }

  // ── Arrow-key tab switching from injected Facebook page ───────────────────
  if (type === 'switchRelativeTab' && data) {
    switchRelativeTabShortcut(data.dir === -1 ? -1 : 1);
    return;
  }

  _panelOpen = false;
  if (type === 'openContainer' && data && data.id) {
    openFacebookView(data.id, null);
  } else if (type === 'addContainer' || type === 'newContainer') {
    mainWin && mainWin.webContents.send('lp:showAddContainer');
  } else if (type === 'newTab') {
    if (activeId) openNewTab(activeId);
  } else if (type === 'renameSave' && data && data.id && data.name) {
    let ctrs = [];
    try { ctrs = JSON.parse(store.get('containers', '[]') || '[]'); } catch(_) {}
    ctrs.forEach(c => { if (c.id === data.id) c.name = data.name; });
    store.set('containers', JSON.stringify(ctrs));
    _containerCache = ctrs;
    mainWin && mainWin.webContents.send('lp:containersUpdated', ctrs);
  } else if (type === 'proxySave' && data && data.id) {
    // Save proxy config + apply to session silently (NO reload — reload would
    // return Facebook to homepage because the IP changes and FB does a security
    // redirect; the new proxy takes effect for all new connections automatically)
    const proxyConf = {
      type: data.type || 'HTTP',
      host: _cleanProxyHost(data.host),
      port: String(data.port||'').trim(),
      user: data.user||'',
      pass: data.pass||''
    };
    store.set(`proxy.container.${data.id}`, proxyConf);
    const _pSes = getSession(data.id);
    applyProxy(_pSes, data.id).catch(() => {});
    // No reload, no clearCache — proxy takes effect on next new connection

  } else if (type === 'proxyClear' && data && data.id) {
    // Remove proxy + switch session to direct — NO reload (same reason as above)
    store.delete(`proxy.container.${data.id}`);
    const _cSes = getSession(data.id);
    applyProxy(_cSes, data.id).catch(() => {});

  } else if (type === 'proxyTestRequest' && data && data.id) {
    // Test from inject.js panel — two-phase for HTTP, direct session for SOCKS
    const tp = {
      type: (data.type||'HTTP').toUpperCase(),
      host: _cleanProxyHost(data.host||''),
      port: String(data.port||'').trim(),
      user: (data.user||'').trim(),
      pass: data.pass||''
    };
    const sendResult = (r) => { fbView && fbView.webContents.send('lp:proxyTestResult', r); };
    if (!tp.host || !tp.port) {
      // No proxy entered → show local (direct) IP
      _testViaSession('direct://', '', '', (r) => {
        sendResult(r ? Object.assign(r, { direct: true }) : { ok: false, error: 'IP check timed out' });
      });
    } else if (tp.type === 'SOCKS5' || tp.type === 'SOCKS4') {
      _testViaSession(_buildProxyRules(tp), tp.user, tp.pass, (r) => {
        sendResult(r || { ok: false, error: 'SOCKS proxy — IP-check timed out' });
      });
    } else {
      _testHttpProxy(tp.host, tp.port, tp.user, tp.pass, `http://${tp.host}:${tp.port}`, sendResult);
    }
  } else if (type === 'deleteSave' && data && data.id) {
    // Delete session + container
    const cid = data.id;
    destroyContainerTabs(cid);
    try { getSession(cid).clearStorageData().catch(() => {}); } catch(_) {}
    let ctrs = [];
    try { ctrs = JSON.parse(store.get('containers', '[]') || '[]'); } catch(_) {}
    ctrs = ctrs.filter(c => c.id !== cid);
    store.set('containers', JSON.stringify(ctrs));
    _containerCache = ctrs;
    mainWin && mainWin.webContents.send('lp:containersUpdated', ctrs);
    if (activeId === cid) {
      activeId = null;
      closeView(true);
    } else if (activeId) {
      sendTabsState(activeId);
    }
  }
  // 'closed' / 'dropClosed' — dismissed by user
});

// ── Clipboard ─────────────────────────────────────────────────────────────
ipcMain.on('lp:copyText', (_e, { text }) => clipboard.writeText(text || ''));

// ── Cache ─────────────────────────────────────────────────────────────────
ipcMain.on('lp:clearCache', async () => {
  if (!fbView) return;
  const ses = fbView.webContents.session;
  await ses.clearCache().catch(() => {});
  await ses.clearStorageData({ storages: ['appcache', 'shadercache', 'serviceworkers'] }).catch(() => {});
  fbView && fbView.webContents.reload();
});

// ── External URL ──────────────────────────────────────────────────────────
ipcMain.on('lp:openExternalUrl', (_e, { url }) => { if (isHttp(url)) shell.openExternal(url).catch(() => {}); });

// ── Global proxy ──────────────────────────────────────────────────────────
// Apply the global proxy to every container session simultaneously.
// Containers with a per-container proxy keep their own proxy (applyProxy
// already gives per-container priority over global).
async function _applyGlobalProxyToAll() {
  let ctrs = [];
  try { ctrs = JSON.parse(store.get('containers', '[]') || '[]'); } catch(_) {}
  await Promise.all(ctrs.map(c => applyProxy(getSession(c.id), c.id).catch(() => {})));
}

// ── Helper: update global creds then apply proxy ──────────────────────────
// _gProxyUser / _gProxyPass are read by app.on('login') for ALL sessions.
function _updateGlobalCreds(user, pass) {
  _gProxyUser = user || '';
  _gProxyPass = pass || '';
}

ipcMain.on('lp:setProxy', (_e, { type, host, port, user, pass }) => {
  const cleanHost = _cleanProxyHost(host);
  const cleanPort = String(port||'').trim();
  const cleanType = (type || 'HTTP').toUpperCase();
  store.set('proxy.global', { type: cleanType, host: cleanHost, port: cleanPort, user: user||'', pass: pass||'' });

  // Update global creds so app.on('login') provides them for ALL sessions
  _updateGlobalCreds(user, pass);

  _applyGlobalProxyToAll().then(() => {
    if (fbView) fbView.webContents.reload();
    _setOsProxy(cleanType, cleanHost, cleanPort);
    _updateTray(true, cleanHost);
  }).catch(() => {});
});

ipcMain.on('lp:clearProxy', () => {
  store.delete('proxy.global');
  _updateGlobalCreds('', '');
  _applyGlobalProxyToAll().then(() => {
    if (fbView) fbView.webContents.reload();
    _clearOsProxy();
    _updateTray(false, null);
  }).catch(() => {});
});
ipcMain.on('lp:getProxy',    (e) => { e.returnValue = JSON.stringify(store.get('proxy.global') || {}); });
ipcMain.on('lp:isVpnActive', (e) => { const p = store.get('proxy.global'); e.returnValue = !!(p && p.host); });

// ── Per-container proxy ───────────────────────────────────────────────────
ipcMain.on('lp:setContainerProxy', (_e, { id, type, host, port, user, pass }) => {
  store.set(`proxy.container.${id}`, {
    type: type||'HTTP', host: _cleanProxyHost(host),
    port: String(port||'').trim(), user: user||'', pass: pass||''
  });
  // Also update global creds so app.on('login') works for this session too
  _updateGlobalCreds(user, pass);
  // Apply silently — NO reload (reload causes Facebook homepage redirect on IP change)
  applyProxy(getSession(id), id).catch(() => {});
});
ipcMain.on('lp:clearContainerProxy', (_e, { id }) => {
  store.delete(`proxy.container.${id}`);
  // Restore global proxy creds (or clear if none)
  const gp = store.get('proxy.global');
  _updateGlobalCreds(gp && gp.user, gp && gp.pass);
  applyProxy(getSession(id), id).catch(() => {});
});
ipcMain.on('lp:getContainerProxy', (e, { id }) => {
  e.returnValue = JSON.stringify(store.get(`proxy.container.${id}`) || {});
});

// ── Global proxy test ─────────────────────────────────────────────────────
ipcMain.on('lp:testGlobalProxy', (_e) => {
  const send = (r) => { mainWin && mainWin.webContents.send('lp:proxyTestResult', r); };
  const globalProxy = store.get('proxy.global');

  if (!globalProxy || !globalProxy.host) {
    // No proxy — show current direct IP
    _testViaSession('direct://', '', '', (r) => {
      send(r ? Object.assign(r, { direct: true }) : { ok: false, error: 'IP check timed out' });
    });
    return;
  }

  const host  = _cleanProxyHost(globalProxy.host);
  const port  = globalProxy.port;
  const user  = globalProxy.user || '';
  const pass  = globalProxy.pass || '';
  const pType = (globalProxy.type || 'HTTP').toUpperCase();

  if (pType === 'SOCKS5' || pType === 'SOCKS4') {
    // SOCKS — IP check via Electron session
    _testViaSession(_buildProxyRules(globalProxy), user, pass, (r) => {
      send(r || { ok: false, error: 'SOCKS proxy — IP-check timed out' });
    });
  } else {
    // HTTP — GoLogin-style: direct CONNECT + IP check (no SuperProxy)
    const rules = `http://${host}:${port}`;
    _testHttpProxy(host, port, user, pass, rules, send);
  }
});

// ── Container proxy test (from home modal) ────────────────────────────────
ipcMain.on('lp:testContainerProxy', (_e, { id, type, host, port, user, pass }) => {
  const send = (r) => { mainWin && mainWin.webContents.send('lp:proxyTestResult', r); };
  const tp = {
    type: (type||'HTTP').toUpperCase(),
    host: _cleanProxyHost(host||''),
    port: String(port||'').trim(),
    user: (user||'').trim(),
    pass: pass||''
  };

  if (!tp.host || !tp.port) {
    // No proxy entered → show local (direct) IP
    _testViaSession('direct://', '', '', (r) => {
      send(r ? Object.assign(r, { direct: true }) : { ok: false, error: 'IP check timed out' });
    });
    return;
  }

  if (tp.type === 'SOCKS5' || tp.type === 'SOCKS4') {
    _testViaSession(_buildProxyRules(tp), tp.user, tp.pass, (r) => {
      send(r || { ok: false, error: 'SOCKS proxy — IP-check timed out' });
    });
  } else {
    // HTTP: no credentials in proxyRules URL (Chromium strips them)
    // session.login event in _testViaSession handles 407 auth
    _testHttpProxy(tp.host, tp.port, tp.user, tp.pass, `http://${tp.host}:${tp.port}`, send);
  }
});

// ── Stubs ─────────────────────────────────────────────────────────────────
ipcMain.on('lp:getSharedText',   (e) => { e.returnValue = ''; });
ipcMain.on('lp:setPendingLogin', ()  => {});

ipcMain.on('lp:switchRelativeTab', (_e, { dir } = {}) => { switchRelativeTabShortcut(dir === -1 ? -1 : 1); });
ipcMain.on('lp:restoreOpenTabs', () => { restoreOpenContainerTabs(); });

function getVisibleTabIds() {
  if (!activeId) return [];
  const ids = [];
  Object.keys(containerTabs).forEach(cid => {
    if (containerTabs[cid] && containerTabs[cid][0]) ids.push(containerTabs[cid][0].id);
  });
  (containerTabs[activeId] || []).slice(1).forEach(t => ids.push(t.id));
  return ids;
}
function switchRelativeTab(dir) {
  if (!activeId || !mainWin) return;
  const ids = getVisibleTabIds();
  const cur = containerActiveTab[activeId];
  if (!ids.length || !cur) return;
  let i = ids.indexOf(cur);
  if (i < 0) i = 0;
  const next = ids[(i + dir + ids.length) % ids.length];
  if (next) {
    let ownerCid = null;
    for (const cid of Object.keys(containerTabs)) {
      if ((containerTabs[cid] || []).some(t => t.id === next)) { ownerCid = cid; break; }
    }
    if (!ownerCid || !tabViewMap[next]) return;
    activeId = ownerCid;
    (mainWin.getBrowserViews() || []).forEach(v => { try { mainWin.removeBrowserView(v); } catch (_) {} });
    containerActiveTab[ownerCid] = next;
    fbView = tabViewMap[next];
    mainWin.addBrowserView(fbView);
    stretchFbView();
    sendNav(fbView.webContents);
    sendTabsState(ownerCid);
  }
}
function closeActiveTab() {
  if (!activeId) return;
  const tabId = containerActiveTab[activeId];
  if (tabId) ipcMain.emit('lp:closeTab', null, { tabId });
}


function restoreOpenContainerTabs() {
  let ids = [];
  try {
    const snap = JSON.parse(store.get('openContainerTabsSnapshot', '[]') || '[]');
    if (Array.isArray(snap) && snap.length) ids = snap.map(x => (x && x.id) || '').filter(Boolean);
  } catch (_) {}
  if (!ids.length) {
    try { ids = JSON.parse(store.get('openContainerTabIds', '[]') || '[]'); } catch (_) { ids = []; }
  }
  if (!Array.isArray(ids) || !ids.length) return;

  let ctrs = [];
  try { ctrs = JSON.parse(store.get('containers', '[]') || '[]'); } catch (_) { ctrs = []; }
  const valid = [...new Set(ids)].filter(id => ctrs.some(c => c.id === id));
  if (!valid.length) return;

  const lastStored = store.get('lastActiveContainerId', '') || '';
  const last = valid.includes(lastStored) ? lastStored : valid[valid.length - 1];

  // Create/load every saved container tab as a real BrowserView. Do not only draw the tab UI.
  for (const id of valid) {
    try {
      if (!containerTabs[id] || !containerTabs[id].length || !tabViewMap[containerActiveTab[id]]) {
        openFacebookView(id);
      }
    } catch (_) {}
  }

  // Activate the last active container after all views exist.
  try { openFacebookView(last); } catch (_) {}
  try { sendTabsState(activeId || last); } catch (_) {}
}

// ══════════════════════════════════════════════════════════════════════════
//  Tab IPC
// ══════════════════════════════════════════════════════════════════════════

// Open a new tab in the active container
ipcMain.on('lp:newTab', (e) => {
  if (!activeId) { e.returnValue = null; return; }
  e.returnValue = openNewTab(activeId);
});

// Switch to a different tab (works for both container anchor tabs and normal tabs)
ipcMain.on('lp:switchTab', (_e, { tabId }) => {
  if (!tabId || !tabViewMap[tabId] || !mainWin) return;
  // Find which container owns this tab
  let ownerCid = null;
  for (const cid of Object.keys(containerTabs)) {
    if ((containerTabs[cid] || []).some(t => t.id === tabId)) { ownerCid = cid; break; }
  }
  if (!ownerCid) return;
  activeId = ownerCid;
  (mainWin.getBrowserViews() || []).forEach(v => { try { mainWin.removeBrowserView(v); } catch (_) {} });
  containerActiveTab[ownerCid] = tabId;
  fbView = tabViewMap[tabId];
  mainWin.addBrowserView(fbView);
  stretchFbView();
  sendNav(fbView.webContents);
  sendTabsState(ownerCid);
});

// Close a specific tab
ipcMain.on('lp:closeTab', (_e, { tabId }) => {
  if (!activeId) return;
  const tabs = containerTabs[activeId];
  if (!tabs) return;
  const idx = tabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;

  // Destroy the view
  const view = tabViewMap[tabId];
  if (view) {
    try { mainWin && mainWin.removeBrowserView(view); } catch (_) {}
    try { view.webContents.destroy(); }                 catch (_) {}
    delete tabViewMap[tabId];
  }
  tabs.splice(idx, 1);

  if (tabs.length === 0) {
    // No more tabs → go home
    fbView = null;
    mainWin && mainWin.webContents.send('lp:onHome');
    return;
  }

  // Switch to adjacent tab
  const newTabId = tabs[Math.min(idx, tabs.length - 1)].id;
  containerActiveTab[activeId] = newTabId;
  fbView = tabViewMap[newTabId];
  if (fbView && mainWin) {
    (mainWin.getBrowserViews() || []).forEach(v => { try { mainWin.removeBrowserView(v); } catch (_) {} });
    mainWin.addBrowserView(fbView);
    stretchFbView();
    sendNav(fbView.webContents);
  }
  sendTabsState(activeId);
});

// Get tabs state for current container
ipcMain.on('lp:getTabsState', (e) => {
  if (!activeId) { e.returnValue = JSON.stringify({ tabs: [], activeTabId: null }); return; }
  const ctrTabs = Object.keys(containerTabs)
    .filter(cid => containerTabs[cid] && containerTabs[cid].length > 0)
    .map(cid => {
      const first = containerTabs[cid][0];
      return { id: first.id, title: first.title || 'Facebook', url: first.url || '', containerId: cid, type: 'container' };
    });
  const nrmTabs = (containerTabs[activeId] || []).slice(1)
    .map(t => ({ id: t.id, title: t.title || 'Facebook', url: t.url || '', containerId: activeId, type: 'tab' }));
  e.returnValue = JSON.stringify({
    tabs: [...ctrTabs, ...nrmTabs],
    activeTabId: containerActiveTab[activeId] || null,
  });
});

// Destroy all tabs for a container — properly handle active-container case
ipcMain.on('lp:destroyContainerTabs', (_e, { id }) => {
  const wasActive = activeId === id;
  destroyContainerTabs(id);
  if (wasActive) {
    activeId = null;
    closeView(true);
  } else if (activeId) {
    sendTabsState(activeId);
  }
});

// ── App-level guard (fb:// tel:// mailto:// etc.) ─────────────────────────
app.on('web-contents-created', (_event, wc) => {
  wc.on('will-navigate', (event, url) => {
    if (!isHttp(url) && !url.startsWith('file:///') && !url.startsWith('about:') && !url.startsWith('data:')) {
      event.preventDefault();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
//  Performance flags
// ══════════════════════════════════════════════════════════════════════════
// ── Performance & stability flags ────────────────────────────────────────
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('enable-features', 'NetworkService');

// Memory — allow renderer to use up to 4 GB heap (Account Center needs this)
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096 --max-semi-space-size=256');

// GPU — use hardware acceleration, prevent GPU process crashes
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay');
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder');

// Disable sandbox — prevents renderer & GPU process sandbox crashes
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

// Network — keep connections alive, faster WebSocket & HTTP/2
app.commandLine.appendSwitch('enable-quic');
app.commandLine.appendSwitch('quic-version', 'h3-29');

// Prevent process from being killed when window is hidden/minimised
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-media-suspend');

// ── OS System-wide Proxy (applies to all browsers & internet) ─────────────
// Sets the operating system's proxy so every browser/app on the computer
// routes through the same proxy — not just the Electron BrowserView sessions.
const { exec } = require('child_process');

// Apply OS-level proxy settings (raw, no credentials in the address)
function _applyOsProxyAddr(scheme, h, p) {
  const proxyAddr = `${h}:${p}`;
  if (process.platform === 'win32') {
    exec(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1 /f`);
    exec(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer /t REG_SZ /d "${proxyAddr}" /f`);
    exec(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyOverride /t REG_SZ /d "localhost;127.0.0.1;<local>" /f`);
    exec(`netsh winhttp set proxy proxy-server="${scheme}=${proxyAddr}" bypass-list="localhost;127.0.0.1;<local>"`);
  } else if (process.platform === 'darwin') {
    exec(`networksetup -listallnetworkservices 2>/dev/null | grep -v "^An " | head -2 | tail -1`, (_err, iface) => {
      const svc = (iface || 'Wi-Fi').trim();
      if (scheme === 'socks') {
        exec(`networksetup -setsocksfirewallproxy "${svc}" ${h} ${p}`);
        exec(`networksetup -setsocksfirewallproxystate "${svc}" on`);
      } else {
        exec(`networksetup -setwebproxy "${svc}" ${h} ${p}`);
        exec(`networksetup -setwebproxystate "${svc}" on`);
        exec(`networksetup -setsecurewebproxy "${svc}" ${h} ${p}`);
        exec(`networksetup -setsecurewebproxystate "${svc}" on`);
      }
    });
  } else if (process.platform === 'linux') {
    exec(`gsettings set org.gnome.system.proxy mode 'manual'`);
    exec(`gsettings set org.gnome.system.proxy.${scheme === 'socks' ? 'socks' : 'http'} host '${h}'`);
    exec(`gsettings set org.gnome.system.proxy.${scheme === 'socks' ? 'socks' : 'http'} port ${p}`);
    exec(`gsettings set org.gnome.system.proxy.https host '${h}'`);
    exec(`gsettings set org.gnome.system.proxy.https port ${p}`);
  }
}

function _setOsProxy(type, host, port) {
  if (!host || !port) return;
  const h      = host.trim();
  const p      = String(port).trim();
  const scheme = (type === 'SOCKS5' || type === 'SOCKS4') ? 'socks' : 'http';
  try { _applyOsProxyAddr(scheme, h, p); } catch(_) {}
}

function _clearOsProxy() {
  try {
    if (process.platform === 'win32') {
      exec(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f`);
      exec(`netsh winhttp reset proxy`);
    } else if (process.platform === 'darwin') {
      exec(`networksetup -listallnetworkservices 2>/dev/null | grep -v "^An " | head -2 | tail -1`, (_err, iface) => {
        const svc = (iface || 'Wi-Fi').trim();
        exec(`networksetup -setwebproxystate "${svc}" off`);
        exec(`networksetup -setsecurewebproxystate "${svc}" off`);
        exec(`networksetup -setsocksfirewallproxystate "${svc}" off`);
      });
    } else if (process.platform === 'linux') {
      exec(`gsettings set org.gnome.system.proxy mode 'none'`);
    }
  } catch(_) {}
}

// ── System Tray — VPN status indicator ────────────────────────────────────
let _tray = null;

function _trayIcon(vpnActive) {
  // 16×16 colored dot: green = VPN on, grey = off
  const color = vpnActive ? '#10B981' : '#6B7280';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
    <circle cx="8" cy="8" r="7" fill="${color}" opacity="0.9"/>
    <text x="8" y="12" text-anchor="middle" font-size="9" font-family="sans-serif" fill="white" font-weight="bold">${vpnActive ? 'V' : 'M'}</text>
  </svg>`;
  return nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
}

function _updateTray(vpnActive, proxyHost) {
  if (!_tray) return;
  _tray.setImage(_trayIcon(vpnActive));
  if (vpnActive && proxyHost) {
    _tray.setToolTip(`Multi Plus — VPN ON\n${proxyHost}`);
  } else {
    _tray.setToolTip('Multi Plus — No VPN');
  }
  const ctxMenu = Menu.buildFromTemplate([
    { label: 'Multi Plus v10.6.12', enabled: false },
    { type: 'separator' },
    { label: vpnActive ? `✅ VPN Active — ${proxyHost || ''}` : '⭕ VPN Inactive', enabled: false },
    { type: 'separator' },
    { label: 'Show Window', click: () => { if (mainWin) { mainWin.show(); mainWin.focus(); } } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);
  _tray.setContextMenu(ctxMenu);
}

function _notifyVpn(vpnActive, proxyHost) {
  try {
    if (!Notification.isSupported()) return;
    new Notification({
      title: vpnActive ? '🔒 VPN Connected' : '🔓 VPN Disconnected',
      body:  vpnActive ? `Proxy: ${proxyHost || 'Unknown'}\nAll containers routed through VPN` : 'Traffic now routed directly',
      icon:  path.join(__dirname, 'icon.png'),
      silent: false,
    }).show();
  } catch(_) {}
}

app.whenReady().then(() => {
  // Pre-warm container cache so panel opens instantly on first toggle
  try { _containerCache = JSON.parse(store.get('containers', '[]') || '[]'); } catch(_) { _containerCache = []; }

  // GoLogin-style startup: no SuperProxy to restore, just create window immediately
  const _existingProxy = store.get('proxy.global');

  // Restore global proxy credentials for app.on('login') handler
  if (_existingProxy && _existingProxy.host) {
    _updateGlobalCreds(_existingProxy.user, _existingProxy.pass);
  }

  // System tray — shows VPN status at all times
  try {
    const iconPath = path.join(__dirname, 'icon.png');
    _tray = new Tray(fs.existsSync(iconPath) ? iconPath : _trayIcon(false));
    _tray.setToolTip('Multi Plus');
    _tray.on('double-click', () => { if (mainWin) { mainWin.show(); mainWin.focus(); } });
    _updateTray(!!(_existingProxy && _existingProxy.host), _existingProxy && _existingProxy.host);
  } catch(_) { _tray = null; }

  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('before-quit', () => { _clearOsProxy(); });

// Strong cookie export: get all Facebook-related cookies from active session.
try {
  ipcMain.handle('cookies:getAll', async (e, urls)=>{
    const out = [];
    const seen = new Set();
    const list = Array.isArray(urls) ? urls : [
      'https://facebook.com',
      'https://www.facebook.com',
      'https://m.facebook.com',
      'https://mbasic.facebook.com',
      'https://web.facebook.com',
      'https://messenger.com',
      'https://www.messenger.com'
    ];
    let ses = null;
    try {
      if (typeof activeView !== 'undefined' && activeView && activeView.webContents) ses = activeView.webContents.session;
    } catch(e){}
    try {
      if (!ses && typeof fbView !== 'undefined' && fbView && fbView.webContents) ses = fbView.webContents.session;
    } catch(e){}
    try {
      if (!ses && mainWindow && mainWindow.webContents) ses = mainWindow.webContents.session;
    } catch(e){}
    if (!ses) return out;
    for (const url of list) {
      try {
        const cookies = await ses.cookies.get({url});
        for (const c of cookies) {
          const key = c.name + '|' + (c.domain || '');
          if (!seen.has(key)) {
            seen.add(key);
            out.push(c);
          }
        }
      } catch(e){}
    }
    return out;
  });
} catch(e){}
