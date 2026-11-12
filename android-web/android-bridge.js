// Glue between the CircuitJS web app and the Android shell (MainActivity.kt).
(function () {
  var A = window.AndroidBridge;
  if (!A) return;

  // Tell the native toolbar when the simulation starts/stops.
  var lastRunning = null;
  window.oncircuitjsloaded = function (sim) {
    sim.onupdate = function (s) {
      var r = !!s.isRunning();
      if (r !== lastRunning) { lastRunning = r; A.onRunState(r); }
    };
    A.onSimLoaded();
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
})();
