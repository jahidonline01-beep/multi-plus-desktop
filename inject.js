// Multi Plus Desktop — Facebook page overlay script
(function () {
  'use strict';
  if (!/facebook\.com/i.test(location.hostname)) return;
  if (window.__mpInjected) return;
  window.__mpInjected = true;

  var LP = window.LP;
  if (!LP) return;

  try { LP.getActiveId(); } catch (_) {}

  // Same gradient colours as home-page panel
  var COLORS = [
    '#7C3AED','#2563EB','#059669','#D97706','#BE185D',
    '#DC2626','#4338CA','#0369A1','#065F46','#92400E'
  ];

  var panelEl   = null;
  var dropEl    = null;
  var _allCtrs  = [];   // full container list (set on showPanel)
  var _activeId = '';
  var _searchQ  = '';

  function _digitsOnly(v){ return String(v||'').replace(/[^0-9]/g,''); }
  function _normSearch(v){
    return String(v||'').normalize ? String(v||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ') : String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
  }
  function _serialNum(list, idx){ return String(Math.max(1, (list && list.length ? list.length : 1) - idx)).padStart(2,'0'); }
  function _fbTitle(list, idx){
    var c=(list && list[idx]) || {};
    var serialTitle='Facebook ' + _serialNum(list, idx);
    var nm=String(c.name||'').trim();
    if(!nm || /^Facebook\s+\d+$/i.test(nm) || /^Google\s+\d+$/i.test(nm) || /^Outlook\s+\d+$/i.test(nm)) return serialTitle;
    return nm;
  }
  function _containerSearchMatch(c, idx, q, list){
    var qq=_normSearch(q);
    if(!qq) return true;
    var cleanQ=qq.replace(/\s+/g,'');
    var digits=_digitsOnly(qq);
    var numericOnly=!!(digits && /^#?\d+$/.test(cleanQ));
    var serial=_serialNum(list,idx);
    var raw=[String((c&&c.name)||''),String(_fbTitle(list,idx)||''),String((c&&c.uid)||''),String((c&&c.fbUid)||''),String((c&&c.facebookUid)||''),String((c&&c.facebookId)||''),String((c&&c.id)||'')];
    var serials=[serial,String(idx+1),String(parseInt(serial,10)||serial),String(parseInt(idx+1,10)||idx+1)];
    if(numericOnly){
      if(serials.some(function(s){ return _digitsOnly(s)===digits; })) return true;
      return raw.some(function(v){ var n=_normSearch(v); return n===qq || _digitsOnly(n)===digits; });
    }
    return raw.some(function(v){ return _normSearch(v)===qq; });
  }

  // Register callback — fb-preload bridges IPC events here
  if (LP.onPanel) {
    LP.onPanel(function (type, data) {
      if      (type === 'show')            showPanel(data);
      else if (type === 'hide')            hidePanel(false);
      else if (type === 'showDropdown')    showDropdown();
      else if (type === 'hideDropdown')    hideDropdown(false);
      else if (type === 'proxyTestResult') _onProxyTestResult(data);
      else if (type === 'showCookiePanel')  showCookiePanel(data);
      else if (type === 'toggleCookiePanel') toggleCookiePanel(data);
    });
  }

  // ════════════════════════════════════════════════════════════
  //  CONTAINER PANEL  (matches home-page renderContainersPanel)
  // ════════════════════════════════════════════════════════════
  // One-time panel init — create DOM once, reuse every show/hide (much faster)
  function _initPanelEl() {
    panelEl = document.createElement('div');
    panelEl.id = '__mp_panel__';
    panelEl.style.cssText =
      'position:fixed;top:50px;right:8px;width:300px;max-height:82vh;overflow:hidden;' +
      'display:none;flex-direction:column;' +
      'background:rgba(8,10,22,.98);border:1px solid rgba(124,58,237,.3);' +
      'border-radius:16px;z-index:2147483647;' +
      'box-shadow:0 20px 60px rgba(0,0,0,.9);' +
      'font-family:Inter,system-ui,sans-serif;color:#fff;font-size:13px;box-sizing:border-box;' +
      'transition:opacity .12s,transform .12s;opacity:0;transform:translateX(12px);';
    panelEl.innerHTML = _panelHtml();
    document.body.appendChild(panelEl);
    panelEl.addEventListener('click', onPanelClick);
    var inp = panelEl.querySelector('#__mp_search__');
    if (inp) {
      inp.addEventListener('input', function () {
        _searchQ = this.value.toLowerCase().trim();
        var listEl = panelEl.querySelector('#__mp_list__');
        if (listEl) listEl.innerHTML = _listHtml();
      });
    }
  }

  function showPanel(data) {
    hideDropdown(false);
    _allCtrs  = (data && data.containers) ? data.containers : [];
    _activeId = (data && data.activeId)   ? data.activeId   : '';
    _searchQ  = '';
    if (!panelEl) _initPanelEl();

    // Reset search field
    var inp = panelEl.querySelector('#__mp_search__');
    if (inp) inp.value = '';

    // Update list content only (fast — no full rebuild)
    var listEl = panelEl.querySelector('#__mp_list__');
    if (listEl) listEl.innerHTML = _listHtml();

    // Show with slide-in animation
    panelEl.style.display = 'flex';
    requestAnimationFrame(function () {
      panelEl.style.opacity = '1';
      panelEl.style.transform = 'translateX(0)';
    });

    setTimeout(function () { document.addEventListener('click', onPanelOutside); }, 30);
  }

  function hidePanel(notify) {
    document.removeEventListener('click', onPanelOutside);
    if (panelEl) {
      panelEl.style.opacity = '0';
      panelEl.style.transform = 'translateX(12px)';
      // Use display:none after animation so it's invisible but still in DOM for reuse
      setTimeout(function () {
        if (panelEl) panelEl.style.display = 'none';
      }, 120);
    }
    if (notify !== false && LP.panelAction) LP.panelAction('closed', null);
  }

  function onPanelOutside(e) {
    if (panelEl && !panelEl.contains(e.target)) hidePanel(true);
  }

  function onPanelClick(e) {
    e.stopPropagation();

    // Close ✕
    if (e.target.closest('#__mp_close__')) { hidePanel(true); return; }

    // Add New Container footer
    if (e.target.closest('#__mp_add__')) {
      hidePanel(false);
      LP.panelAction && LP.panelAction('newContainer', null);
      return;
    }

    // Action buttons (data-action + data-cid attributes)
    var btn = e.target.closest('[data-action]');
    if (btn) {
      var action = btn.getAttribute('data-action');
      var cid    = btn.getAttribute('data-cid');
      var cname  = btn.getAttribute('data-cname') || '';
      if      (action === 'open')   { hidePanel(false); LP.panelAction && LP.panelAction('openContainer', { id: cid }); }
      else if (action === 'rename') { showRenameWin(cid, cname); }
      else if (action === 'proxy')  { showProxyWin(cid, cname); }
      else if (action === 'delete') { showDeleteWin(cid, cname); }
      return;
    }

    // Row click → open container
    var row = e.target.closest('[data-cid]');
    if (row && !row.hasAttribute('data-action')) {
      var cid2 = row.getAttribute('data-cid');
      if (cid2) { hidePanel(false); LP.panelAction && LP.panelAction('openContainer', { id: cid2 }); }
    }
  }

  // ── Build full panel HTML ─────────────────────────────────────────────────
  function _panelHtml() {
    var h = '';

    // Header
    h += '<div style="padding:13px 14px 10px;border-bottom:1px solid rgba(255,255,255,.07);' +
         'display:flex;align-items:center;justify-content:space-between">' +
         '<div style="font-size:13px;font-weight:800;color:#A78BFA;letter-spacing:.3px">All Containers</div>' +
         '<button id="__mp_close__" style="width:24px;height:24px;border:none;border-radius:7px;' +
         'background:rgba(255,255,255,.06);color:rgba(255,255,255,.4);cursor:pointer;font-size:14px;' +
         'display:flex;align-items:center;justify-content:center;padding:0" ' +
         'onmouseenter="this.style.background=\'rgba(239,68,68,.25)\';this.style.color=\'#EF4444\'" ' +
         'onmouseleave="this.style.background=\'rgba(255,255,255,.06)\';this.style.color=\'rgba(255,255,255,.4)\'">✕</button>' +
         '</div>';

    // Search bar
    h += '<div style="padding:8px 10px 6px">' +
         '<div style="position:relative;display:flex;align-items:center">' +
         '<svg style="position:absolute;left:9px;pointer-events:none" viewBox="0 0 24 24" fill="none" ' +
         'stroke="rgba(255,255,255,.3)" stroke-width="2" width="14" height="14">' +
         '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65" stroke-linecap="round"/></svg>' +
         '<input id="__mp_search__" type="text" placeholder="Search containers..." ' +
         'style="width:100%;padding:7px 9px 7px 28px;border-radius:9px;border:1px solid rgba(255,255,255,.1);' +
         'background:rgba(255,255,255,.06);color:white;font-size:12px;font-family:inherit;outline:none;' +
         'box-sizing:border-box"/>' +
         '</div></div>';

    // Container list — scrollable, search+header stay fixed
    h += '<div id="__mp_list__" style="padding:4px 8px 8px;overflow-y:auto;flex:1;scrollbar-width:thin;scrollbar-color:rgba(124,58,237,.3) transparent">' + _listHtml() + '</div>';

    return h;
  }

  function _listHtml() {
    var filtered = _searchQ
      ? _allCtrs.filter(function (c, idx) { return _containerSearchMatch(c, idx, _searchQ, _allCtrs); })
      : _allCtrs;

    if (!_allCtrs.length) {
      return '<div style="text-align:center;padding:20px 14px;color:rgba(255,255,255,.3);font-size:12px">No containers yet<br><br>' +
             '<div id="__mp_add__" style="display:inline-block;margin-top:4px;padding:8px 18px;border-radius:10px;' +
             'background:linear-gradient(135deg,#7C3AED,#2563EB);color:white;font-size:12px;font-weight:700;cursor:pointer">+ Add Account</div></div>';
    }

    if (!filtered.length) {
      return '<div style="text-align:center;padding:16px 14px;color:rgba(255,255,255,.3);font-size:12px">' +
             'No results for "<span style="color:rgba(167,139,250,.7)">' + esc(_searchQ) + '</span>"</div>';
    }

    var rows = filtered.map(function (c) {
      var i = _allCtrs.indexOf(c);
      var color    = COLORS[i % COLORS.length];
      var isActive = c.id === _activeId;
      var num      = String(_allCtrs.length - i).padStart(2, '0');

      return (
        '<div data-cid="' + esc(c.id) + '" draggable="true" ' +
        'ondragstart="__mpDragStart(event,\'' + esc(c.id) + '\')" ' +
        'ondragover="__mpDragOver(event,this)" ' +
        'ondragleave="__mpDragLeave(this)" ' +
        'ondrop="__mpDragDrop(event,\'' + esc(c.id) + '\',this)" ' +
        'ondragend="__mpDragEnd(event)" ' +
        'style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:11px;' +
        'margin-bottom:3px;cursor:grab;transition:opacity .12s,outline .08s;' +
        'border:1px solid ' + (isActive ? 'rgba(124,58,237,.4)' : 'rgba(255,255,255,.05)') + ';' +
        'background:' + (isActive ? 'rgba(124,58,237,.1)' : 'rgba(255,255,255,.03)') + '">' +

        // Color badge with number
        '<div data-action="open" data-cid="' + esc(c.id) + '" ' +
        'style="width:30px;height:30px;border-radius:8px;background:' + color + ';flex-shrink:0;' +
        'display:flex;align-items:center;justify-content:center;font-weight:800;color:white;font-size:11px;cursor:pointer">' +
        num + '</div>' +

        // Name + status
        '<div data-action="open" data-cid="' + esc(c.id) + '" style="flex:1;min-width:0;cursor:pointer">' +
        '<div style="font-size:12px;font-weight:700;color:' + (isActive ? '#A78BFA' : '#fff') + ';' +
        'overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc((c.name || 'Facebook').replace(/^Facebook\s*\d+\s*/i,'Facebook')) + '</div>' +
        '<div style="font-size:10px;color:rgba(255,255,255,.3);margin-top:1px">' +
        (isActive ? '<span style="color:#34D399">● Active</span>' : 'Facebook Account') +
        '</div></div>' +

        // Rename button
        '<button data-action="rename" data-cid="' + esc(c.id) + '" data-cname="' + esc(c.name || '') + '" title="Rename" ' +
        'style="width:26px;height:26px;border:none;border-radius:8px;flex-shrink:0;cursor:pointer;' +
        'background:rgba(124,58,237,.15);color:#A78BFA;display:flex;align-items:center;justify-content:center;padding:0" ' +
        'onmouseenter="this.style.background=\'rgba(124,58,237,.35)\'" ' +
        'onmouseleave="this.style.background=\'rgba(124,58,237,.15)\'">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="12" height="12">' +
        '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke-linecap="round"/>' +
        '<path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4z" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg></button>' +

        // Proxy button
        '<button data-action="proxy" data-cid="' + esc(c.id) + '" title="Proxy" ' +
        'style="width:26px;height:26px;border:none;border-radius:8px;flex-shrink:0;cursor:pointer;' +
        'background:rgba(16,185,129,.12);color:#10B981;display:flex;align-items:center;justify-content:center;padding:0" ' +
        'onmouseenter="this.style.background=\'rgba(16,185,129,.35)\'" ' +
        'onmouseleave="this.style.background=\'rgba(16,185,129,.12)\'">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">' +
        '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' +
        '<path d="M9 12l2 2 4-4"/>' +
        '</svg></button>' +

        // Delete button
        '<button data-action="delete" data-cid="' + esc(c.id) + '" title="Delete" ' +
        'style="width:26px;height:26px;border:none;border-radius:8px;flex-shrink:0;cursor:pointer;' +
        'background:rgba(239,68,68,.12);color:#EF4444;display:flex;align-items:center;justify-content:center;padding:0" ' +
        'onmouseenter="this.style.background=\'rgba(239,68,68,.35)\'" ' +
        'onmouseleave="this.style.background=\'rgba(239,68,68,.12)\'">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" width="12" height="12">' +
        '<polyline points="3 6 5 6 21 6"/>' +
        '<path d="M19 6l-1 14H6L5 6" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M10 11v6M14 11v6" stroke-linecap="round"/>' +
        '</svg></button>' +

        '</div>'
      );
    }).join('');

    // Add footer
    rows += '<div style="padding:7px 0 2px;border-top:1px solid rgba(255,255,255,.06);margin-top:5px">' +
            '<div id="__mp_add__" ' +
            'style="width:100%;padding:9px;border-radius:10px;cursor:pointer;' +
            'background:linear-gradient(135deg,#7C3AED,#2563EB);color:white;font-size:12px;' +
            'font-weight:700;display:flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box" ' +
            'onmouseenter="this.style.opacity=\'.85\'" onmouseleave="this.style.opacity=\'1\'">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" width="12" height="12">' +
            '<path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg> Add New Container</div></div>';

    return rows;
  }

  // ════════════════════════════════════════════════════════════
  //  + BUTTON DROPDOWN (New Tab / New Container)
  // ════════════════════════════════════════════════════════════
  function showDropdown() {
    hidePanel(false);
    hideDropdown(false);

    dropEl = document.createElement('div');
    dropEl.id = '__mp_drop__';
    dropEl.style.cssText =
      'position:fixed;top:50px;left:8px;width:210px;' +
      'background:rgba(8,10,22,.98);border:1px solid rgba(124,58,237,.3);' +
      'border-radius:14px;z-index:2147483647;overflow:hidden;' +
      'box-shadow:0 16px 50px rgba(0,0,0,.95);' +
      'font-family:Inter,system-ui,sans-serif;color:#fff;font-size:13px;box-sizing:border-box;';

    dropEl.innerHTML =
      '<div id="__mp_newtab__" style="display:flex;align-items:center;gap:10px;padding:11px 14px;' +
      'cursor:pointer;border-bottom:1px solid rgba(255,255,255,.06)" ' +
      'onmouseenter="this.style.background=\'rgba(24,119,242,.15)\'" ' +
      'onmouseleave="this.style.background=\'\'">' +
      '<div style="width:26px;height:26px;border-radius:8px;background:#1877F2;display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
      '<svg viewBox="0 0 24 24" width="13" height="13"><rect width="24" height="24" rx="4" fill="#1877F2"/>' +
      '<path d="M16 4h-2.5A3.5 3.5 0 0010 7.5V10H8v3h2v7h3v-7h2.5l.5-3H13V7.5a.5.5 0 01.5-.5H16V4z" fill="white"/></svg>' +
      '</div>' +
      '<div><div style="font-weight:700;font-size:12px">New Tab</div>' +
      '<div style="font-size:10px;color:rgba(255,255,255,.4);margin-top:1px">In current container</div></div></div>' +

      '<div id="__mp_newctr__" style="display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer" ' +
      'onmouseenter="this.style.background=\'rgba(124,58,237,.2)\'" ' +
      'onmouseleave="this.style.background=\'\'">' +
      '<div style="width:26px;height:26px;border-radius:8px;background:linear-gradient(135deg,#7C3AED,#2563EB);display:flex;align-items:center;justify-content:center;flex-shrink:0">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" width="13" height="13"><path d="M12 5v14M5 12h14" stroke-linecap="round"/></svg>' +
      '</div>' +
      '<div><div style="font-weight:700;font-size:12px">New Container</div>' +
      '<div style="font-size:10px;color:rgba(255,255,255,.4);margin-top:1px">New Facebook account</div></div></div>';

    document.body.appendChild(dropEl);
    dropEl.addEventListener('click', onDropClick);
    setTimeout(function () { document.addEventListener('click', onDropOutside); }, 80);
  }

  function hideDropdown(notify) {
    document.removeEventListener('click', onDropOutside);
    if (dropEl) { dropEl.removeEventListener('click', onDropClick); dropEl.remove(); dropEl = null; }
    if (notify !== false && LP.panelAction) LP.panelAction('dropClosed', null);
  }

  function onDropOutside(e) {
    if (dropEl && !dropEl.contains(e.target)) hideDropdown(true);
  }

  function onDropClick(e) {
    e.stopPropagation();
    if (e.target.closest('#__mp_newtab__')) { hideDropdown(false); LP.panelAction && LP.panelAction('newTab', null); return; }
    if (e.target.closest('#__mp_newctr__')) { hideDropdown(false); LP.panelAction && LP.panelAction('newContainer', null); return; }
  }

  // ════════════════════════════════════════════════════════════
  //  FLOATING MINI WINDOWS (Rename / Proxy / Delete)
  //  — appear on top of Facebook, no home navigation needed
  // ════════════════════════════════════════════════════════════
  var miniEl = null;

  function _closeMini() {
    document.removeEventListener('click', _miniOutside);
    if (miniEl) { miniEl.remove(); miniEl = null; }
  }
  function _miniOutside(e) { if (miniEl && !miniEl.contains(e.target)) _closeMini(); }

  function _makeMini(html) {
    _closeMini();
    miniEl = document.createElement('div');
    miniEl.style.cssText =
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
      'width:300px;background:rgba(8,10,22,.99);border:1px solid rgba(124,58,237,.35);' +
      'border-radius:16px;z-index:2147483647;box-shadow:0 24px 70px rgba(0,0,0,.95);' +
      'font-family:Inter,system-ui,sans-serif;color:#fff;font-size:13px;box-sizing:border-box;padding:20px 18px 18px;';
    miniEl.innerHTML = html;
    document.body.appendChild(miniEl);
    setTimeout(function () { document.addEventListener('click', _miniOutside); }, 80);
    return miniEl;
  }

  // ── Rename ────────────────────────────────────────────────────────────────
  function showRenameWin(cid, cname) {
    var el = _makeMini(
      '<div style="font-size:14px;font-weight:800;margin-bottom:14px;' +
      'background:linear-gradient(135deg,#A78BFA,#38BDF8);-webkit-background-clip:text;-webkit-text-fill-color:transparent">Rename Account</div>' +
      '<input id="__mpri__" type="text" maxlength="30" autocomplete="off" value="' + esc(cname) + '" ' +
      'style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.15);' +
      'background:rgba(255,255,255,.07);color:white;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box;margin-bottom:14px"/>' +
      '<div style="display:flex;gap:10px">' +
      '<button id="__mprc__" style="flex:1;padding:11px;border-radius:12px;border:1px solid rgba(255,255,255,.1);' +
      'background:rgba(255,255,255,.06);color:rgba(255,255,255,.7);font-size:13px;font-weight:600;cursor:pointer">Cancel</button>' +
      '<button id="__mprs__" style="flex:1;padding:11px;border-radius:12px;border:none;' +
      'background:linear-gradient(135deg,#7C3AED,#2563EB);color:white;font-size:13px;font-weight:700;cursor:pointer">Save</button>' +
      '</div>'
    );
    var inp = el.querySelector('#__mpri__');
    setTimeout(function () { if (inp) { inp.focus(); inp.select(); } }, 60);
    el.querySelector('#__mprc__').addEventListener('click', function(e){ e.stopPropagation(); _closeMini(); });
    el.querySelector('#__mprs__').addEventListener('click', function(e){
      e.stopPropagation();
      var v = (inp.value || '').trim();
      if (!v) return;
      _closeMini();
      LP.panelAction && LP.panelAction('renameSave', { id: cid, name: v });
    });
  }

  // Global ref for proxy test result callback
  var _proxyTestResultCb = null;
  function _onProxyTestResult(data) { if (_proxyTestResultCb) _proxyTestResultCb(data); }

  // ── Proxy (full home-page style) ─────────────────────────────────────────
  function showProxyWin(cid, cname) {
    var existing = {};
    try {
      var _raw = LP.getContainerProxy ? LP.getContainerProxy(cid) : '{}';
      existing = (typeof _raw === 'string') ? JSON.parse(_raw || '{}') : (_raw || {});
    } catch(_) {}
    var selType = existing.type || 'HTTP';

    _proxyTestResultCb = null; // reset

    var W = '340px';
    _closeMini();
    miniEl = document.createElement('div');
    miniEl.style.cssText =
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
      'width:' + W + ';background:rgba(6,8,20,.99);border:1px solid rgba(124,58,237,.35);' +
      'border-radius:16px;z-index:2147483647;box-shadow:0 24px 70px rgba(0,0,0,.95);' +
      'font-family:Inter,system-ui,sans-serif;color:#fff;font-size:12px;box-sizing:border-box;overflow:hidden;';

    function typeBtn(t) {
      var act = t === selType;
      return '<button data-pt="' + t + '" style="flex:1;padding:8px 0;border-radius:9px;font-size:11px;font-weight:800;cursor:pointer;letter-spacing:.5px;' +
        'border:2px solid ' + (act ? '#10B981' : 'rgba(255,255,255,.12)') + ';' +
        'background:' + (act ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.04)') + ';' +
        'color:' + (act ? '#10B981' : 'rgba(255,255,255,.45)') + '">' + t + '</button>';
    }

    function inp(id, ph, val, pw) {
      return '<input id="' + id + '" type="' + (pw ? 'password' : 'text') + '" placeholder="' + ph + '" value="' + esc(val || '') + '" ' +
        'style="width:100%;padding:9px 11px;border-radius:9px;border:1px solid rgba(255,255,255,.1);' +
        'background:rgba(255,255,255,.06);color:white;font-size:12px;font-family:inherit;outline:none;box-sizing:border-box"/>';
    }

    miniEl.innerHTML =
      // Header
      '<div style="padding:14px 16px 12px;border-bottom:1px solid rgba(255,255,255,.07);display:flex;align-items:flex-start;justify-content:space-between">' +
        '<div>' +
          '<div style="font-size:15px;font-weight:800;background:linear-gradient(135deg,#10B981,#38BDF8);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:2px">Container Proxy</div>' +
          '<div style="font-size:11px;color:rgba(255,255,255,.35)">' + esc(cname) + '</div>' +
        '</div>' +
        '<button id="__mpxclose__" style="width:26px;height:26px;border:none;border-radius:8px;background:rgba(255,255,255,.07);color:rgba(255,255,255,.45);cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;padding:0;flex-shrink:0" ' +
        'onmouseenter="this.style.background=\'rgba(239,68,68,.25)\';this.style.color=\'#EF4444\'" ' +
        'onmouseleave="this.style.background=\'rgba(255,255,255,.07)\';this.style.color=\'rgba(255,255,255,.45)\'">✕</button>' +
      '</div>' +

      '<div style="padding:12px 14px">' +

      // Protocol type
      '<div style="font-size:10px;font-weight:800;color:#10B981;letter-spacing:1px;margin-bottom:7px">PROTOCOL TYPE</div>' +
      '<div id="__mpptypes__" style="display:flex;gap:6px;margin-bottom:12px">' +
        typeBtn('HTTP') + typeBtn('HTTPS') + typeBtn('SOCKS5') + typeBtn('SOCKS4') +
      '</div>' +

      // Server settings
      '<div style="font-size:10px;font-weight:800;color:#38BDF8;letter-spacing:1px;margin-bottom:7px">SERVER SETTINGS</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">' +
        '<div><div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.4);margin-bottom:4px;letter-spacing:.5px">HOST / IP</div>' + inp('__mpph__','192.168.1.1',existing.host) + '</div>' +
        '<div><div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.4);margin-bottom:4px;letter-spacing:.5px">PORT</div>' + inp('__mppp__','8080',existing.port) + '</div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">' +
        '<div><div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35);margin-bottom:4px;letter-spacing:.5px">USERNAME</div>' + inp('__mppu__','optional',existing.user) + '</div>' +
        '<div><div style="font-size:9px;font-weight:700;color:rgba(255,255,255,.35);margin-bottom:4px;letter-spacing:.5px">PASSWORD</div>' + inp('__mppw__','optional',existing.pass,true) + '</div>' +
      '</div>' +

      // Connect + Clear
      '<div style="display:flex;gap:8px;margin-bottom:12px">' +
        '<button id="__mpps__" style="flex:1;padding:12px;border-radius:12px;border:none;' +
        'background:linear-gradient(135deg,#10B981,#059669);color:white;font-size:13px;font-weight:800;cursor:pointer;' +
        'display:flex;align-items:center;justify-content:center;gap:7px">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" width="13" height="13"><path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>Connect</button>' +
        '<button id="__mppclr__" style="flex:0 0 auto;padding:12px 16px;border-radius:12px;border:1px solid rgba(239,68,68,.35);' +
        'background:rgba(239,68,68,.12);color:#EF4444;font-size:12px;font-weight:700;cursor:pointer">Clear</button>' +
      '</div>' +

      // Proxy test section
      '<div style="border-top:1px solid rgba(255,255,255,.07);padding-top:10px">' +
        '<div style="font-size:10px;font-weight:800;color:rgba(255,255,255,.4);letter-spacing:1px;margin-bottom:7px">PROXY TEST — MY IP LOCATION</div>' +
        '<button id="__mptest__" style="width:100%;padding:11px;border-radius:11px;border:none;' +
        'background:linear-gradient(135deg,#0EA5E9,#0369A1);color:white;font-size:12px;font-weight:700;cursor:pointer;' +
        'display:flex;align-items:center;justify-content:center;gap:7px;box-sizing:border-box">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="13" height="13"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>' +
        'Test Proxy — Check My IP &amp; Location</button>' +
        '<div id="__mppres__" style="display:none;margin-top:8px;padding:10px 12px;border-radius:10px;' +
        'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);text-align:center">' +
          '<div id="__mppip__" style="font-size:16px;font-weight:800;color:#34D399;letter-spacing:.04em"></div>' +
          '<div id="__mpploc__" style="font-size:10px;color:rgba(255,255,255,.45);margin-top:3px"></div>' +
          '<div id="__mppnote__" style="font-size:11px;margin-top:5px;font-weight:600"></div>' +
        '</div>' +
      '</div>' +

      '</div>'; // end padding div

    document.body.appendChild(miniEl);
    setTimeout(function () { document.addEventListener('click', _miniOutside); }, 80);

    // Type selector
    var sel = selType;
    miniEl.querySelectorAll('[data-pt]').forEach(function(b) {
      b.addEventListener('click', function(e) {
        e.stopPropagation();
        sel = this.getAttribute('data-pt');
        miniEl.querySelectorAll('[data-pt]').forEach(function(x) {
          var a = x.getAttribute('data-pt') === sel;
          x.style.border     = '2px solid ' + (a ? '#10B981' : 'rgba(255,255,255,.12)');
          x.style.background = a ? 'rgba(16,185,129,.15)' : 'rgba(255,255,255,.04)';
          x.style.color      = a ? '#10B981' : 'rgba(255,255,255,.45)';
        });
      });
    });

    // Close
    miniEl.querySelector('#__mpxclose__').addEventListener('click', function(e){ e.stopPropagation(); _closeMini(); });

    // Connect/Save
    miniEl.querySelector('#__mpps__').addEventListener('click', function(e){
      e.stopPropagation();
      // Strip any URL scheme the user may have typed in the host field
      var host = miniEl.querySelector('#__mpph__').value.trim()
        .replace(/^https?:\/\//i, '').replace(/^socks[45]:\/\//i, '').split('/')[0].split('?')[0];
      var port = miniEl.querySelector('#__mppp__').value.trim();
      if (!host || !port) {
        var hEl = miniEl.querySelector('#__mpph__'); var pEl = miniEl.querySelector('#__mppp__');
        if (!host) { hEl.style.borderColor='rgba(239,68,68,.7)'; setTimeout(function(){hEl.style.borderColor='';},2000); }
        if (!port) { pEl.style.borderColor='rgba(239,68,68,.7)'; setTimeout(function(){pEl.style.borderColor='';},2000); }
        return;
      }
      LP.panelAction && LP.panelAction('proxySave', {
        id: cid, type: sel,
        host: host, port: port,
        user: miniEl.querySelector('#__mppu__').value.trim(),
        pass: miniEl.querySelector('#__mppw__').value
      });
      // Instant feedback — proxy saved and applied immediately to session
      var btn = miniEl.querySelector('#__mpps__');
      btn.innerHTML = '✅ Proxy Applied!';
      btn.style.background = 'linear-gradient(135deg,#059669,#047857)';
      btn.disabled = true;
      setTimeout(function(){ _closeMini(); }, 900);
    });

    // Clear
    miniEl.querySelector('#__mppclr__').addEventListener('click', function(e){
      e.stopPropagation(); _closeMini();
      LP.panelAction && LP.panelAction('proxyClear', { id: cid });
    });

    // Test proxy
    miniEl.querySelector('#__mptest__').addEventListener('click', function(e){
      e.stopPropagation();
      var btn = miniEl.querySelector('#__mptest__');
      var res = miniEl.querySelector('#__mppres__');
      btn.textContent = '⏳ Checking...'; btn.style.opacity = '0.7';
      res.style.display = 'none';

      _proxyTestResultCb = function(data) {
        _proxyTestResultCb = null;
        btn.innerHTML =
          '<svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" width="13" height="13">' +
          '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>' +
          '<path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>' +
          '</svg> Test Proxy — Check My IP &amp; Location';
        btn.style.opacity = '1';
        btn.disabled = false;
        var ipEl   = miniEl.querySelector('#__mppip__');
        var locEl  = miniEl.querySelector('#__mpploc__');
        var noteEl = miniEl.querySelector('#__mppnote__');
        if (data && data.ok) {
          ipEl.textContent   = data.ip  || '';
          ipEl.style.color   = '#34D399';
          locEl.textContent  = data.loc || '(Location unavailable)';
          noteEl.textContent = '✅ Proxy working — traffic routed';
          noteEl.style.color = '#34D399';
          res.style.borderColor = 'rgba(52,211,153,.25)';
        } else {
          ipEl.textContent   = '— No connection —';
          ipEl.style.color   = '#EF4444';
          locEl.textContent  = '';
          var errMsg = (data && data.error) ? data.error : 'Check host/port and try again';
          noteEl.textContent = '❌ ' + errMsg;
          noteEl.style.color = '#EF4444';
          res.style.borderColor = 'rgba(239,68,68,.25)';
        }
        res.style.display = 'block';
      };

      LP.panelAction && LP.panelAction('proxyTestRequest', {
        id:   cid,
        type: sel,
        // Strip URL scheme in case user typed "https://host" in the host field
        host: (miniEl.querySelector('#__mpph__').value || '').trim()
              .replace(/^https?:\/\//i, '').replace(/^socks[45]:\/\//i, '').split('/')[0].split('?')[0],
        port: (miniEl.querySelector('#__mppp__').value || '').trim(),
        user: (miniEl.querySelector('#__mppu__').value || '').trim(),
        pass: (miniEl.querySelector('#__mppw__').value || '')
      });
    });

    setTimeout(function () { var h = miniEl.querySelector('#__mpph__'); if (h) h.focus(); }, 60);
  }

  // ── Delete confirm ────────────────────────────────────────────────────────
  function showDeleteWin(cid, cname) {
    var el = _makeMini(
      '<div style="text-align:center;margin-bottom:16px">' +
      '<div style="width:50px;height:50px;border-radius:16px;background:rgba(239,68,68,.15);' +
      'display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" width="22" height="22">' +
      '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg></div>' +
      '<div style="font-size:15px;font-weight:700;margin-bottom:4px">Delete Account?</div>' +
      '<div style="font-size:12px;color:rgba(255,255,255,.4);margin-bottom:2px">' + esc(cname) + '</div>' +
      '<div style="font-size:11px;color:rgba(255,255,255,.25)">Session data will also be removed</div>' +
      '</div>' +
      '<div style="display:flex;gap:10px">' +
      '<button id="__mpdc__" style="flex:1;padding:11px;border-radius:12px;border:1px solid rgba(255,255,255,.1);' +
      'background:rgba(255,255,255,.06);color:rgba(255,255,255,.7);font-size:13px;font-weight:600;cursor:pointer">Cancel</button>' +
      '<button id="__mpdd__" style="flex:1;padding:11px;border-radius:12px;border:none;' +
      'background:linear-gradient(135deg,#EF4444,#B91C1C);color:white;font-size:13px;font-weight:700;cursor:pointer">Delete</button>' +
      '</div>'
    );
    el.querySelector('#__mpdc__').addEventListener('click', function(e){ e.stopPropagation(); _closeMini(); });
    el.querySelector('#__mpdd__').addEventListener('click', function(e){
      e.stopPropagation(); _closeMini();
      LP.panelAction && LP.panelAction('deleteSave', { id: cid });
    });
  }



  // ── Cookie Input / Export panel INSIDE Facebook BrowserView ───────────────
  var cookieEl = null;

  function toggleCookiePanel(data) {
    if (cookieEl && cookieEl.style.display === 'block') { cookieEl.style.display = 'none'; return; }
    showCookiePanel(data);
  }
  function showCookiePanel() {
    hidePanel(false);
    hideDropdown(false);
    _closeMini();
    if (!cookieEl) {
      cookieEl = document.createElement('div');
      cookieEl.id = '__mp_cookie_panel__';
      cookieEl.style.cssText =
        'position:fixed;top:52px;right:10px;width:390px;max-width:calc(100vw - 20px);' +
        'max-height:calc(100vh - 70px);overflow:auto;z-index:2147483647;' +
        'background:rgba(8,10,22,.985);border:1px solid rgba(20,184,166,.35);' +
        'border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.9);' +
        'font-family:Inter,system-ui,sans-serif;color:#fff;box-sizing:border-box;padding:14px;';
      cookieEl.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">' +
          '<div style="font-size:14px;font-weight:900;color:#fff">Cookies Input</div>' +
          '<button id="__mp_ck_close__" style="height:28px;padding:0 12px;border-radius:9px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.08);color:white;font-size:12px;font-weight:800;cursor:pointer">Back</button>' +
        '</div>' +
        '<textarea id="__mp_ck_input__" placeholder="Paste cookies here..." spellcheck="false" style="width:100%;height:92px;resize:vertical;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.07);color:#fff;padding:10px;font-size:12px;outline:none;box-sizing:border-box;margin-bottom:8px"></textarea>' +
        '<textarea id="__mp_ck_output__" placeholder="Cookies output..." readonly spellcheck="false" style="width:100%;height:92px;resize:vertical;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#fff;padding:10px;font-size:12px;outline:none;box-sizing:border-box;margin-bottom:10px"></textarea>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px">' +
          '<button id="__mp_ck_import__" style="height:36px;border-radius:11px;border:none;background:linear-gradient(135deg,#14B8A6,#2563EB);color:white;font-weight:900;font-size:12px;cursor:pointer">Input</button>' +
          '<button id="__mp_ck_export__" style="height:36px;border-radius:11px;border:none;background:linear-gradient(135deg,#F59E0B,#EF4444);color:white;font-weight:900;font-size:12px;cursor:pointer">Export</button>' +
          '<button id="__mp_ck_clear__" style="height:36px;border-radius:11px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.08);color:white;font-weight:900;font-size:12px;cursor:pointer">Clear</button>' +
        '</div>' +
        '<div id="__mp_ck_status__" style="font-size:11px;color:rgba(255,255,255,.45);min-height:16px"></div>';
      document.body.appendChild(cookieEl);
      cookieEl.querySelector('#__mp_ck_close__').onclick = function(e){ e.stopPropagation(); cookieEl.style.display='none'; };
      cookieEl.querySelector('#__mp_ck_clear__').onclick = function(e){ e.stopPropagation(); cookieEl.querySelector('#__mp_ck_input__').value=''; cookieEl.querySelector('#__mp_ck_output__').value=''; cookieEl.querySelector('#__mp_ck_status__').textContent=''; };
      cookieEl.querySelector('#__mp_ck_import__').onclick = function(e){
        e.stopPropagation();
        var raw = cookieEl.querySelector('#__mp_ck_input__').value.trim();
        var st = cookieEl.querySelector('#__mp_ck_status__');
        if(!raw){ st.style.color='#EF4444'; st.textContent='Paste cookies first'; return; }
        try {
          // Facebook-inside cookie panel keeps the original behavior: import into the ACTIVE container, then reload.
          // New-container auto open is only for the Home page cookie panel.
          LP.importCookies(raw);
          st.style.color='#34D399';
          st.textContent='Cookies input saved. Reloading Facebook...';
          setTimeout(function(){ location.reload(); }, 500);
        }
        catch(err){ st.style.color='#EF4444'; st.textContent='Cookie input failed'; }
      };
      cookieEl.querySelector('#__mp_ck_export__').onclick = async function(e){
        e.stopPropagation();
        var out = cookieEl.querySelector('#__mp_ck_output__');
        var st = cookieEl.querySelector('#__mp_ck_status__');
        st.style.color='rgba(255,255,255,.55)'; st.textContent='Exporting cookies...';
        try {
          var ck = '';
          if (LP.exportCookiesLong) ck = await LP.exportCookiesLong();
          else if (LP.getCookies) ck = LP.getCookies() || '';
          out.value = ck || '';
          if (ck) { LP.copyText && LP.copyText(ck); st.style.color='#34D399'; st.textContent='Cookies exported and copied'; }
          else { st.style.color='#F59E0B'; st.textContent='No cookies found'; }
        } catch(err) { st.style.color='#EF4444'; st.textContent='Export failed'; }
      };
      cookieEl.addEventListener('click', function(e){ e.stopPropagation(); });
    }
    cookieEl.style.display = 'block';
  }

  // ── Escape HTML ────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Panel Drag-to-Reorder ──────────────────────────────────────────────────
  var __mpDragSrcId  = null;
  var __mpDragOverEl = null;
  window.__mpDragStart = function(e, id) {
    __mpDragSrcId = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    setTimeout(function() {
      if (e.target) { e.target.style.opacity = '0.3'; e.target.style.cursor = 'grabbing'; }
    }, 10);
  };
  window.__mpDragOver = function(e, el) {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    if (__mpDragOverEl && __mpDragOverEl !== el) {
      __mpDragOverEl.style.outline = '';
    }
    __mpDragOverEl = el;
    if (el) el.style.outline = '2px solid rgba(124,58,237,.85)';
  };
  window.__mpDragLeave = function(el) {
    if (el && el === __mpDragOverEl) {
      el.style.outline = '';
      __mpDragOverEl = null;
    }
  };
  window.__mpDragEnd = function(e) {
    if (__mpDragOverEl) { __mpDragOverEl.style.outline = ''; __mpDragOverEl = null; }
    if (e && e.target) { e.target.style.opacity = ''; e.target.style.cursor = ''; }
    __mpDragSrcId = null;
  };
  window.__mpDragDrop = function(e, targetId, el) {
    e.preventDefault();
    e.stopPropagation();
    if (el) el.style.outline = '';
    var srcId = __mpDragSrcId;
    window.__mpDragEnd(null);
    if (!srcId || srcId === targetId) return;
    if (typeof LP !== 'undefined' && LP.panelAction)
      LP.panelAction('reorderContainer', { fromId: srcId, toId: targetId });
  };

  // ── Ctrl+Wheel Zoom (when inside Facebook BrowserView) ────────────────────
  (function() {
    var _zoomThrottle = 0;
    window.addEventListener('wheel', function(e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      var now = Date.now();
      if (now - _zoomThrottle < 80) return; // 80ms throttle
      _zoomThrottle = now;
      var delta = e.deltaY < 0 ? 0.1 : -0.1;
      if (typeof LP !== 'undefined' && LP.panelAction)
        LP.panelAction('zoomAdjust', { delta: delta });
    }, { passive: false });
  })();



  // ── Global arrow-key tab switching inside Facebook BrowserView ────────────
  // Works without hovering/clicking the tab bar; ignores text fields.
  (function() {
    function isInputLike(el) {
      if (!el) return false;
      var tag = (el.tagName || '').toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
    }
    window.addEventListener('keydown', function(e) {
      var k = e.key || '';
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].indexOf(k) < 0) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (isInputLike(e.target) || isInputLike(document.activeElement)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      var dir = (k === 'ArrowLeft' || k === 'ArrowUp') ? -1 : 1;
      if (typeof LP !== 'undefined' && LP.panelAction) LP.panelAction('switchRelativeTab', { dir: dir });
    }, true);
  })();

  // ── Deferred panel DOM pre-build ──────────────────────────────────────────
  // Wait 3 s after inject so the Facebook page loads fully first.
  // showPanel() also calls _initPanelEl() on-demand if the user opens the panel
  // before the timer fires — the timer just pre-warms it for instant re-opens.
  setTimeout(function () { if (!panelEl) { try { _initPanelEl(); } catch(_) {} } }, 1000);
})();
