// Keeps the driver's screen on while he has a ride (the Screen Wake Lock).
// Phones that do not support it, or are in battery saver, simply skip it.
let sentinel = null;
let wanted = false;

async function acquire() {
  if (!wanted || sentinel || !("wakeLock" in navigator)) return;
  try {
    sentinel = await navigator.wakeLock.request("screen");
    sentinel.addEventListener("release", () => { sentinel = null; });
  } catch (error) {
    sentinel = null; // refused (for example battery saver): nothing more to do
  }
}

export function keepScreenOn(on) {
  wanted = on;
  if (on) {
    acquire();
  } else if (sentinel) {
    sentinel.release().catch(() => {});
    sentinel = null;
  }
}

// The browser drops the lock when the page is hidden, so ask again when it is back.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") acquire();
});
