// Home page: a signed-in visitor sees "Open Hatud" instead of Log in and Sign up.
import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// Remember that this device has seen the home page (used by login.html, v0.182).
try { localStorage.setItem("hatudSeenHome", "1"); } catch (e) {}

const guest = document.getElementById("guest-actions");
const member = document.getElementById("member-actions");

// Fresh open of the app or the site (v0.183): a signed-in person goes straight to his own page.
// Coming from another Hatud page (for example a Home link) still shows this page.
function freshOpen() {
  const ref = document.referrer || ""; // empty or android-app://... when the app is launched
  return !ref.startsWith(location.origin);
}

onAuthStateChanged(auth, async (user) => {
  guest.classList.toggle("hidden", !!user);
  member.classList.toggle("hidden", !user);
  if (!user || !freshOpen()) return;
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (snap.exists()) {
      location.replace(snap.data().role === "driver" ? "driver.html" : "student.html");
    }
  } catch (e) {
    // stay on the home page; the Open Hatud button still works
  }
});
