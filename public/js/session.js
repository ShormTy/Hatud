// Shared by the pages after login: who is signed in, and are they on the right page?
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

// Waits for the login to be known. Sends the person to the log in page if
// nobody is signed in, or to their own page if their role does not match.
// Returns { user, profile } when everything is fine.
export function requireRole(role) {
  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(auth, async (user) => {
      stop();
      try {
        if (!user) {
          location.replace("login.html");
          return;
        }
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!snap.exists()) {
          location.replace("login.html");
          return;
        }
        const profile = snap.data();
        if (profile.role !== role) {
          location.replace(profile.role === "driver" ? "driver.html" : "student.html");
          return;
        }
        resolve({ user, profile });
      } catch (error) {
        reject(error);
      }
    });
  });
}

export async function logOut() {
  await signOut(auth);
  location.replace("login.html");
}

// For a page that both students and drivers use (the account page, W31): waits for the login,
// sends a visitor with no login or no profile to the log in page, and returns { user, profile }.
export function requireMember() {
  return new Promise((resolve, reject) => {
    const stop = onAuthStateChanged(auth, async (user) => {
      stop();
      try {
        if (!user) {
          location.replace("login.html");
          return;
        }
        const snap = await getDoc(doc(db, "users", user.uid));
        if (!snap.exists() || (snap.data().role !== "student" && snap.data().role !== "driver")) {
          location.replace("login.html");
          return;
        }
        resolve({ user, profile: snap.data() });
      } catch (error) {
        reject(error);
      }
    });
  });
}
