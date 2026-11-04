// "Delete my account" (W10b + W10c). The panel lives on the account page (W31); the student and
// driver pages only show the small notice under the top bar while a deletion is waiting.
//
// How it works:
//  1. The person taps "Delete my account". This only STARTS a 24-hour countdown: his profile
//     gets a deleteRequestedAt time. Until then he can use Hatud as usual and can undo it. The
//     wait gives the other person on a recent ride time to report a problem, and the person
//     time to change his mind. The security rules enforce the 24 hours (they refuse the
//     deletion of the profile earlier), so the page cannot skip it.
//  2. After 24 hours he types his password. The page then checks that no ride is open, deletes
//     his data (profile, driver record, finished rides and their private records, appeal), and
//     finally deletes the login itself. A blocked account cannot do any of this (the owner
//     deletes it), so a person cannot dodge a block by deleting his account.
//
// Why several small saves at the end: the rules may look up at most 20 other records in one
// save and every finished ride needs a few. The profile goes in the FIRST save together with
// a few rides; the other rides follow in small saves (the rules allow them because the profile
// is already gone).
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
  updateDoc,
  collection,
  query,
  where,
  writeBatch,
  serverTimestamp,
  deleteField
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const FINISHED = ["completed", "cancelled", "expired"];
const WAIT_MS = 24 * 60 * 60 * 1000; // the same 24 hours as in firestore.rules
const RIDES_PER_SAVE = 3;            // each ride needs up to 4 rule lookups; the limit is 20 per save
const MAX_RIDES = 150;               // far more than a person has in 30 days

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

function whenText(millis) {
  return new Date(millis).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// Two ways to use it (W31):
//  - with `into` (the account page): puts the Delete my account panel inside that element.
//  - without `into` (the student and driver pages): only a small notice under the top bar
//    while a deletion is waiting, with a link to the account page.
export function mountDeleteAccount({ role, user, profile, into }) {
  const showPanel = !!into;
  const panel = make("section", "", "panel");
  panel.id = "delete-panel";
  if (showPanel) into.appendChild(panel);

  let banner = null;
  if (!showPanel) {
    banner = make("section", "", "panel hidden");
    banner.id = "delete-banner";
    const top = document.querySelector("header.topbar");
    if (top && top.parentNode) top.parentNode.insertBefore(banner, top.nextSibling);
  }

  let requestedAt = profile.deleteRequestedAt ? profile.deleteRequestedAt.toDate().getTime() : null;
  let timer = null;

  // ---------- Starting and undoing ----------

  async function start(message) {
    const ok = await confirmBox({
      title: "Delete your account?",
      message: "Your account will be deleted in 24 hours. Until then you can use Hatud as usual and undo it. The wait gives the other person time to report a problem after a ride.",
      okText: "Yes, start the 24 hours",
      cancelText: "No, keep it",
      danger: true
    });
    if (!ok) return;
    try {
      await updateDoc(doc(db, "users", user.uid), { deleteRequestedAt: serverTimestamp() });
      const fresh = await getDoc(doc(db, "users", user.uid));
      const at = fresh.data().deleteRequestedAt;
      requestedAt = at ? at.toDate().getTime() : Date.now();
      render();
    } catch (error) {
      message(error.code === "permission-denied"
        ? "That was refused. Your account may be blocked. Write to " + SUPPORT_EMAIL + "."
        : "Couldn’t start it. Please check your internet and try again.");
    }
  }

  async function undo(message) {
    try {
      await updateDoc(doc(db, "users", user.uid), { deleteRequestedAt: deleteField() });
      requestedAt = null;
      render();
    } catch (error) {
      message("Couldn’t undo it. Please check your internet and try again.");
    }
  }

  // ---------- Finishing ----------

  async function finish(password, message, buttons) {
    if (!password.value) { message("Please type your password."); return; }
    const ok = await confirmBox({
      title: "Delete your account for good?",
      message: "Your profile and your login will be deleted. You can’t get them back.",
      okText: "Yes, delete everything",
      cancelText: "No, keep it",
      danger: true
    });
    if (!ok) return;
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const uid = user.uid;

      // 0. The request must still stand (it may have been undone on another phone).
      const me = await getDoc(doc(db, "users", uid));
      const at = me.exists() && me.data().deleteRequestedAt;
      if (!at) { requestedAt = null; render(); return; }
      requestedAt = at.toDate().getTime();
      if (Date.now() < requestedAt + WAIT_MS) { render(); return; }

      // 1. No open ride.
      let finishedIds = [];
      if (role === "student") {
        const lock = await getDoc(doc(db, "locks", uid));
        if (lock.exists()) { message("You have an open ride request. Cancel it or finish the ride first."); return; }
        const mine = await getDocs(query(collection(db, "rides"), where("studentId", "==", uid)));
        if (mine.docs.some((d) => !FINISHED.includes(d.data().status))) {
          message("You have a ride that is not finished yet. Finish or cancel it first.");
          return;
        }
        finishedIds = mine.docs.map((d) => d.id);
        if (finishedIds.length > MAX_RIDES) {
          message("You have too many ride records to delete here. Please write to " + SUPPORT_EMAIL + ".");
          return;
        }
      } else {
        const mine = await getDocs(query(collection(db, "rides"), where("driverId", "==", uid)));
        if (mine.docs.some((d) => ["accepted", "on_the_way"].includes(d.data().status))) {
          message("You have a ride in progress. Finish it or release it first.");
          return;
        }
      }

      // 2. The password again (Firebase wants a recent login before deleting an account).
      try {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password.value));
      } catch (error) {
        message(error.code === "auth/too-many-requests"
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
        if (groups.length > 1) message("Deleting… " + (i + 1) + " of " + groups.length);
        try {
          await batch.commit();
        } catch (error) {
          if (i === 0) {
            // Nothing was deleted yet: the person can try again.
            message(error.code === "permission-denied"
              ? "The deletion was refused. Your phone’s clock may be ahead, or your account may be blocked or have an open ride. Try again in a little while, or write to " + SUPPORT_EMAIL + "."
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
      buttons.forEach((b) => { b.disabled = false; });
    }
  }

  // ---------- Drawing ----------

  function messageLine() {
    const line = make("p", "", "hint hidden");
    const show = (text) => { line.textContent = text; line.classList.remove("hidden"); };
    return { line, show };
  }

  function drawBanner() {
    if (!banner) return;
    banner.textContent = "";
    const pending = requestedAt !== null && profile.blocked !== true;
    banner.classList.toggle("hidden", !pending);
    if (!pending) return;
    const ready = requestedAt + WAIT_MS;
    const text = Date.now() < ready
      ? "Your account will be deleted on " + whenText(ready) + ". You can undo this on your account page."
      : "The 24 hours are over. You can finish deleting your account, or undo it, on your account page.";
    banner.appendChild(make("p", text, "ride-line"));
    // Only a link: the Undo button and the password step are on the account page.
    const jump = make("a", "Go to Account settings");
    jump.href = "account.html#delete-panel";
    banner.appendChild(jump);
  }

  function render() {
    clearTimeout(timer);
    if (!showPanel) {
      // Only the notice: draw it again when the 24 hours are over.
      drawBanner();
      if (requestedAt !== null && profile.blocked !== true && Date.now() < requestedAt + WAIT_MS) {
        timer = setTimeout(render, Math.min(requestedAt + WAIT_MS - Date.now() + 1000, 2147483647));
      }
      return;
    }
    panel.textContent = "";
    panel.appendChild(make("h2", "Delete my account", "panel-title"));

    if (profile.blocked === true) {
      panel.appendChild(make("p", "A blocked account can’t be deleted here. Write to " + SUPPORT_EMAIL + " if you want it deleted.", "hint"));
      return;
    }

    const note = messageLine();

    if (requestedAt === null) {
      panel.appendChild(make("p", "You can delete your account and your data for good. It is deleted 24 hours after you ask, and you can undo it until then. It deletes your profile, " +
        (role === "driver" ? "your vehicle details, " : "your finished rides, ") +
        "and your login, and it can’t be undone afterwards.", "hint"));
      const open = make("button", "Delete my account", "secondary");
      open.type = "button";
      open.onclick = () => start(note.show);
      panel.appendChild(open);
      panel.appendChild(note.line);
      return;
    }

    const ready = requestedAt + WAIT_MS;
    const keep = make("button", "Undo and keep my account", "secondary");
    keep.type = "button";
    keep.onclick = () => undo(note.show);

    if (Date.now() < ready) {
      panel.appendChild(make("p", "Your account will be deleted on " + whenText(ready) + ". Until then you can use Hatud as usual. The 24 hours give the other person on a recent ride time to report a problem.", "hint"));
      panel.appendChild(keep);
      panel.appendChild(note.line);
      timer = setTimeout(render, Math.min(ready - Date.now() + 1000, 2147483647));
      return;
    }

    panel.appendChild(make("p", "The 24 hours are over. Type your password to delete your account for good, or undo it.", "hint"));
    const label = make("label", "Type your password to confirm");
    const password = document.createElement("input");
    password.type = "password";
    password.id = "delete-password";
    password.autocomplete = "current-password";
    label.htmlFor = "delete-password";
    const go = make("button", "Delete everything", "primary danger");
    go.type = "button";
    go.onclick = () => { note.line.classList.add("hidden"); finish(password, note.show, [go, keep]); };
    [label, password, note.line, go, keep].forEach((el) => panel.appendChild(el));
  }

  render();
}
