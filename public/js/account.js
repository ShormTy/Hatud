// Account settings page (W31), for students and drivers. Each person sees only his own settings.
//  - Drivers: change the vehicle or plate number (an approved driver goes back to pending).
//  - Everyone: Delete my account (the 24-hour countdown, Undo and the password step).
//  - Everyone: Edit my profile (W27e): name, contact number and, for students, school.
import { requireMember, logOut } from "./session.js";
import { db } from "./firebase.js";
import { makeCaps } from "./caps.js";
import { mountDeleteAccount } from "./delete-account.js";
import { confirmBox } from "./dialog.js";
import { SUPPORT_EMAIL } from "./support.js";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const byId = (id) => document.getElementById(id);
const status = byId("status");
const note = byId("note");
let me = null;        // { user, profile }
let vehicle = null;   // the driver's record (vehicle type, plate, approval)
const PHONE_PATTERN = /^[0-9+() -]{7,20}$/; // the same as the sign-up page and firestore.rules
const FINISHED = ["completed", "cancelled", "expired"];

byId("signout").addEventListener("click", () => logOut());

function say(text) {
  note.textContent = text;
  note.classList.toggle("hidden", !text);
}

function friendlyError(error) {
  switch (error.code) {
    case "permission-denied":
      return "That was refused. Your account may have changed or may be blocked. Please refresh the page, or write to " + SUPPORT_EMAIL + ".";
    case "unavailable":
    case "network-request-failed":
      return "No internet connection. Please try again.";
    default:
      return "Something went wrong (" + (error.code || "unknown") + "). Please try again.";
  }
}

// ---------- Changing the vehicle or plate number ----------
// An approved driver who changes these goes back to pending (the owner checks again).
// A ride he already accepted keeps the vehicle the student was shown, so changes wait
// until that ride is finished.

function showVehicleLine() {
  byId("vehicle").textContent = vehicle.vehicleType + " • " + vehicle.plateNumber +
    (vehicle.approvalStatus === "approved" ? "" : " (waiting for the owner’s approval)");
}

// True while the person has a ride that is not finished: a student with an open request or
// an unfinished ride, a driver with a ride that is accepted or on the way. Changes to the
// vehicle or the profile wait until then, because a ride keeps the details shown at the start.
async function hasActiveRide() {
  const uid = me.user.uid;
  if (me.profile.role === "student") {
    const lock = await getDoc(doc(db, "locks", uid));
    if (lock.exists()) return true;
    const mine = await getDocs(query(collection(db, "rides"), where("studentId", "==", uid)));
    return mine.docs.some((d) => !FINISHED.includes(d.data().status));
  }
  const mine = await getDocs(query(collection(db, "rides"), where("driverId", "==", uid)));
  return mine.docs.some((d) => ["accepted", "on_the_way"].includes(d.data().status));
}

function closeVehicleForm() {
  byId("vehicle-form").classList.add("hidden");
  byId("vehicle-edit").classList.remove("hidden");
}

async function openVehicleForm() {
  say("");
  try {
    if (await hasActiveRide()) {
      say("Please finish your current ride before changing your vehicle.");
      return;
    }
  } catch (error) {
    say(friendlyError(error));
    return;
  }
  byId("vehicle-type").value = vehicle.vehicleType;
  byId("plate").value = vehicle.plateNumber;
  byId("vehicle-form").classList.remove("hidden");
  byId("vehicle-edit").classList.add("hidden");
}

async function saveVehicle() {
  say("");
  const vehicleType = byId("vehicle-type").value.trim().replace(/\s+/g, " ").toUpperCase();
  const plateNumber = byId("plate").value.trim().replace(/\s+/g, " ").toUpperCase();
  if (!vehicleType) {
    say("Please type your vehicle type, for example TRICYCLE.");
    return;
  }
  if (!plateNumber) {
    say("Please type your plate number.");
    return;
  }
  if (vehicleType === String(vehicle.vehicleType).toUpperCase()
      && plateNumber === String(vehicle.plateNumber).toUpperCase()) {
    say("Nothing changed.");
    closeVehicleForm();
    return;
  }
  const button = byId("vehicle-save");
  button.disabled = true;
  try {
    if (await hasActiveRide()) {
      say("Please finish your current ride before changing your vehicle.");
      return;
    }
    // An approved driver goes back to "pending" when he changes these: the owner checks again.
    if (vehicle.approvalStatus === "approved") {
      const ok = await confirmBox({
        title: "Are you sure?",
        message: "Changing your vehicle or plate number puts your account back to pending. You will not see or accept ride requests until the owner checks your vehicle again.",
        okText: "Yes, change it",
        cancelText: "No, keep it",
        danger: true
      });
      if (!ok) return;
    }
    await updateDoc(doc(db, "drivers", me.user.uid), { vehicleType, plateNumber, approvalStatus: "pending" });
    window.alert("Saved. Your account is now pending: the owner will check your vehicle again before you can accept rides.");
    window.location.reload(); // the page starts again with the new vehicle
  } catch (error) {
    say(friendlyError(error));
  } finally {
    button.disabled = false;
  }
}

// ---------- Edit my profile (W27e) ----------
// Name, contact number and, for students, school. A driver's contact number is saved in his
// users record and his drivers record in ONE save. When an APPROVED driver changes his NAME,
// he goes back to pending (the owner approved a person he met under that name); a driver who
// is already pending can fix a typo without the warning.

const profileNote = byId("profile-note");
let isDriverRole = false;

function sayProfile(text) {
  profileNote.textContent = text;
  profileNote.classList.toggle("hidden", !text);
}

function drawProfile() {
  const p = me.profile;
  byId("profile-name").textContent = p.name;
  byId("profile-contact").textContent = p.contactNumber;
  const isStudent = p.role === "student";
  byId("profile-school-line").classList.toggle("hidden", !isStudent);
  if (isStudent) byId("profile-school").textContent = p.school;
}

function closeProfileForm() {
  byId("profile-form").classList.add("hidden");
  byId("profile-edit").classList.remove("hidden");
}

async function openProfileForm() {
  sayProfile("");
  try {
    if (await hasActiveRide()) {
      sayProfile("Please finish or cancel your current ride before editing your profile.");
      return;
    }
  } catch (error) {
    sayProfile(friendlyError(error));
    return;
  }
  const p = me.profile;
  byId("p-name").value = p.name;
  byId("p-contact").value = p.contactNumber;
  byId("p-school-row").classList.toggle("hidden", p.role !== "student");
  if (p.role === "student") byId("p-school").value = p.school;
  byId("profile-hint").classList.toggle("hidden", !isDriverRole);
  byId("profile-form").classList.remove("hidden");
  byId("profile-edit").classList.add("hidden");
}

async function saveProfile() {
  sayProfile("");
  const p = me.profile;
  const isStudent = p.role === "student";
  const name = byId("p-name").value.trim();
  const contactNumber = byId("p-contact").value.trim();
  const school = isStudent ? byId("p-school").value.trim() : null;

  if (!name) { sayProfile("Please type your full name."); return; }
  if (isStudent && !school) { sayProfile("Please type your school."); return; }
  if (!PHONE_PATTERN.test(contactNumber)) {
    sayProfile("Please type a contact number (digits only, or with + and spaces).");
    return;
  }

  const nameChanged = name !== p.name;
  const phoneChanged = contactNumber !== p.contactNumber;
  const schoolChanged = isStudent && school !== p.school;
  if (!nameChanged && !phoneChanged && !schoolChanged) {
    sayProfile("Nothing changed.");
    closeProfileForm();
    return;
  }

  const button = byId("profile-save");
  button.disabled = true;
  try {
    if (await hasActiveRide()) {
      sayProfile("Please finish or cancel your current ride before editing your profile.");
      return;
    }
    const goesPending = isDriverRole && nameChanged && vehicle && vehicle.approvalStatus === "approved";
    if (goesPending) {
      const ok = await confirmBox({
        title: "Are you sure?",
        message: "Changing your name puts your account back to pending. You will not see or accept ride requests until the owner checks you again.",
        okText: "Yes, change it",
        cancelText: "No, keep it",
        danger: true
      });
      if (!ok) return;
    }

    const batch = writeBatch(db);
    batch.update(doc(db, "users", me.user.uid), isStudent ? { name, contactNumber, school } : { name, contactNumber });
    if (isDriverRole && vehicle && (phoneChanged || goesPending)) {
      const change = {};
      if (phoneChanged) change.contactNumber = contactNumber;
      if (goesPending) change.approvalStatus = "pending";
      batch.update(doc(db, "drivers", me.user.uid), change);
    }
    await batch.commit();

    if (goesPending) {
      window.alert("Saved. Your account is now pending: the owner will check you again before you can accept rides.");
      window.location.reload(); // the page starts again as a pending driver
      return;
    }
    p.name = name;
    p.contactNumber = contactNumber;
    if (isStudent) p.school = school;
    if (vehicle && phoneChanged) vehicle.contactNumber = contactNumber;
    byId("hello").textContent = name;
    drawProfile();
    closeProfileForm();
    sayProfile("Saved.");
  } catch (error) {
    sayProfile(friendlyError(error));
  } finally {
    button.disabled = false;
  }
}

// ---------- Start ----------

requireMember()
  .then(async (session) => {
    me = session;
    const role = session.profile.role;
    byId("hello").textContent = session.profile.name;
    byId("back-link").href = role === "driver" ? "driver.html" : "student.html";
    if (window.HatudSidebar) window.HatudSidebar.setRole(role);
    status.classList.add("hidden");
    isDriverRole = role === "driver";

    byId("profile-panel").classList.remove("hidden");
    drawProfile();

    if (session.profile.blocked === true) {
      // A blocked person cannot change his details (the block is by name).
      byId("profile-edit").classList.add("hidden");
      sayProfile("A blocked account can’t be edited here. Write to " + SUPPORT_EMAIL + ".");
    } else {
      byId("profile-edit").onclick = openProfileForm;
      byId("profile-cancel").onclick = closeProfileForm;
      byId("profile-save").onclick = saveProfile;
    }

    if (role === "driver") {
      const snap = await getDoc(doc(db, "drivers", session.user.uid));
      vehicle = snap.exists() ? snap.data() : null;
      if (vehicle) {
        showVehicleLine();
        byId("vehicle-panel").classList.remove("hidden");
        byId("vehicle-edit").onclick = openVehicleForm;
        byId("vehicle-cancel").onclick = closeVehicleForm;
        byId("vehicle-save").onclick = saveVehicle;
        makeCaps(byId("vehicle-type"));
        makeCaps(byId("plate"));
      }
    }

    mountDeleteAccount({ role, user: session.user, profile: session.profile, into: byId("delete-area") });
    const target = byId("delete-panel");
    if (target && location.hash === "#delete-panel") target.scrollIntoView();
  })
  .catch(() => {
    status.textContent = "Couldn’t load your account. Please check your internet and refresh.";
    status.classList.remove("hidden");
  });
