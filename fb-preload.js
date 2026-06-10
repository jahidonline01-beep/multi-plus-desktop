// Multi Plus Desktop — Facebook BrowserView Preload
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

let _panelCb = null;

ipcRenderer.on('lp:showPanel',       (_e, data) => { if (_panelCb) _panelCb('show',            data); });
ipcRenderer.on('lp:hidePanel',       ()         => { if (_panelCb) _panelCb('hide',            null); });
ipcRenderer.on('lp:showDropdown',    (_e, data) => { if (_panelCb) _panelCb('showDropdown',     data); });
ipcRenderer.on('lp:hideDropdown',    ()         => { if (_panelCb) _panelCb('hideDropdown',     null); });
ipcRenderer.on('lp:proxyTestResult', (_e, data) => { if (_panelCb) _panelCb('proxyTestResult',  data); });
ipcRenderer.on('lp:showCookiePanel',  (_e, data) => { if (_panelCb) _panelCb('showCookiePanel', data); });
ipcRenderer.on('lp:toggleCookiePanel',(_e, data) => { if (_panelCb) _panelCb('toggleCookiePanel', data); });
ipcRenderer.on('lp:showHistoryOverlay',(_e, data) => { if (_panelCb) _panelCb('showHistoryOverlay', data); });

contextBridge.exposeInMainWorld('LP', {

  goHome()         { ipcRenderer.send('lp:goHome'); },
  getActiveId()    { return ipcRenderer.sendSync('lp:getActiveId') || ''; },
  setActiveId(id)  { ipcRenderer.send('lp:setActiveId', { id }); },
  saveSession(id, ck) { ipcRenderer.send('lp:saveSession', { id, ck }); },
  getCookies(_url) { return ipcRenderer.sendSync('lp:getCookies', { url: _url }) || ''; },
  async exportCookiesLong() { return await ipcRenderer.invoke('lp:exportLongCookies', { id: '' }); },
  importCookies(ck) { ipcRenderer.send('lp:importCookies', { id: '', ck: ck || '' }); },
  copyText(text)   { ipcRenderer.send('lp:copyText', { text }); },
  clearCache()     { ipcRenderer.send('lp:clearCache'); },
  openExternalUrl(url) { ipcRenderer.send('lp:openExternalUrl', { url }); },

  // ── Container Panel IPC ────────────────────────────────────────────────
  // inject.js calls this once to register its callback
  onPanel(cb) { _panelCb = cb; },
  // inject.js calls this to send actions back to main
  panelAction(type, data) {
    ipcRenderer.send('lp:panelAction', { type, data: data || null });
  },

  // Per-container proxy (used by inject.js proxy mini-window)
  getContainerProxy(id) { return ipcRenderer.sendSync('lp:getContainerProxy', { id }) || '{}'; },

  // Stubs not needed in Facebook context
  loadSession(_id)      { return ''; },
  getContainerList()    { return '[]'; },
  saveContainerList(_j) { },
  getProxy()            { return '{}'; },
  isVpnActive()         { return false; },
  getSharedText()       { return ''; },
  setPendingLogin()     { },
});

try{ window.LP = Object.assign(window.LP||{}, { getAllCookies:(urls)=>require('electron').ipcRenderer.invoke('cookies:getAll', urls) }); }catch(e){}
