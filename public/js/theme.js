// Light / dark switch (W16). Add <script src="js/theme.js"></script> in the <head> of every page.
// Modes: auto (follows the phone), light, dark. The choice is remembered on this phone.
(function () {
  var KEY = "hatud-theme";
  var MODES = ["auto", "light", "dark"];
  var ICONS = { auto: "\u25D0", light: "\u2600", dark: "\u263E" };
  var NAMES = { auto: "Auto", light: "Light", dark: "Dark" };

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return MODES.indexOf(v) >= 0 ? v : "auto";
    } catch (e) { return "auto"; }
  }

  function systemIsDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function apply(mode) {
    var root = document.documentElement;
    if (mode === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
    var dark = mode === "dark" || (mode === "auto" && systemIsDark());
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#11171d" : "#f4f6f8");
  }

  var mode = read();
  apply(mode);

  if (window.matchMedia) {
    try {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
        if (read() === "auto") apply("auto");
      });
    } catch (e) { /* old browser: the switch still works */ }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.createElement("button");
    btn.type = "button";

    function paint() {
      btn.textContent = ICONS[mode];
      var label = "Theme: " + NAMES[mode] + ". Tap to change.";
      btn.setAttribute("aria-label", label);
      btn.title = label;
    }

    btn.addEventListener("click", function () {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      try { localStorage.setItem(KEY, mode); } catch (e) { /* private mode: not remembered */ }
      apply(mode);
      paint();
    });

    var bar = document.querySelector(".topbar");
    if (bar) {
      btn.className = "link-button theme-btn";
      bar.insertBefore(btn, document.getElementById("signout"));
    } else {
      btn.className = "theme-btn theme-fixed";
      document.body.appendChild(btn);
    }
    paint();
  });
})();
