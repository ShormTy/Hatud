// Alerts while the page is open: a short beep, a vibration and a changed tab title.
// Nothing is saved and nothing is sent anywhere. Real push messages (phone locked or the app
// closed) need a server, which is not free, so Hatud does not use them.

let audio = null;
let baseTitle = document.title;
let titleChanged = false;

// Browsers only allow sound after the person has touched the page once, so the sound is
// switched on at the first tap or key press.
function unlockAudio() {
  try {
    if (!audio) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audio = new Ctx();
    }
    if (audio.state === "suspended") audio.resume();
  } catch (error) {
    // No sound on this phone. The vibration and the title still work.
  }
}
["pointerdown", "touchstart", "keydown"].forEach((name) => {
  window.addEventListener(name, unlockAudio, { passive: true });
});

function beep() {
  try {
    if (!audio || audio.state !== "running") return;
    const now = audio.currentTime;
    [[880, 0], [1175, 0.2]].forEach(([freq, delay]) => {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.25, now + delay + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.18);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.2);
    });
  } catch (error) {
    // Ignore: an alert must never break the page.
  }
}

function buzz() {
  try {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
  } catch (error) {
    // Ignore.
  }
}

// While the tab is hidden, the title says what happened. It goes back when the person returns.
function markTitle(text) {
  if (!document.hidden) return;
  if (!titleChanged) baseTitle = document.title;
  document.title = "\uD83D\uDD14 " + text + " \u2013 Hatud";
  titleChanged = true;
}

function restoreTitle() {
  if (!titleChanged || document.hidden) return;
  document.title = baseTitle;
  titleChanged = false;
}
document.addEventListener("visibilitychange", restoreTitle);
window.addEventListener("focus", restoreTitle);

export function alertUser(text) {
  beep();
  buzz();
  markTitle(text);
}
