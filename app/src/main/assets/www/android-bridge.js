// Glue between the CircuitJS web app and the Android shell (MainActivity.kt).
(function () {
  var A = window.AndroidBridge || { onRunState: function(){}, onSimLoaded: function(){}, saveBase64: function(){} };

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
  // Touch palette: every item of the Draw menu as big, scrollable chips at the top.
  // Data comes from CircuitJS1.getPalette(); tapping a chip calls CircuitJS1.selectTool(id).
  // ------------------------------------------------------------------------------------
  var CAT_NAMES = {
    'Passive Components': 'Passive', 'Inputs and Sources': 'Sources', 'Outputs and Labels': 'Outputs',
    'Active Components': 'Active', 'Active Building Blocks': 'Blocks',
    'Logic Gates, Input and Output': 'Gates', 'Digital Chips': 'Chips',
    'Analog and Hybrid Chips': 'Analog', 'Move': 'Move / Select'
  };
  var COMMON = ['Select', 'WireElm', 'ResistorElm', 'CapacitorElm', 'InductorElm', 'GroundElm',
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
    cats.unshift({ name: '\u2605 Common', items: common });

    var css = document.createElement('style');
    css.textContent =
      ':root{--pal-bg:#f1f3f5;--pal-fg:#1a1c1e;--pal-chip:#fff;--pal-line:#b8bec5;--pal-acc:#0E7490}' +
      '@media(prefers-color-scheme:dark){:root{--pal-bg:#23272b;--pal-fg:#e6e8ea;--pal-chip:#33393e;--pal-line:#4a5258;--pal-acc:#22b8d6}}' +
      '#cjs-pal{position:fixed;top:0;left:0;right:0;z-index:50;background:var(--pal-bg);color:var(--pal-fg);' +
      'border-bottom:1px solid var(--pal-line);font:14px Roboto,Arial,sans-serif;-webkit-user-select:none;user-select:none}' +
      '#cjs-pal .row{display:flex;gap:6px;overflow-x:auto;padding:6px 8px;scrollbar-width:none;align-items:center}' +
      '#cjs-pal .row::-webkit-scrollbar{display:none}' +
      '#cjs-pal button{flex:none;height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--pal-line);' +
      'background:var(--pal-chip);color:var(--pal-fg);font:inherit;white-space:nowrap}' +
      '#cjs-pal button.sel{background:var(--pal-acc);border-color:var(--pal-acc);color:#fff}' +
      '#cjs-pal button.cat{height:30px;border-radius:6px;font-weight:600}' +
      '#cjs-pal button.tog{width:36px;padding:0;border-radius:6px;position:sticky;left:0}' +
      '#cjs-pal.collapsed .items,#cjs-pal.collapsed .cat{display:none}' +
      'body.cjs-has-pal{position:fixed;left:0;right:0;bottom:0;margin:0}';
    document.head.appendChild(css);

    var bar = document.createElement('div'); bar.id = 'cjs-pal';
    var catRow = document.createElement('div'); catRow.className = 'row';
    var itemRow = document.createElement('div'); itemRow.className = 'row items';
    bar.appendChild(catRow); bar.appendChild(itemRow);
    document.body.appendChild(bar);
    document.body.classList.add('cjs-has-pal');

    var tog = document.createElement('button'); tog.className = 'tog'; catRow.appendChild(tog);
    var current = 0, collapsed = false;
    try { collapsed = localStorage.getItem('cjs-pal-collapsed') === '1'; } catch (e) {}

    function layout() {
      document.body.style.top = bar.offsetHeight + 'px';
      window.dispatchEvent(new Event('resize'));   // make the simulator re-measure its canvas
    }
    function renderItems() {
      itemRow.textContent = '';
      cats[current].items.forEach(function (it) {
        var b = document.createElement('button'); b.textContent = it.label; b.dataset.id = it.id;
        b.onclick = function () { sim.selectTool(it.id); sync(); };
        itemRow.appendChild(b);
      });
      sync();
    }
    function sync() {
      var act = sim.getActiveTool();
      Array.prototype.forEach.call(itemRow.children, function (b) { b.classList.toggle('sel', b.dataset.id === act); });
    }
    var catBtns = cats.map(function (c, i) {
      var b = document.createElement('button'); b.className = 'cat'; b.textContent = c.name;
      b.onclick = function () { current = i; refreshCats(); renderItems(); };
      catRow.appendChild(b); return b;
    });
    function refreshCats() { catBtns.forEach(function (b, i) { b.classList.toggle('sel', i === current); }); }
    function applyCollapsed() {
      bar.classList.toggle('collapsed', collapsed);
      tog.textContent = collapsed ? '\u25BC' : '\u25B2';
      tog.title = collapsed ? 'Show components' : 'Hide components';
      layout();
    }
    tog.onclick = function () {
      collapsed = !collapsed;
      try { localStorage.setItem('cjs-pal-collapsed', collapsed ? '1' : '0'); } catch (e) {}
      applyCollapsed();
    };
    refreshCats(); renderItems(); applyCollapsed();
    setInterval(sync, 500);
  }
})();
