// Account settings page (W31), for students and drivers. Each person sees only his own settings.
//  - Drivers: change the vehicle or plate number (an approved driver goes back to pending).
//  - Everyone: Delete my account (the 24-hour countdown, Undo and the password step).
// Edit my profile (W27e) will be added here.
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
  updateDoc
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const byId = (id) => document.getElementById(id);
const status = byId("status");
const note = byId("note");
let me = null;        // { user, profile }
let vehicle = null;   // the driver's record (vehicle type, plate, approval)

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

async function hasActiveRide() {
  const mine = await getDocs(query(collection(db, "rides"), where("driverId", "==", me.user.uid)));
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

// ---------- Start ----------

requireMember()
  .then(async (session) => {
    me = session;
    const role = session.profile.role;
    byId("hello").textContent = session.profile.name;
    byId("back-link").href = role === "driver" ? "driver.html" : "student.html";
    if (window.HatudSidebar) window.HatudSidebar.setRole(role);
    status.classList.add("hidden");

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
