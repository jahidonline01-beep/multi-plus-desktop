// Multi Plus Desktop v4 — Preload (main UI window)
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('LP', {

  // ── Window controls ────────────────────────────────────────────────────
  minimize()  { ipcRenderer.send('lp:minimize'); },
  maximize()  { ipcRenderer.send('lp:maximize'); },
  close()     { ipcRenderer.send('lp:close'); },

  // ── Facebook navigation ────────────────────────────────────────────────
  fbGoBack()      { ipcRenderer.send('lp:fbGoBack'); },
  fbGoForward()   { ipcRenderer.send('lp:fbGoForward'); },
  fbReload()      { ipcRenderer.send('lp:fbReload'); },
  fbLoadUrl(url)  { ipcRenderer.send('lp:fbLoadUrl', { url }); },

  // ── Mobile simulator ───────────────────────────────────────────────────
  toggleMobileMode() { return ipcRenderer.sendSync('lp:toggleMobileMode'); },
  getMobileMode()    { return ipcRenderer.sendSync('lp:getMobileMode'); },
  setMobileZoom(f)   { return ipcRenderer.sendSync('lp:setMobileZoom', { factor: f }); },
  getMobileZoom()    { return ipcRenderer.sendSync('lp:getMobileZoom'); },

  // ── Long-lasting cookie export ─────────────────────────────────────────
  async exportCookiesLong(id) {
    return await ipcRenderer.invoke('lp:exportLongCookies', { id: id || '' });
  },

  // ── Navigation ─────────────────────────────────────────────────────────
  openFacebook(id) { ipcRenderer.send('lp:openFacebook', { id: id || '' }); },
  restoreSession(id, cookieStr) { ipcRenderer.send('lp:restoreSession', { id, cookieStr: cookieStr || '' }); },
  goHome()         { ipcRenderer.send('lp:goHome'); },

  // ── Container state ────────────────────────────────────────────────────
  getActiveId()   { return ipcRenderer.sendSync('lp:getActiveId') || ''; },
  setActiveId(id) { ipcRenderer.send('lp:setActiveId', { id }); },

  // ── Session persistence ────────────────────────────────────────────────
  saveSession(id, ck)  { if (id && ck) ipcRenderer.send('lp:saveSession', { id, ck }); },
  loadSession(id)       { return ipcRenderer.sendSync('lp:loadSession', { id }) || ''; },
  deleteSession(id)     { ipcRenderer.send('lp:deleteSession', { id }); },

  // ── Container list ─────────────────────────────────────────────────────
  getContainerList()    { return ipcRenderer.sendSync('lp:getContainerList') || '[]'; },
  saveContainerList(j)  { ipcRenderer.send('lp:saveContainerList', { json: j }); },

  // ── Cookies ────────────────────────────────────────────────────────────
  getCookies()           { return ipcRenderer.sendSync('lp:getCookies') || ''; },
  importCookies(ck, id)  { ipcRenderer.send('lp:importCookies', { id: id || '', ck }); },

  // ── Clipboard ──────────────────────────────────────────────────────────
  copyText(text) { ipcRenderer.send('lp:copyText', { text }); },

  // ── Cache ──────────────────────────────────────────────────────────────
  clearCache() { ipcRenderer.send('lp:clearCache'); },

  // ── External URL ───────────────────────────────────────────────────────
  openExternalUrl(url) { ipcRenderer.send('lp:openExternalUrl', { url }); },

  // ── Global proxy ───────────────────────────────────────────────────────
  setProxy(type, host, port, user, pass) { ipcRenderer.send('lp:setProxy', { type, host, port, user, pass }); },
  clearProxy()  { ipcRenderer.send('lp:clearProxy'); },
  getProxy()    { return ipcRenderer.sendSync('lp:getProxy') || '{}'; },
  isVpnActive() { return ipcRenderer.sendSync('lp:isVpnActive') || false; },

  // ── Per-container proxy ────────────────────────────────────────────────
  setContainerProxy(id, type, host, port, user, pass) {
    ipcRenderer.send('lp:setContainerProxy', { id, type, host, port, user, pass });
  },
  clearContainerProxy(id) { ipcRenderer.send('lp:clearContainerProxy', { id }); },
  getContainerProxy(id)   { return ipcRenderer.sendSync('lp:getContainerProxy', { id }) || '{}'; },

  // ── Test proxy from home page (result returned to mainWin, not fbView) ─
  testContainerProxy(id, type, host, port, user, pass) {
    ipcRenderer.send('lp:testContainerProxy', { id, type, host, port, user, pass });
  },

  // ── Test GLOBAL proxy — main process uses net.request through proxy session
  // (renderer XHR never goes through Electron session proxy, so this MUST
  //  go through main.js to get accurate proxy IP result)
  testGlobalProxy() { ipcRenderer.send('lp:testGlobalProxy'); },

  // ── Stubs ──────────────────────────────────────────────────────────────
  getSharedText()         { return ''; },
  setPendingLogin(_u, _p) { },

  // ── Tab management ──────────────────────────────────────────────────────
  newTab()         { return ipcRenderer.sendSync('lp:newTab'); },
  switchTab(tabId) { ipcRenderer.send('lp:switchTab', { tabId }); },
  closeTab(tabId)  { ipcRenderer.send('lp:closeTab',  { tabId }); },
  switchRelativeTab(dir) { ipcRenderer.send('lp:switchRelativeTab', { dir: dir === -1 ? -1 : 1 }); },
  restoreOpenTabs() { ipcRenderer.send('lp:restoreOpenTabs'); },
  getTabsState()   { return JSON.parse(ipcRenderer.sendSync('lp:getTabsState') || '{"tabs":[],"activeTabId":null}'); },
  destroyContainerTabs(id) { ipcRenderer.send('lp:destroyContainerTabs', { id }); },

  // ── Container Panel toggle (when Facebook is open, inject into BrowserView) ─
  togglePanel()    { ipcRenderer.send('lp:togglePanel'); },
  showFbCookiePanel() { ipcRenderer.send('lp:showFbCookiePanel'); },
  toggleDropdown() { ipcRenderer.send('lp:toggleDropdown'); },

  // ── BrowserView layout (Row-2 visibility) ─────────────────────────────
  setViewLayout(nrmVisible, panelOpen) {
    ipcRenderer.send('lp:viewLayout', { nrmVisible: !!nrmVisible, panelOpen: !!panelOpen });
  },

  // ── Event listener ─────────────────────────────────────────────────────
  on(channel, cb) {
    const allowed = [
      'lp:onHome', 'lp:fbNav', 'lp:fbOpened', 'lp:winState', 'lp:tabsState',
      'lp:showAddContainer', 'lp:openRename', 'lp:openProxy', 'lp:openDelete', 'lp:containersUpdated',
      'lp:proxyTestResult', 'lp:mobileZoomUpdated',
    ];
    if (allowed.includes(channel)) ipcRenderer.on(channel, cb);
  },
});

try{ window.LP = Object.assign(window.LP||{}, { getAllCookies:(urls)=>require('electron').ipcRenderer.invoke('cookies:getAll', urls) }); }catch(e){}
