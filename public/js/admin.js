// Admin page for the owner: approve drivers, block accounts, read reports.
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
  deleteDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const byId = (id) => document.getElementById(id);
const REASONS = {
  unreasonable_fare: "Unreasonable fare",
  unsafe_or_rude: "Unsafe or rude",
  no_show: "Did not show up",
  wrong_vehicle: "Wrong vehicle or plate",
  refused_to_pay: "Refused to pay",
  other: "Something else"
};

let users = new Map();
let drivers = new Map();
let reports = [];
let admins = new Set();
let removed = new Map();
let tab = "drivers";

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
  await updateDoc(doc(db, "users", uid), { blocked: value });
  users.get(uid).blocked = value;
}, (value ? "Block " : "Unblock ") + who(uid) + "?");

const setApproval = (uid, status) => change(async () => {
  await updateDoc(doc(db, "drivers", uid), { approvalStatus: status });
  drivers.get(uid).approvalStatus = status;
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
    await batch.commit();
    removed.set(uid, { ...note, removedAt: { toDate: () => new Date() } });
    users.delete(uid);
    drivers.delete(uid);
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

function driverCard(uid, d) {
  const u = users.get(uid) || {};
  const card = el("div", null, "history-item");
  card.append(el("p", u.name || uid, "panel-title"));
  card.append(line("Status:", d.approvalStatus + (u.blocked ? " (BLOCKED)" : "")));
  card.append(line("Vehicle:", d.vehicleType + ", plate " + d.plateNumber));
  card.append(line("Contact:", d.contactNumber));
  card.append(line("Signed up:", when(u.createdAt)));
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
  if (canBlock) {
    card.append(blockButton(uid));
    card.append(button("Remove", "secondary", () => removePerson(uid)));
  }
  return card;
}

function reportCard(r) {
  const card = el("div", null, "history-item");
  card.append(el("p", (REASONS[r.reason] || r.reason) + (r.status === "new" ? " (NEW)" : " (reviewed)"), "panel-title"));
  if (r.details) card.append(line("Details:", r.details));
  card.append(line("From:", who(r.reporterId)));
  card.append(line("About:", who(r.reportedId)));
  card.append(line("Sent:", when(r.createdAt)));
  card.append(button(r.status === "new" ? "Mark reviewed" : "Mark new", "secondary",
    () => setReportStatus(r, r.status === "new" ? "reviewed" : "new")));
  const b = blockButton(r.reportedId, " the reported person");
  if (b) card.append(b);
  card.append(button("Delete report", "secondary", () => removeReport(r)));
  return card;
}

function render() {
  const pending = [...drivers.values()].filter((d) => d.approvalStatus !== "approved").length;
  const fresh = reports.filter((r) => r.status === "new").length;
  const students = [...users].filter(([uid, u]) => u.role === "student" && !admins.has(uid));
  const names = {
    drivers: "Drivers (" + drivers.size + (pending ? ", " + pending + " waiting" : "") + ")",
    students: "Students (" + students.length + ")",
    admins: "Admins (" + admins.size + ")",
    removed: "Removed (" + removed.size + ")",
    reports: "Reports (" + fresh + " new)"
  };
  const tabs = byId("tabs");
  tabs.replaceChildren();
  for (const key of Object.keys(names)) {
    const b = button(names[key], null, () => { tab = key; render(); });
    b.setAttribute("aria-selected", String(tab === key));
    tabs.append(b);
  }
  byId("search").classList.toggle("hidden", tab !== "drivers" && tab !== "students");

  const q = byId("search").value.trim().toLowerCase();
  const match = (text) => !q || text.toLowerCase().includes(q);
  const byName = ([, a], [, b]) => (a.name || "").localeCompare(b.name || "");
  const cards = [];
  if (tab === "drivers") {
    // Waiting drivers first.
    [...drivers]
      .filter(([uid, d]) => match(((users.get(uid) || {}).name || "") + " " + d.contactNumber + " " + d.plateNumber + " " + uid))
      .sort(([, a], [, b]) => (a.approvalStatus === "approved") - (b.approvalStatus === "approved"))
      .forEach(([uid, d]) => cards.push(driverCard(uid, d)));
  } else if (tab === "students") {
    students.filter(([uid, u]) => match(u.name + " " + u.contactNumber + " " + uid))
      .sort(byName)
      .forEach(([uid, u]) => cards.push(personCard(uid, u, true)));
  } else if (tab === "removed") {
    [...removed].sort(([, a], [, b]) => (b.removedAt?.toMillis?.() || Date.now()) - (a.removedAt?.toMillis?.() || Date.now()))
      .forEach(([uid, n]) => cards.push(removedCard(uid, n)));
  } else if (tab === "admins") {
    // Admins are made and removed by hand in the Firebase console, so there are no buttons here.
    [...admins].map((uid) => [uid, users.get(uid) || { name: uid, role: "no profile" }])
      .sort(byName)
      .forEach(([uid, u]) => cards.push(personCard(uid, u, false)));
  } else {
    // New reports first, then the newest.
    [...reports].sort((a, b) => (b.status === "new") - (a.status === "new")
      || (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
      .forEach((r) => cards.push(reportCard(r)));
  }
  const list = byId("list");
  list.replaceChildren(...(cards.length ? cards : [el("p", "Nothing here.", "hint")]));
}

async function load() {
  say("Loading…");
  try {
    const [u, d, r, a, x] = await Promise.all(["users", "drivers", "reports", "admins", "removedUsers"].map((name) => getDocs(collection(db, name))));
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
