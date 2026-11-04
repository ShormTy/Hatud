// Admin page for the owner: approve drivers, block accounts, read reports and appeals.
// Anyone can open this page, but the rules show data only to a signed-in admin
// (a document at admins/{uid} that the owner makes by hand in the Firebase console).
import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  updateDoc,
  setDoc,
  deleteDoc,
  deleteField,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";
import { accountState, STATE_LABELS } from "./account-state.js";

const byId = (id) => document.getElementById(id);
const REASONS = {
  unreasonable_fare: "Unreasonable fare",
  unsafe_or_rude: "Unsafe or rude",
  no_show: "Did not show up",
  wrong_vehicle: "Wrong vehicle or plate",
  refused_to_pay: "Refused to pay",
  other: "Something else",
  // reasons for reports about the app (W22)
  app_bug: "Something is broken (a bug)",
  map_wrong: "The map or the route is wrong",
  slow_or_stuck: "The app is slow or stuck",
  confusing: "Something is confusing"
};

let users = new Map();
let drivers = new Map();
let reports = [];
let admins = new Set();
let removed = new Map();
let tallies = new Map(); // reportTally: uid -> { reporters: [ids of DIFFERENT people who reported him] }
let appeals = new Map(); // appeals: uid -> { message, status, createdAt }
let notes = new Map(); // accountNotes (W27c): uid -> { text, updatedAt }
let tab = "todo";
let filter = "all"; // the chip chosen on the Users tab

// Everything people typed is shown with textContent, never as HTML.
function el(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== null && text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function line(label, value) {
  const p = el("p", null, "ride-line");
  p.append(el("strong", label + " "), document.createTextNode(value || "-"));
  return p;
}

function button(text, cls, onClick) {
  const b = el("button", text, cls);
  b.type = "button";
  b.onclick = onClick;
  return b;
}

const when = (t) => (t && t.toDate ? t.toDate().toLocaleString() : "");
// A stand-in for a server time that was just saved, so the page can show it before the next Refresh.
const justNow = () => ({ toDate: () => new Date(), toMillis: () => Date.now() });

function who(uid) {
  const u = users.get(uid);
  return u ? u.name + " (" + u.role + ", " + u.contactNumber + ")" : uid;
}

function say(text) {
  const s = byId("status");
  s.textContent = text;
  s.classList.toggle("hidden", !text);
}

// Asks first (if a question is given), saves, then redraws the page.
async function change(task, ask) {
  if (ask && !window.confirm(ask)) return;
  try {
    await task();
    say("");
  } catch (error) {
    say("Could not save (" + (error.code || "error") + "). Press Refresh and try again.");
  }
  render();
}

const setBlocked = (uid, value) => change(async () => {
  if (value) {
    await updateDoc(doc(db, "users", uid), { blocked: true, blockedBy: "owner", blockedAt: serverTimestamp() });
    users.get(uid).blocked = true;
    users.get(uid).blockedBy = "owner";
    users.get(uid).blockedAt = justNow();
  } else {
    // Unblocking also clears the list of people who reported him (so one new report does not
    // block him again at once) and closes his appeal.
    const batch = writeBatch(db);
    batch.update(doc(db, "users", uid), { blocked: false, blockedBy: deleteField(), blockedAt: deleteField() });
    batch.delete(doc(db, "reportTally", uid));
    batch.delete(doc(db, "appeals", uid));
    await batch.commit();
    users.get(uid).blocked = false;
    delete users.get(uid).blockedBy;
    delete users.get(uid).blockedAt;
    tallies.delete(uid);
    appeals.delete(uid);
  }
}, value
  ? "Block " + who(uid) + "?"
  : "Unblock " + who(uid) + "?\n\nThis also clears the count of people who reported this person and closes his appeal.");

const denyAppeal = (uid) => change(async () => {
  await updateDoc(doc(db, "appeals", uid), { status: "denied" });
  appeals.get(uid).status = "denied";
}, "Deny the appeal of " + who(uid) + "? He stays blocked and cannot send another appeal until you delete this one.");

const deleteAppeal = (uid) => change(async () => {
  await deleteDoc(doc(db, "appeals", uid));
  appeals.delete(uid);
}, "Delete the appeal of " + who(uid) + "? If he is still blocked, he can send a new appeal.");

const setApproval = (uid, status) => change(async () => {
  await updateDoc(doc(db, "drivers", uid), status === "approved"
    ? { approvalStatus: status, approvedAt: serverTimestamp() }
    : { approvalStatus: status, approvedAt: deleteField() });
  drivers.get(uid).approvalStatus = status;
  if (status === "approved") drivers.get(uid).approvedAt = justNow();
  else delete drivers.get(uid).approvedAt;
}, status === "approved"
  ? "Approve " + who(uid) + "? Only do this after you checked the papers and the vehicle in person."
  : "Set " + who(uid) + " back to pending? They will not see ride requests until you approve again.");

// Removes the profile (users) and, for a driver, the driver record.
// The login in Firebase Authentication stays: only the console can delete it.
async function removePerson(uid) {
  if (admins.has(uid)) { say("An admin cannot be removed here."); return; }
  let done = false;
  await change(async () => {
    // A small note is kept in removedUsers so the person stays on the Removed tab after a refresh.
    const u = users.get(uid) || {};
    const d = drivers.get(uid);
    const note = { name: u.name || "", role: u.role || "", contactNumber: u.contactNumber || "" };
    if (u.school) note.school = u.school;
    if (d) { note.vehicleType = d.vehicleType; note.plateNumber = d.plateNumber; }
    const batch = writeBatch(db);
    batch.set(doc(db, "removedUsers", uid), { ...note, removedAt: serverTimestamp() });
    batch.delete(doc(db, "users", uid));
    if (d) batch.delete(doc(db, "drivers", uid));
    batch.delete(doc(db, "reportTally", uid));
    batch.delete(doc(db, "appeals", uid));
    batch.delete(doc(db, "accountNotes", uid));
    await batch.commit();
    removed.set(uid, { ...note, removedAt: { toDate: () => new Date() } });
    users.delete(uid);
    drivers.delete(uid);
    tallies.delete(uid);
    appeals.delete(uid);
    notes.delete(uid);
    done = true;
  }, "Remove " + who(uid) + "?\n\nThis deletes the profile (and the driver record). The login stays in Firebase Authentication, so the email stays taken until you delete it there. To keep someone out for good, use Block instead.");
  if (done) say("Removed. UID: " + uid + ". To free the email: Firebase console, Authentication, Users, three dots, Delete account.");
}

// Deletes the note too, once the login is gone from Firebase Authentication.
const forgetRemoved = (uid) => change(async () => {
  await deleteDoc(doc(db, "removedUsers", uid));
  removed.delete(uid);
}, "Forget " + (removed.get(uid).name || uid) + "?\n\nOnly do this after you deleted the login in Firebase Authentication (Users, three dots, Delete account). This deletes the note for good.");

function removedCard(uid, n) {
  const card = el("div", null, "history-item");
  card.append(el("p", n.name || uid, "panel-title"));
  card.append(line("Role:", n.role));
  if (n.school) card.append(line("School:", n.school));
  if (n.vehicleType) card.append(line("Vehicle:", n.vehicleType + ", plate " + n.plateNumber));
  card.append(line("Contact:", n.contactNumber));
  card.append(line("Removed:", when(n.removedAt)));
  card.append(line("ID:", uid));
  card.append(el("p", "The login may still exist in Firebase Authentication (the email stays taken until you delete it there).", "hint"));
  card.append(button("Forget (delete this note)", "secondary", () => forgetRemoved(uid)));
  return card;
}

const setReportStatus = (r, status) => change(async () => {
  await updateDoc(doc(db, "reports", r.id), { status });
  r.status = status;
});

const removeReport = (r) => change(async () => {
  await deleteDoc(doc(db, "reports", r.id));
  reports = reports.filter((x) => x.id !== r.id);
}, "Delete this report for good?");

function blockButton(uid, suffix) {
  const u = users.get(uid);
  if (!u) return null;
  return button((u.blocked ? "Unblock" : "Block") + (suffix || ""), "secondary", () => setBlocked(uid, !u.blocked));
}

// Shows how many DIFFERENT people reported this person (the private list the rules keep).
function tallyLine(card, uid) {
  const t = tallies.get(uid);
  if (!t) return;
  const n = (t.reporters || []).length;
  card.append(line("Reported by:", n + " different " + (n === 1 ? "person" : "people")));
  const u = users.get(uid);
  if (n >= 3 && u && !u.blocked) {
    card.append(el("p", "Three or more people reported this person but the automatic block did not finish. Press Block.", "hint"));
  }
}

function blockedWhy(uid, u) {
  const n = ((tallies.get(uid) || {}).reporters || []).length;
  let why = "earlier (no record of who blocked)";
  if (u.blockedBy === "auto") why = "automatically, after reports from " + n + " different " + (n === 1 ? "person" : "people");
  else if (u.blockedBy === "owner") why = "by the owner";
  return why + (u.blockedAt ? ", on " + when(u.blockedAt) : "");
}

function driverCard(uid, d) {
  const u = users.get(uid) || {};
  const card = el("div", null, "history-item");
  card.append(el("p", u.name || uid, "panel-title"));
  card.append(line("Status:", d.approvalStatus + (u.blocked ? " (BLOCKED)" : "")));
  card.append(line("Vehicle:", d.vehicleType + ", plate " + d.plateNumber));
  card.append(line("Contact:", d.contactNumber));
  card.append(line("Signed up:", when(u.createdAt)));
  tallyLine(card, uid);
  card.append(d.approvalStatus === "approved"
    ? button("Set to pending", "secondary", () => setApproval(uid, "pending"))
    : button("Approve", "primary", () => setApproval(uid, "approved")));
  const b = blockButton(uid);
  if (b) card.append(b);
  card.append(button("Remove", "secondary", () => removePerson(uid)));
  return card;
}

function personCard(uid, u, canBlock) {
  const card = el("div", null, "history-item");
  card.append(el("p", u.name, "panel-title"));
  card.append(line("Role:", u.role + (u.blocked ? " (BLOCKED)" : "")));
  if (u.school) card.append(line("School:", u.school));
  card.append(line("Contact:", u.contactNumber));
  card.append(line("Signed up:", when(u.createdAt)));
  card.append(line("ID:", uid));
  tallyLine(card, uid);
  if (canBlock) {
    card.append(blockButton(uid));
    card.append(button("Remove", "secondary", () => removePerson(uid)));
  }
  return card;
}

function blockedCard(uid, u) {
  const card = el("div", null, "history-item");
  card.append(el("p", u.name || uid, "panel-title"));
  card.append(line("Role:", u.role));
  card.append(line("Blocked:", blockedWhy(uid, u)));
  const d = drivers.get(uid);
  if (d) card.append(line("Vehicle:", d.vehicleType + ", plate " + d.plateNumber));
  card.append(line("Contact:", u.contactNumber));
  card.append(line("Reports about this person:", String(reports.filter((r) => r.reportedId === uid).length)));
  const a = appeals.get(uid);
  if (a) {
    card.append(line("Appeal:", (a.status === "denied" ? "denied" : "NEW") + ", sent " + when(a.createdAt)));
    card.append(line("Message:", a.message));
  } else {
    card.append(line("Appeal:", "none"));
  }
  card.append(line("ID:", uid));
  card.append(button("Unblock", "primary", () => setBlocked(uid, false)));
  return card;
}

function appealCard(uid, a) {
  const u = users.get(uid);
  const card = el("div", null, "history-item");
  card.append(el("p", ((u && u.name) || uid) + (a.status === "denied" ? " (denied)" : " (NEW)"), "panel-title"));
  if (u) {
    card.append(line("Role:", u.role));
    card.append(line("Contact:", u.contactNumber));
    card.append(line("Account:", u.blocked ? "blocked, " + blockedWhy(uid, u) : "not blocked"));
  } else {
    card.append(line("Account:", "no profile"));
  }
  card.append(line("Message:", a.message));
  card.append(line("Sent:", when(a.createdAt)));
  card.append(line("ID:", uid));
  if (u && u.blocked) card.append(button("Unblock (accept appeal)", "primary", () => setBlocked(uid, false)));
  if (a.status !== "denied") card.append(button("Deny appeal", "secondary", () => denyAppeal(uid)));
  card.append(button("Delete appeal", "secondary", () => deleteAppeal(uid)));
  if (a.status === "denied") card.append(el("p", "Deleting a denied appeal lets him send a new one.", "hint"));
  return card;
}

// ---------- Deletions: people who asked to delete their account ----------
// The same 24 hours as in firestore.rules and js/delete-account.js.
const DELETE_WAIT_MS = 24 * 60 * 60 * 1000;

function timeLeftText(ms) {
  const hours = Math.ceil(ms / (60 * 60 * 1000));
  return "about " + hours + (hours === 1 ? " hour" : " hours");
}

function deletionCard(uid, u) {
  const dueAt = u.deleteRequestedAt.toMillis() + DELETE_WAIT_MS;
  const left = dueAt - Date.now();
  const card = el("div", null, "history-item");
  card.append(el("p", (u.name || uid) + (left <= 0 ? " (DUE)" : " (waiting)"), "panel-title"));
  card.append(line("Role:", u.role + (u.blocked ? " (BLOCKED)" : "")));
  const d = drivers.get(uid);
  if (d) card.append(line("Vehicle:", d.vehicleType + ", plate " + d.plateNumber));
  if (u.school) card.append(line("School:", u.school));
  card.append(line("Contact:", u.contactNumber));
  card.append(line("Asked on:", when(u.deleteRequestedAt)));
  card.append(line("The 24 hours end:", new Date(dueAt).toLocaleString()));
  card.append(line("Time left:", left <= 0 ? "the 24 hours are over" : timeLeftText(left)));
  card.append(line("ID:", uid));
  if (u.blocked) {
    card.append(el("p", "He is blocked, so he cannot finish deleting his account himself. Unblock him, or remove him.", "hint"));
  } else if (left <= 0) {
    card.append(el("p", "The 24 hours are over. He can finish at the bottom of his page. If he does not come back, press Remove now.", "hint"));
  } else {
    card.append(el("p", "He can still undo it until the 24 hours are over. Remove now unlocks after that.", "hint"));
  }
  const remove = button("Remove now", "secondary", () => removePerson(uid));
  remove.disabled = left > 0 && !u.blocked;
  card.append(remove);
  return card;
}

function reportCard(r) {
  const isApp = r.targetType === "app";
  const card = el("div", null, "history-item");
  card.append(el("p", (isApp ? "About the app: " : "") + (REASONS[r.reason] || r.reason) + (r.status === "new" ? " (NEW)" : " (reviewed)"), "panel-title"));
  if (r.details) card.append(line("Details:", r.details));
  card.append(line("From:", who(r.reporterId)));
  if (!isApp) card.append(line("About:", who(r.reportedId)));
  card.append(line("Sent:", when(r.createdAt)));
  card.append(button(r.status === "new" ? "Mark reviewed" : "Mark new", "secondary",
    () => setReportStatus(r, r.status === "new" ? "reviewed" : "new")));
  if (!isApp) {
    const b = blockButton(r.reportedId, " the reported person");
    if (b) card.append(b);
  }
  card.append(button("Delete report", "secondary", () => removeReport(r)));
  return card;
}

// ---------- W27h: four tabs (To do, Users, Reports, Closed accounts) ----------
// Every person is in exactly one state (js/account-state.js: active, pending, blocked, deleting),
// so the chips on the Users tab never overlap, and every person has the same card.
const FILTERS = [
  ["all", "All"],
  ["students", "Students"],
  ["drivers", "Drivers"],
  ["pending", "Pending"],
  ["blocked", "Blocked"],
  ["deleting", "Deleting"],
  ["admins", "Admins"]
];

const stateOf = (uid) => accountState(users.get(uid), drivers.get(uid));

const reporterCount = (uid) => ((tallies.get(uid) || {}).reporters || []).length;

// The time (in milliseconds) when the 24 hours of "Delete my account" end, or null.
function deleteDueAt(u) {
  return u && u.deleteRequestedAt && u.deleteRequestedAt.toMillis
    ? u.deleteRequestedAt.toMillis() + DELETE_WAIT_MS
    : null;
}

// Students and Drivers mean ACTIVE ones only; Pending, Blocked and Deleting are their own lists.
function inFilter(uid, u, key) {
  const state = stateOf(uid);
  if (key === "students") return u.role === "student" && state === "active";
  if (key === "drivers") return u.role === "driver" && state === "active";
  if (key === "pending") return state === "pending";
  if (key === "blocked") return state === "blocked";
  if (key === "deleting") return state === "deleting";
  return true;
}

// ---------- W27c: the owner's private note ----------
// Saving an empty box deletes the note. Only an admin can read it (rules: accountNotes).
function noteEditor(uid) {
  const wrap = el("div", null, "note-editor");
  wrap.append(el("p", "Owner's private note (only an admin can read it; up to 200 characters; no ID numbers; an empty box deletes it)", "hint"));
  const box = document.createElement("textarea");
  box.maxLength = 200;
  box.rows = 2;
  box.value = (notes.get(uid) || {}).text || "";
  wrap.append(box);
  wrap.append(button("Save note", "secondary", () => change(async () => {
    const text = box.value.trim().slice(0, 200);
    if (!text) {
      if (notes.has(uid)) {
        await deleteDoc(doc(db, "accountNotes", uid));
        notes.delete(uid);
      }
      return;
    }
    await setDoc(doc(db, "accountNotes", uid), { text, updatedAt: serverTimestamp() });
    notes.set(uid, { text, updatedAt: justNow() });
  })));
  return wrap;
}

// A note whose person is gone (he deleted his own account, so Remove never ran for him).
function orphanNoteCard(uid, n) {
  const card = el("div", null, "history-item");
  card.append(el("p", "Note about an account that is gone", "panel-title"));
  card.append(line("Note:", n.text));
  card.append(line("Saved:", when(n.updatedAt)));
  card.append(line("ID:", uid));
  card.append(button("Delete note", "secondary", () => change(async () => {
    await deleteDoc(doc(db, "accountNotes", uid));
    notes.delete(uid);
  }, "Delete this note for good?")));
  return card;
}

// One card for every person (not an admin).
function userCard(uid, u) {
  const state = stateOf(uid);
  const d = drivers.get(uid);
  const a = appeals.get(uid);
  const dueAt = deleteDueAt(u);
  const left = dueAt === null ? 0 : dueAt - Date.now();
  const card = el("div", null, "history-item");
  card.append(el("p", u.name || uid, "panel-title"));
  const chips = el("p", null, "chips-line");
  chips.append(el("span", u.role, "chip"), el("span", STATE_LABELS[state], "chip " + state));
  card.append(chips);
  if (d) card.append(line("Vehicle:", d.vehicleType + ", plate " + d.plateNumber));
  if (u.school) card.append(line("School:", u.school));
  if (state === "blocked") {
    card.append(line("Blocked:", blockedWhy(uid, u)));
    card.append(el("p", dueAt !== null
      ? "He also asked to delete his account. A blocked person cannot finish that himself."
      : "A blocked person cannot delete his own account.", "hint"));
  }
  if (!u.blocked && reporterCount(uid) >= 3) {
    card.append(el("p", "Three or more different people reported this person, but the automatic block did not finish. Press Block.", "hint"));
  }
  if (state === "deleting" && dueAt !== null) {
    card.append(line("Asked on:", when(u.deleteRequestedAt)));
    card.append(line("The 24 hours end:", new Date(dueAt).toLocaleString()));
    card.append(line("Time left:", left <= 0 ? "the 24 hours are over" : timeLeftText(left)));
    card.append(el("p", left <= 0
      ? "The 24 hours are over. He can finish at the bottom of his page. If he does not come back, press Remove now."
      : "He can still undo it until the 24 hours are over. Remove now unlocks after that.", "hint"));
  }
  if (a) {
    card.append(line("Appeal:", (a.status === "denied" ? "denied" : "NEW") + ", sent " + when(a.createdAt)));
    card.append(line("Message:", a.message));
  }

  if (notes.has(uid)) card.append(line("Owner's note:", notes.get(uid).text));
  const details = document.createElement("details");
  details.append(el("summary", "Details"));
  details.append(line("Contact:", u.contactNumber));
  details.append(line("Signed up:", when(u.createdAt)));
  if (d && d.approvalStatus === "approved") details.append(line("Approved on:", d.approvedAt ? when(d.approvedAt) : "date not recorded"));
  details.append(line("ID:", uid));
  details.append(noteEditor(uid));
  details.append(line("Reports about this person:", String(reports.filter((r) => r.reportedId === uid).length)));
  if (tallies.has(uid)) {
    const n = reporterCount(uid);
    details.append(line("Reported by:", n + " different " + (n === 1 ? "person" : "people")));
  }
  card.append(details);

  // The main buttons depend on the state; the rest are under More.
  const buttons = el("div", null, "card-buttons");
  const more = [];
  const block = () => button("Block", "secondary", () => setBlocked(uid, true));
  const remove = (text) => button(text || "Remove", "secondary", () => removePerson(uid));
  if (state === "pending") {
    buttons.append(button("Approve", "primary", () => setApproval(uid, "approved")), block());
    more.push(remove());
  } else if (state === "blocked") {
    buttons.append(button(a ? "Unblock (accept appeal)" : "Unblock", "primary", () => setBlocked(uid, false)));
    if (a && a.status !== "denied") buttons.append(button("Deny appeal", "secondary", () => denyAppeal(uid)));
    more.push(remove());
  } else if (state === "deleting") {
    // Not disabled (a disabled button looks the same and does nothing): it explains itself (W30).
    const now = button("Remove now", "secondary", () => {
      if (dueAt !== null && dueAt - Date.now() > 0) {
        window.alert("Not yet. " + (u.name || "This person") + " can still undo the deletion until " + new Date(dueAt).toLocaleString() + ". Remove now unlocks after that.\n\nTo remove him sooner, open More and press Block first, then Remove.");
        return;
      }
      removePerson(uid);
    });
    buttons.append(now);
    more.push(block());
  } else {
    buttons.append(block());
    if (d) more.push(button("Set to pending", "secondary", () => setApproval(uid, "pending")));
    more.push(remove());
  }
  if (a) more.unshift(button("Delete appeal", "secondary", () => deleteAppeal(uid)));
  card.append(buttons);
  if (more.length) {
    const menu = document.createElement("details");
    menu.className = "more";
    menu.append(el("summary", "More"));
    more.forEach((b) => menu.append(b));
    card.append(menu);
  }
  return card;
}

// Admins are made and removed by hand in the Firebase console, so there are no buttons.
function adminCard(uid) {
  const u = users.get(uid) || { name: uid, role: "no profile" };
  const card = el("div", null, "history-item");
  card.append(el("p", u.name || uid, "panel-title"));
  const chips = el("p", null, "chips-line");
  chips.append(el("span", u.role, "chip"), el("span", "Admin", "chip admin"));
  card.append(chips);
  if (u.contactNumber) card.append(line("Contact:", u.contactNumber));
  card.append(line("ID:", uid));
  card.append(el("p", "Admins are made and removed by hand in the Firebase console.", "hint"));
  return card;
}

// Everything that waits for the owner.
function todoParts() {
  const people = [...users].filter(([uid]) => !admins.has(uid));
  const created = (u) => (u.createdAt && u.createdAt.toMillis ? u.createdAt.toMillis() : 0);
  return {
    pending: people.filter(([uid]) => stateOf(uid) === "pending").sort(([, a], [, b]) => created(a) - created(b)),
    newAppeals: [...appeals].filter(([, a]) => a.status !== "denied"),
    newReports: reports.filter((r) => r.status === "new"),
    due: people.filter(([uid, u]) => stateOf(uid) === "deleting" && deleteDueAt(u) !== null && deleteDueAt(u) <= Date.now()),
    needBlock: people.filter(([uid, u]) => !u.blocked && reporterCount(uid) >= 3)
  };
}

function render() {
  if (!["todo", "users", "reports", "closed"].includes(tab)) tab = "todo";
  const people = [...users].filter(([uid]) => !admins.has(uid));
  const t = todoParts();
  const todoCount = t.pending.length + t.newAppeals.length + t.newReports.length + t.due.length + t.needBlock.length;
  const fresh = reports.filter((r) => r.status === "new").length;
  const names = {
    todo: "To do (" + todoCount + ")",
    users: "Users (" + people.length + ")",
    reports: "Reports (" + fresh + " new)",
    closed: "Closed accounts (" + removed.size + ")"
  };
  const tabs = byId("tabs");
  tabs.replaceChildren();
  for (const key of Object.keys(names)) {
    const b = button(names[key], null, () => { tab = key; render(); });
    b.setAttribute("aria-selected", String(tab === key));
    tabs.append(b);
  }
  byId("search").classList.toggle("hidden", tab !== "users" || filter === "admins");

  const cards = [];
  let empty = "Nothing here.";
  if (tab === "todo") {
    empty = "Nothing is waiting for you.";
    const group = (title, items, make) => {
      if (!items.length) return;
      cards.push(el("p", title + " (" + items.length + ")", "todo-heading"));
      items.forEach((x) => cards.push(make(x)));
    };
    group("Drivers waiting for approval", t.pending, ([uid, u]) => userCard(uid, u));
    group("New appeals", t.newAppeals, ([uid, a]) => {
      const u = users.get(uid);
      return u && !admins.has(uid) ? userCard(uid, u) : appealCard(uid, a);
    });
    group("New reports", t.newReports, (r) => reportCard(r));
    group("Deletions that are due", t.due, ([uid, u]) => userCard(uid, u));
    group("Reported by three or more people, not blocked yet", t.needBlock, ([uid, u]) => userCard(uid, u));
  } else if (tab === "users") {
    empty = "Nobody here.";
    const filterBar = el("div", null, "filters");
    for (const [key, label] of FILTERS) {
      const n = key === "admins" ? admins.size : people.filter(([uid, u]) => inFilter(uid, u, key)).length;
      const b = button(label + " (" + n + ")", null, () => { filter = key; render(); });
      b.setAttribute("aria-selected", String(filter === key));
      filterBar.append(b);
    }
    cards.push(filterBar);
    const rows = [];
    if (filter === "admins") {
      [...admins].sort((x, y) => ((users.get(x) || {}).name || x).localeCompare((users.get(y) || {}).name || y))
        .forEach((uid) => rows.push(adminCard(uid)));
    } else {
      const q = byId("search").value.trim().toLowerCase();
      const match = (uid, u) => !q || (
        (u.name || "") + " " + (u.contactNumber || "") + " " + ((drivers.get(uid) || {}).plateNumber || "") + " " + uid
      ).toLowerCase().includes(q);
      const created = (u) => (u.createdAt && u.createdAt.toMillis ? u.createdAt.toMillis() : 0);
      people.filter(([uid, u]) => inFilter(uid, u, filter) && match(uid, u))
        .sort(([, a], [, b]) => filter === "pending"
          ? created(a) - created(b)
          : (a.name || "").localeCompare(b.name || ""))
        .forEach(([uid, u]) => rows.push(userCard(uid, u)));
    }
    cards.push(...(rows.length ? rows : [el("p", empty, "hint")]));
    byId("list").replaceChildren(...cards);
    return;
  } else if (tab === "reports") {
    empty = "No reports.";
    // New reports first, then the newest.
    [...reports].sort((a, b) => (b.status === "new") - (a.status === "new")
      || (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      .forEach((r) => cards.push(reportCard(r)));
  } else {
    empty = "No closed accounts.";
    [...removed].sort(([, a], [, b]) => (b.removedAt?.toMillis?.() || Date.now()) - (a.removedAt?.toMillis?.() || Date.now()))
      .forEach(([uid, n]) => cards.push(removedCard(uid, n)));
    const orphans = [...notes].filter(([uid]) => !users.has(uid) && !admins.has(uid));
    if (orphans.length) {
      cards.push(el("p", "Notes about accounts that are gone (" + orphans.length + ")", "todo-heading"));
      orphans.forEach(([uid, n]) => cards.push(orphanNoteCard(uid, n)));
    }
  }
  byId("list").replaceChildren(...(cards.length ? cards : [el("p", empty, "hint")]));
}

async function load() {
  say("Loading…");
  try {
    const [u, d, r, a, x, t, p, nn] = await Promise.all(["users", "drivers", "reports", "admins", "removedUsers", "reportTally", "appeals", "accountNotes"].map((name) => getDocs(collection(db, name))));
    notes = new Map(nn.docs.map((y) => [y.id, y.data()]));
    tallies = new Map(t.docs.map((y) => [y.id, y.data()]));
    appeals = new Map(p.docs.map((y) => [y.id, y.data()]));
    removed = new Map(x.docs.map((y) => [y.id, y.data()]));
    users = new Map(u.docs.map((x) => [x.id, x.data()]));
    drivers = new Map(d.docs.map((x) => [x.id, x.data()]));
    reports = r.docs.map((x) => ({ id: x.id, ...x.data() }));
    admins = new Set(a.docs.map((x) => x.id));
    say("");
  } catch (error) {
    say("Could not load (" + (error.code || "error") + "). Check your internet and press Refresh.");
  }
  render();
}

byId("signout").onclick = () => signOut(auth).then(() => location.replace("login.html"));
byId("refresh").onclick = load;
byId("search").oninput = render;

const stop = onAuthStateChanged(auth, async (user) => {
  stop();
  if (!user) { location.replace("login.html"); return; }
  try {
    const admin = await getDoc(doc(db, "admins", user.uid));
    if (!admin.exists()) { say("Not an admin. Your UID is " + user.uid + ". No document admins/" + user.uid + " was found."); return; }
  } catch (error) {
    say("Could not check your account. Refresh the page.");
    return;
  }
  byId("hello").textContent = user.email;
  load();
});
