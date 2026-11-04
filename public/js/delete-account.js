// "Delete my account" (W10b), shown at the bottom of the student and driver pages.
// It asks for the password again, checks that no ride is open, deletes the person's data
// (profile, driver record, finished rides and their private records, appeal), and then
// deletes the login itself. A blocked account cannot use it (the owner deletes it).
//
// Why several small saves: the security rules may look up at most 20 other records in one
// save, and every finished ride needs a few lookups. So the profile goes in the FIRST save
// together with a few rides; the rest of the rides follow in small saves (the rules allow
// them because the profile is already gone).
import { auth, db } from "./firebase.js";
import { confirmBox } from "./dialog.js";
import { SUPPORT_EMAIL } from "./support.js";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  deleteUser,
  signOut
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const FINISHED = ["completed", "cancelled", "expired"];
const RIDES_PER_SAVE = 3;   // each ride needs up to 4 rule lookups; the limit is 20 per save
const MAX_RIDES = 150;      // far more than a person has in 30 days

// Splits the rides into saves: the first save also carries the profile, so it is the first group.
export function planSaves(rideIds, perSave = RIDES_PER_SAVE) {
  const groups = [];
  for (let i = 0; i < rideIds.length; i += perSave) groups.push(rideIds.slice(i, i + perSave));
  if (groups.length === 0) groups.push([]);
  return groups;
}

function make(tag, text, className) {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (className) el.className = className;
  return el;
}

// Adds the panel after the feedback panel (the last panel of the page).
export function mountDeleteAccount({ role, user, profile }) {
  const link = document.getElementById("feedback-link");
  const anchor = link && link.closest("section");
  const panel = make("section", "", "panel");
  panel.id = "delete-panel";
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor.nextSibling);
  else document.body.appendChild(panel);

  panel.appendChild(make("h2", "My account", "panel-title"));

  if (profile.blocked === true) {
    panel.appendChild(make("p", "A blocked account can’t be deleted here. Write to " + SUPPORT_EMAIL + " if you want it deleted.", "hint"));
    return;
  }

  const intro = make("p", "You can delete your account and your data for good. This deletes your profile, " +
    (role === "driver" ? "your vehicle details, " : "your finished rides, ") +
    "and your login. It can’t be undone.", "hint");
  const open = make("button", "Delete my account", "secondary");
  open.type = "button";

  const form = make("div", "", "hidden");
  const label = make("label", "Type your password to confirm");
  const password = document.createElement("input");
  password.type = "password";
  password.id = "delete-password";
  password.autocomplete = "current-password";
  label.htmlFor = "delete-password";
  const message = make("p", "", "hint hidden");
  const go = make("button", "Delete everything", "primary danger");
  go.type = "button";
  const cancel = make("button", "Cancel", "secondary");
  cancel.type = "button";
  [label, password, message, go, cancel].forEach((el) => form.appendChild(el));

  open.onclick = () => { form.classList.remove("hidden"); open.classList.add("hidden"); password.focus(); };
  cancel.onclick = () => {
    form.classList.add("hidden");
    open.classList.remove("hidden");
    password.value = "";
    message.classList.add("hidden");
  };

  function problem(text) {
    message.textContent = text;
    message.classList.remove("hidden");
  }

  go.onclick = async () => {
    message.classList.add("hidden");
    if (!password.value) { problem("Please type your password."); return; }
    const ok = await confirmBox({
      title: "Delete your account for good?",
      message: "Your profile and your login will be deleted. You can’t get them back.",
      okText: "Yes, delete everything",
      cancelText: "No, keep it",
      danger: true
    });
    if (!ok) return;
    go.disabled = true;
    cancel.disabled = true;
    try {
      const uid = user.uid;

      // 1. No open ride.
      let finishedIds = [];
      if (role === "student") {
        const lock = await getDoc(doc(db, "locks", uid));
        if (lock.exists()) { problem("You have an open ride request. Cancel it or finish the ride first."); return; }
        const mine = await getDocs(query(collection(db, "rides"), where("studentId", "==", uid)));
        if (mine.docs.some((d) => !FINISHED.includes(d.data().status))) {
          problem("You have a ride that is not finished yet. Finish or cancel it first.");
          return;
        }
        finishedIds = mine.docs.map((d) => d.id);
        if (finishedIds.length > MAX_RIDES) {
          problem("You have too many ride records to delete here. Please write to " + SUPPORT_EMAIL + ".");
          return;
        }
      } else {
        const mine = await getDocs(query(collection(db, "rides"), where("driverId", "==", uid)));
        if (mine.docs.some((d) => ["accepted", "on_the_way"].includes(d.data().status))) {
          problem("You have a ride in progress. Finish it or release it first.");
          return;
        }
      }

      // 2. The password again (Firebase wants a recent login before deleting an account).
      try {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password.value));
      } catch (error) {
        problem(error.code === "auth/too-many-requests"
          ? "Too many tries. Please wait a few minutes and try again."
          : "That password is not right.");
        return;
      }

      // 3. The data. The first save has the profile; later saves only have rides.
      const groups = planSaves(finishedIds);
      let leftover = 0;
      for (let i = 0; i < groups.length; i++) {
        const batch = writeBatch(db);
        groups[i].forEach((rideId) => {
          batch.delete(doc(db, "rides", rideId, "private", "student"));
          batch.delete(doc(db, "rides", rideId));
        });
        if (i === 0) {
          if (role === "driver") batch.delete(doc(db, "drivers", uid));
          batch.delete(doc(db, "appeals", uid));
          batch.delete(doc(db, "users", uid));
        }
        if (groups.length > 1) problem("Deleting… " + (i + 1) + " of " + groups.length);
        try {
          await batch.commit();
        } catch (error) {
          if (i === 0) {
            // Nothing was deleted yet: the person can try again.
            problem(error.code === "permission-denied"
              ? "The deletion was refused. Your account may be blocked or have an open ride. Write to " + SUPPORT_EMAIL + "."
              : "Couldn’t delete. Please check your internet and try again.");
            return;
          }
          leftover += groups[i].length; // the profile is already gone; the owner can clear the rest
        }
      }

      // 4. The login itself (one more try if the first one fails).
      let loginGone = true;
      try {
        await deleteUser(auth.currentUser);
      } catch (error) {
        try {
          await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(user.email, password.value));
          await deleteUser(auth.currentUser);
        } catch (second) {
          loginGone = false;
        }
      }
      if (!loginGone) { try { await signOut(auth); } catch (ignored) { /* nothing more to do */ } }

      let finalText = "Your account was deleted. Goodbye, and thank you for trying Hatud.";
      if (!loginGone) {
        finalText = "Your data was deleted, but the login could not be removed. Please write to " + SUPPORT_EMAIL + " to finish.";
      } else if (leftover > 0) {
        finalText += " " + leftover + " old ride record(s) could not be deleted; please write to " + SUPPORT_EMAIL + " if you want them cleared.";
      }
      window.alert(finalText);
      location.replace("index.html");
    } finally {
      go.disabled = false;
      cancel.disabled = false;
    }
  };

  [intro, open, form].forEach((el) => panel.appendChild(el));
}
