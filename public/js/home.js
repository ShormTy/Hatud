// Home page: a signed-in visitor sees "Open Hatud" instead of Log in and Sign up.
import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";

// Remember that this device has seen the home page (used by login.html, v0.182).
try { localStorage.setItem("hatudSeenHome", "1"); } catch (e) {}

const guest = document.getElementById("guest-actions");
const member = document.getElementById("member-actions");

onAuthStateChanged(auth, (user) => {
  guest.classList.toggle("hidden", !!user);
  member.classList.toggle("hidden", !user);
});
