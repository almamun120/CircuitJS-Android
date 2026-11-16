// Glue between the CircuitJS web app and the Android shell (MainActivity.kt).
(function () {
  var NATIVE = window.AndroidBridge;
  var A = window.AndroidBridge || { onRunState: function(){}, onSimLoaded: function(){}, saveBase64: function(){},
    onTool: function(){}, onPaletteVisible: function(){} };

  // Restore the last circuit: the simulator reads window.startCircuitText as its first circuit,
  // so nothing can overwrite it afterwards.
  var lastSaved = null;
  try {
    var saved = NATIVE && NATIVE.getAutosave && NATIVE.getAutosave();
    if (saved) { window.startCircuitText = saved; lastSaved = saved; }
  } catch (e) {}

  // Continuously keep the native autosave file in sync (also after files are opened).
  function autosaveTick() {
    try {
      var sim = window.CircuitJS1;
      if (!sim || !NATIVE || !NATIVE.autosave) return;
      var t = sim.exportCircuit();
      if (t && t !== lastSaved) { lastSaved = t; NATIVE.autosave(t); }
    } catch (e) {}
  }
  setInterval(autosaveTick, 1000);
  document.addEventListener('visibilitychange', autosaveTick);
  window.addEventListener('pagehide', autosaveTick);

  // Tell the native toolbar when the simulation starts/stops.
  var lastRunning = null;
  window.oncircuitjsloaded = function (sim) {
    sim.onupdate = function (s) {
      var r = !!s.isRunning();
      if (r !== lastRunning) { lastRunning = r; A.onRunState(r); }
    };
    A.onSimLoaded();
    try { buildPalette(sim); } catch (e) { console.log('palette: ' + e); }
  };

  // "Save As" / data export use <a download href="blob:...">, which WebView ignores.
  // Intercept those clicks and hand the bytes to Android's file picker.
  function blobToNative(href, name) {
    fetch(href).then(function (r) { return r.blob(); }).then(function (b) {
      var fr = new FileReader();
      fr.onload = function () {
        var data = String(fr.result);
        A.saveBase64(name || 'circuit.txt', b.type || 'text/plain', data.substring(data.indexOf(',') + 1));
      };
      fr.readAsDataURL(b);
    });
  }
  document.addEventListener('click', function (e) {
    var el = e.target;
    while (el && el.tagName !== 'A') el = el.parentNode;
    if (el && el.href && el.href.indexOf('blob:') === 0) {
      e.preventDefault(); e.stopPropagation();
      blobToNative(el.href, el.getAttribute('download'));
    }
  }, true);

  // Prevent text selection / long-press callouts on the drawing area.
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // ------------------------------------------------------------------------------------
  // Touch palette (bottom sheet). Data comes from CircuitJS1.getPalette(); tapping a chip calls
  // CircuitJS1.selectTool(id). Fully removed from the layout when hidden (no leftover strip) and the
  // simulator canvas is re-measured whenever the sheet appears/disappears, so scopes are never cut off.
  // The most-used tools (Select, Wire, Ground...) also live in the native top bar (MainActivity).
  // ------------------------------------------------------------------------------------
  var CAT_NAMES = {
    'Passive Components': 'Passive', 'Inputs and Sources': 'Sources', 'Outputs and Labels': 'Outputs',
    'Active Components': 'Active', 'Active Building Blocks': 'Blocks',
    'Logic Gates, Input and Output': 'Gates', 'Digital Chips': 'Chips',
    'Analog and Hybrid Chips': 'Analog', 'Move': 'Move / Select'
  };
  var COMMON = ['Select', 'WireElm', 'GroundElm', 'ResistorElm', 'CapacitorElm', 'InductorElm',
    'DCVoltageElm', 'ACVoltageElm', 'SwitchElm', 'DiodeElm', 'LEDElm', 'TransistorElm', 'NTransistorElm',
    'OpAmpElm', 'LogicInputElm', 'LogicOutputElm', 'ProbeElm'];

  function buildPalette(sim) {
    var raw = JSON.parse(sim.getPalette());
    var byId = {}, cats = [], merged = {};
    raw.forEach(function (c) {
      var name = CAT_NAMES[c.name] || c.name;
      if (!merged[name]) { merged[name] = { name: name, items: [] }; cats.push(merged[name]); }
      c.items.forEach(function (it) {
        if (it.id === 'Select') it.label = 'Select';
        merged[name].items.push(it); byId[it.id] = it;
      });
    });
    cats = cats.filter(function (c) { return c.name !== 'Basic' && c.items.length; });
    var common = COMMON.filter(function (id) { return byId[id]; }).map(function (id) { return byId[id]; });
    cats.unshift({ name: 'Common', items: common });

    var css = document.createElement('style');
    css.textContent =
      ':root{--pal-bg:#fbfcfd;--pal-fg:#191c1e;--pal-sub:#5b6770;--pal-chip:#e8eef2;--pal-line:#d5dce1;--pal-acc:#0E7490;--pal-onacc:#fff}' +
      '@media(prefers-color-scheme:dark){:root{--pal-bg:#1c2125;--pal-fg:#e3e8eb;--pal-sub:#9aa6ae;--pal-chip:#2c343a;--pal-line:#3a444b;--pal-acc:#4fd0e8;--pal-onacc:#00252d}}' +
      '#cjs-pal{position:fixed;bottom:0;left:0;right:0;z-index:50;background:var(--pal-bg);color:var(--pal-fg);' +
      'border-top:1px solid var(--pal-line);box-shadow:0 -3px 14px rgba(0,0,0,.14);' +
      'font:500 14px Roboto,system-ui,Arial,sans-serif;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}' +
      '#cjs-pal.hidden{display:none}' +
      '#cjs-pal .row{display:flex;gap:8px;overflow-x:auto;scrollbar-width:none;align-items:center}' +
      '#cjs-pal .row::-webkit-scrollbar{display:none}' +
      '#cjs-pal .tabs{padding:6px 4px 2px 10px;gap:2px}' +
      '#cjs-pal .items{padding:6px 10px 10px}' +
      '#cjs-pal button{flex:none;font:inherit;color:var(--pal-fg);border:0;white-space:nowrap;background:transparent}' +
      '#cjs-pal .tab{height:30px;padding:0 12px;border-radius:15px;color:var(--pal-sub);font-size:13px;font-weight:600}' +
      '#cjs-pal .tab.sel{background:var(--pal-chip);color:var(--pal-fg)}' +
      '#cjs-pal .chip{height:42px;padding:0 16px;border-radius:12px;background:var(--pal-chip);' +
      'box-shadow:inset 0 0 0 1px var(--pal-line);transition:background .12s}' +
      '#cjs-pal .chip:active{transform:scale(.97)}' +
      '#cjs-pal .chip.sel{background:var(--pal-acc);color:var(--pal-onacc);box-shadow:none;font-weight:700}' +
      '#cjs-pal .close{position:sticky;right:0;width:36px;height:30px;margin-left:auto;padding:0;border-radius:15px;' +
      'background:var(--pal-bg);color:var(--pal-sub);font-size:16px}' +
      'body.cjs-has-pal{position:fixed;left:0;right:0;top:0;margin:0}';
    document.head.appendChild(css);

    var bar = document.createElement('div'); bar.id = 'cjs-pal';
    var tabRow = document.createElement('div'); tabRow.className = 'row tabs';
    var itemRow = document.createElement('div'); itemRow.className = 'row items';
    bar.appendChild(tabRow); bar.appendChild(itemRow);
    document.body.appendChild(bar);
    document.body.classList.add('cjs-has-pal');

    var current = 0, visible = true, lastTool = null, nudgeTimer = null;
    try { visible = localStorage.getItem('cjs-pal-hidden') !== '1'; } catch (e) {}

    // Make the simulator re-measure its canvas (it only re-measures on width changes by itself).
    function relayout() {
      document.body.style.bottom = (visible ? bar.offsetHeight : 0) + 'px';
      window.dispatchEvent(new Event('resize'));
      clearTimeout(nudgeTimer);
      nudgeTimer = setTimeout(function () {
        var cv = document.querySelector('canvas');
        if (cv) cv.width = cv.width + 1;          // forces CirSim.checkCanvasSize() -> setCanvasSize()
        window.dispatchEvent(new Event('resize'));
      }, 60);
    }
    function setVisible(v, persist) {
      visible = !!v;
      bar.classList.toggle('hidden', !visible);
      if (persist !== false) { try { localStorage.setItem('cjs-pal-hidden', visible ? '0' : '1'); } catch (e) {} }
      relayout();
      A.onPaletteVisible(visible);
    }
    window.cjsPalette = {
      toggle: function () { setVisible(!visible); },
      show: function () { setVisible(true); },
      hide: function () { setVisible(false); },
      isVisible: function () { return visible; }
    };

    function renderItems() {
      itemRow.textContent = '';
      cats[current].items.forEach(function (it) {
        var b = document.createElement('button'); b.className = 'chip';
        b.textContent = it.label; b.dataset.id = it.id;
        b.onclick = function () { sim.selectTool(it.id); sync(); };
        itemRow.appendChild(b);
      });
      itemRow.scrollLeft = 0;
      sync();
    }
    function sync() {
      var act = sim.getActiveTool();
      Array.prototype.forEach.call(itemRow.children, function (b) { b.classList.toggle('sel', b.dataset.id === act); });
      if (act !== lastTool) {
        lastTool = act;
        A.onTool(act, byId[act] ? byId[act].label : act);
      }
    }
    var tabBtns = cats.map(function (c, i) {
      var b = document.createElement('button'); b.className = 'tab'; b.textContent = c.name;
      b.onclick = function () { current = i; refreshTabs(); renderItems(); };
      tabRow.appendChild(b); return b;
    });
    var closeBtn = document.createElement('button'); closeBtn.className = 'close';
    closeBtn.textContent = '\u2715'; closeBtn.title = 'Hide components';
    closeBtn.onclick = function () { setVisible(false); };
    tabRow.appendChild(closeBtn);
    function refreshTabs() { tabBtns.forEach(function (b, i) { b.classList.toggle('sel', i === current); }); }

    refreshTabs(); renderItems(); setVisible(visible, false);
    setInterval(sync, 400);
    // The bar's height can change once fonts/layout settle.
    setTimeout(function () { if (visible) relayout(); }, 500);
  }
})();
