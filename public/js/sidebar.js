// Sidebar (W32): one menu button in the top bar opens a sidebar that holds the
// person's name and role, the theme switch and Sign out. Shared by the student,
// driver and admin pages. Add to a page, after the top bar:
//   <script src="js/sidebar.js" defer></script>
// and give the <body> a data-role of "student", "driver" or "admin".
//
// It MOVES the page's own #hello, #signout and the theme button (from theme.js)
// into the sidebar, so the page scripts keep working without any change.
//
// Phone / narrow screen: closed at first. Opens over the page (page dimmed) and
// closes with a tap outside, Escape, the close button, or choosing a link.
// Wide screen (laptop): open as a column next to the page. The same menu button
// collapses or expands it, and the choice is remembered on this device.
(function () {
  "use strict";

  var KEY = "hatud-sidebar";
  // When the account page (W31) exists, set this to "account.html".
  // While it is null, no Account settings link is shown.
  var ACCOUNT_PAGE = null;
  var ROLES = { student: "Student", driver: "Driver", admin: "Admin" };

  var wideQuery = window.matchMedia ? window.matchMedia("(min-width: 900px)") : null;
  function isWide() { return !!(wideQuery && wideQuery.matches); }

  // Wide screens: open unless the person collapsed it before.
  function wantedOpen() {
    if (!isWide()) return false;
    try { return localStorage.getItem(KEY) !== "closed"; } catch (e) { return true; }
  }
  function remember(isOpen) {
    try { localStorage.setItem(KEY, isOpen ? "open" : "closed"); } catch (e) { /* not remembered */ }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  // Leaflet re-measures the map when the window is resized.
  function nudgeMap() {
    var ev;
    try { ev = new Event("resize"); } catch (e) { ev = document.createEvent("Event"); ev.initEvent("resize", true, true); }
    window.dispatchEvent(ev);
  }

  function init() {
    var bar = document.querySelector(".topbar");
    if (!bar || document.getElementById("sidebar")) return;
    var body = document.body;
    var role = body.getAttribute("data-role") || "";

    // --- Menu button (first thing in the top bar) ---
    var menuBtn = el("button", "link-button menu-btn");
    menuBtn.type = "button";
    menuBtn.id = "menu-btn";
    menuBtn.setAttribute("aria-label", "Menu");
    menuBtn.setAttribute("aria-controls", "sidebar");
    menuBtn.setAttribute("aria-expanded", "false");
    menuBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
      '<path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';
    bar.insertBefore(menuBtn, bar.firstChild);

    // --- Sidebar ---
    var backdrop = el("div", "sb-backdrop");
    var nav = el("nav", "sidebar");
    nav.id = "sidebar";
    nav.setAttribute("aria-label", "Menu");

    var head = el("div", "sb-head");
    head.appendChild(el("strong", "", "Menu"));
    var closeBtn = el("button", "link-button sb-close", "\u2715");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close menu");
    head.appendChild(closeBtn);
    nav.appendChild(head);

    // Who is signed in: the page's own #hello (its script fills in the name) + the role.
    var who = el("div", "sb-who");
    var hello = document.getElementById("hello") || el("span");
    hello.id = "hello";
    who.appendChild(hello);
    who.appendChild(el("small", "sb-role", ROLES[role] || ""));
    nav.appendChild(who);

    // Links
    var links = el("ul", "sb-links");
    function addItem(node) {
      var li = document.createElement("li");
      li.appendChild(node);
      links.appendChild(li);
    }
    if (role !== "admin" && ACCOUNT_PAGE) {
      var account = el("a", "sb-link", "Account settings");
      account.href = ACCOUNT_PAGE;
      addItem(account);
    }
    if (role === "admin") {
      var tabsLink = el("button", "sb-link", "Admin tabs");
      tabsLink.type = "button";
      tabsLink.addEventListener("click", function () {
        var tabs = document.getElementById("tabs");
        if (!tabs) return;
        if (!isWide()) setOpen(false, false);
        tabs.scrollIntoView();
        var first = tabs.querySelector("button");
        if (first) first.focus();
      });
      addItem(tabsLink);
    }
    if (links.children.length) nav.appendChild(links);

    // Theme switch: the button made by theme.js moves here.
    var themeRow = el("div", "sb-row");
    themeRow.appendChild(el("span", "sb-label", "Theme"));
    var themeName = el("span", "sb-value");
    themeRow.appendChild(themeName);
    nav.appendChild(themeRow);

    // Sign out (the page's own button, with its click handler)
    var foot = el("div", "sb-foot");
    var signout = document.getElementById("signout");
    if (signout) foot.appendChild(signout);
    nav.appendChild(foot);

    document.body.appendChild(backdrop);
    document.body.appendChild(nav);

    // theme.js adds its button when the page has loaded; take it in as soon as it exists.
    function takeThemeButton() {
      var btn = document.querySelector(".topbar .theme-btn");
      if (!btn) return false;
      themeRow.appendChild(btn);
      function showName() {
        var m = /Theme: (\w+)/.exec(btn.getAttribute("aria-label") || "");
        themeName.textContent = m ? m[1] : "";
      }
      showName();
      if (window.MutationObserver) {
        new MutationObserver(showName).observe(btn, { attributes: true, attributeFilter: ["aria-label"] });
      }
      return true;
    }
    if (!takeThemeButton()) setTimeout(takeThemeButton, 50);

    // --- Open / close ---
    var open = false;

    function render() {
      body.classList.toggle("sb-docked", open && isWide());
      body.classList.toggle("sb-overlay", open && !isWide());
      nav.classList.toggle("sb-open", open);
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    }

    function setOpen(next, moveFocus) {
      open = next;
      if (isWide()) remember(open);
      render();
      nudgeMap();
      if (!isWide() && moveFocus !== false) {
        if (open) closeBtn.focus(); else menuBtn.focus();
      }
    }

    menuBtn.addEventListener("click", function () { setOpen(!open); });
    closeBtn.addEventListener("click", function () { setOpen(false); });
    backdrop.addEventListener("click", function () { setOpen(false); });

    // Choosing a link closes the sidebar over the page (not the docked column).
    links.addEventListener("click", function (e) {
      if (!isWide() && e.target && e.target.tagName === "A") setOpen(false, false);
    });

    document.addEventListener("keydown", function (e) {
      if (!open || isWide()) return;
      if (e.key === "Escape" || e.key === "Esc") {
        setOpen(false);
        return;
      }
      // Keep Tab inside the sidebar while it covers the page.
      if (e.key === "Tab") {
        var items = nav.querySelectorAll("a[href], button:not([disabled])");
        if (!items.length) return;
        var first = items[0];
        var last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    // Phone turned sideways, window resized: pick the right state for the new width.
    function onWidthChange() {
      open = wantedOpen();
      render();
      nudgeMap();
    }
    if (wideQuery) {
      if (wideQuery.addEventListener) wideQuery.addEventListener("change", onWidthChange);
      else if (wideQuery.addListener) wideQuery.addListener(onWidthChange);
    }

    open = wantedOpen();
    render();
    if (open) nudgeMap();
  }

  // Start after theme.js has made its button (its DOMContentLoaded handler was
  // added first, so ours runs second). theme.js puts that button next to #signout
  // in the top bar, so #signout must still be there when it does.
  if (document.readyState === "complete") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
