// Extra motion on every page (W17d). Add <script src="js/motion.js"></script> in the <head>
// of every page, right after theme.js. All the looks are in css/app.css (the W17d block).
// Nothing here is saved or sent anywhere. When the phone asks for reduced motion, it does
// nothing at all and the page simply stays still.
(function () {
  var reduce = false;
  try {
    reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch (e) { reduce = true; }
  if (reduce) return;

  // Lets the CSS hide the home page cards until they scroll into view. Only when the browser
  // can really watch the scrolling, so a card can never stay invisible.
  if ("IntersectionObserver" in window) document.documentElement.classList.add("motion-ok");

  function start() {
    // 7. The theme button spins when tapped (it can move into the sidebar, so listen on the page).
    document.addEventListener("click", function (event) {
      var target = event.target;
      var button = target && target.closest ? target.closest(".theme-btn") : null;
      if (!button) return;
      button.classList.remove("spin");
      void button.offsetWidth; // lets the animation start again on a quick second tap
      button.classList.add("spin");
      button.addEventListener("animationend", function done() {
        button.classList.remove("spin");
        button.removeEventListener("animationend", done);
      });
    });

    // 1. Cards and panels that are on the page now rise in one after another (at most 5 steps).
    var count = 0;
    var first = document.querySelectorAll("main > .card:not(.section), .panel");
    for (var i = 0; i < first.length; i++) {
      if (first[i].offsetParent === null) continue; // hidden now: it rises when it appears
      first[i].style.setProperty("--rise-delay", Math.min(count, 5) * 70 + "ms");
      count++;
    }

    // 2. Home page cards fade in when they come into view.
    var sections = document.querySelectorAll("main > .card.section");
    if (!sections.length) return;
    if (!document.documentElement.classList.contains("motion-ok")) return;
    var seen = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("reveal-in");
        seen.unobserve(entry.target);
      });
    }, { threshold: 0.12 });
    for (var j = 0; j < sections.length; j++) {
      var card = sections[j];
      // Cards already on the screen follow the first ones; the others come in when scrolled to.
      if (card.getBoundingClientRect().top < window.innerHeight) {
        card.style.setProperty("--rise-delay", Math.min(count, 5) * 70 + "ms");
        count++;
      }
      seen.observe(card);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
