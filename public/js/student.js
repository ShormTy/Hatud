// Student page: set pickup and drop-off on the map, send a ride request,
// see the open request, cancel it.
import { requireRole, logOut } from "./session.js";
import { db } from "./firebase.js";
import {
  doc,
  collection,
  getDoc,
  deleteDoc,
  onSnapshot,
  writeBatch,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const L = window.L; // Leaflet, loaded by student.html
const byId = (id) => document.getElementById(id);

const TAGBILARAN = [9.6472, 123.855];
const DAY_MS = 24 * 60 * 60 * 1000;

const note = byId("note");
const summary = byId("summary");
const planner = byId("planner");
const activePanel = byId("active");
const requestButton = byId("request");
const expiryInput = byId("expiry");
const expiryText = byId("expiry-text");

let me = null;           // { user, profile } once the login is checked
let pickup = null;       // draggable marker or null
let dropoff = null;
let active = "pickup";   // which pin the next tap sets
let planning = true;     // false while an open request is shown
let fixedPins = [];      // pins of the open request (not draggable)
let stopWatching = null; // stops the live listening on the open request

function say(text) {
  note.textContent = text;
  note.classList.toggle("hidden", !text);
}

// ---------- Map ----------

const map = L.map("map").setView(TAGBILARAN, 14);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
}).addTo(map);

function pinIcon(letter, kind) {
  return L.divIcon({
    className: "pin pin-" + kind,
    html: "<span>" + letter + "</span>",
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

function makeMarker(kind, latlng) {
  const marker = L.marker(latlng, {
    draggable: true,
    icon: pinIcon(kind === "pickup" ? "A" : "B", kind)
  }).addTo(map);
  marker.on("dragend", updateSummary);
  return marker;
}

function placePin(kind, latlng) {
  if (kind === "pickup") {
    if (pickup) pickup.setLatLng(latlng); else pickup = makeMarker("pickup", latlng);
  } else {
    if (dropoff) dropoff.setLatLng(latlng); else dropoff = makeMarker("dropoff", latlng);
  }
  updateSummary();
}

function setActive(kind) {
  active = kind;
  document.querySelector('input[name="active-pin"][value="' + kind + '"]').checked = true;
}

function resetPins() {
  if (pickup) { map.removeLayer(pickup); pickup = null; }
  if (dropoff) { map.removeLayer(dropoff); dropoff = null; }
  setActive("pickup");
  updateSummary();
}

function updateSummary() {
  const parts = [
    "Pickup (A): " + (pickup ? "set" : "tap the map"),
    "Drop-off (B): " + (dropoff ? "set" : "not set yet")
  ];
  if (pickup && dropoff) {
    const km = map.distance(pickup.getLatLng(), dropoff.getLatLng()) / 1000;
    parts.push("About " + km.toFixed(1) + " km in a straight line (the road is a bit longer).");
  }
  summary.textContent = parts.join("  •  ");
}

map.on("click", (event) => {
  if (!planning) return;
  say("");
  placePin(active, event.latlng);
  if (active === "pickup" && !dropoff) setActive("dropoff");
});

document.querySelectorAll('input[name="active-pin"]').forEach((radio) => {
  radio.addEventListener("change", () => { active = radio.value; });
});

byId("locate").addEventListener("click", () => {
  say("");
  if (!navigator.geolocation) {
    say("This phone or browser can’t share its location. Please tap the map instead.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (position) => {
      const here = L.latLng(position.coords.latitude, position.coords.longitude);
      map.setView(here, 16);
      placePin("pickup", here);
      setActive("dropoff");
    },
    () => say("Couldn’t get your location. Please allow location access, or tap the map instead."),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

byId("clear").addEventListener("click", () => {
  resetPins();
  say("");
});

// ---------- Expiry slider ----------

function describeMinutes(total) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const hourText = hours === 1 ? "1 hour" : hours + " hours";
  if (hours === 0) return minutes + " minutes";
  return minutes === 0 ? hourText : hourText + " " + minutes + " minutes";
}

function updateExpiryText() {
  expiryText.textContent = describeMinutes(Number(expiryInput.value));
}
expiryInput.addEventListener("input", updateExpiryText);

// ---------- Saving a request ----------

function friendlyError(error) {
  switch (error.code) {
    case "permission-denied":
      return "The request was refused. Please check that your phone’s date and time are correct, then try again.";
    case "unavailable":
    case "network-request-failed":
      return "No internet connection. Please try again.";
    default:
      return "Something went wrong (" + (error.code || "unknown") + "). Please try again.";
  }
}

function pointData(marker, labelId) {
  const position = marker.getLatLng();
  return {
    lat: Number(position.lat.toFixed(5)),
    lng: Number(position.lng.toFixed(5)),
    label: byId(labelId).value.trim()
  };
}

async function sendRequest() {
  say("");
  if (!pickup || !dropoff) {
    say("Please set both pins first: pickup (A) and drop-off (B).");
    return;
  }

  const now = Date.now();
  const minutes = Number(expiryInput.value);
  const expiresAt = new Date(now + minutes * 60 * 1000);

  let neededBy = null;
  const neededValue = byId("needed-by").value;
  if (neededValue) {
    const wanted = new Date(neededValue);
    if (Number.isNaN(wanted.getTime())) {
      say("Please check the “needed by” time.");
      return;
    }
    if (wanted.getTime() < now - 60 * 1000) {
      say("The “needed by” time has already passed.");
      return;
    }
    if (wanted.getTime() > expiresAt.getTime()) {
      say("Your “needed by” time is later than the time your request stays open. Move the slider or the time.");
      return;
    }
    neededBy = Timestamp.fromDate(wanted);
  }

  requestButton.disabled = true;
  try {
    const rideRef = doc(collection(db, "rides"));
    const batch = writeBatch(db);
    batch.set(rideRef, {
      studentId: me.user.uid,
      driverId: null,
      pickup: pointData(pickup, "pickup-label"),
      dropoff: pointData(dropoff, "dropoff-label"),
      fare: null,
      counterOffer: null,
      status: "requested",
      neededBy,
      expiresAt: Timestamp.fromDate(expiresAt),
      createdAt: serverTimestamp(),
      deleteAfter: Timestamp.fromDate(new Date(now + 30 * DAY_MS))
    });
    // Name and contact number, kept private: a driver can read them only after accepting.
    batch.set(doc(db, "rides", rideRef.id, "private", "student"), {
      name: me.profile.name,
      contactNumber: me.profile.contactNumber
    });
    // This small record is what allows only one open request per student.
    batch.set(doc(db, "locks", me.user.uid), {
      rideId: rideRef.id,
      studentId: me.user.uid
    });
    await batch.commit();

    byId("pickup-label").value = "";
    byId("dropoff-label").value = "";
    byId("needed-by").value = "";
    await showCurrentState();
  } catch (error) {
    say(friendlyError(error));
  } finally {
    requestButton.disabled = false;
  }
}
requestButton.addEventListener("click", sendRequest);

// ---------- Showing and ending the open request ----------

function clearFixedPins() {
  fixedPins.forEach((pin) => map.removeLayer(pin));
  fixedPins = [];
}

function showPlanner() {
  planning = true;
  clearFixedPins();
  planner.classList.remove("hidden");
  activePanel.classList.add("hidden");
}

function whenText(date) {
  return date.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function placeText(point, fallback) {
  return point.label ? point.label : fallback;
}

function showActive(rideId, ride) {
  planning = false;
  resetPins();
  clearFixedPins();
  planner.classList.add("hidden");
  activePanel.classList.remove("hidden");

  const from = L.latLng(ride.pickup.lat, ride.pickup.lng);
  const to = L.latLng(ride.dropoff.lat, ride.dropoff.lng);
  fixedPins = [
    L.marker(from, { icon: pinIcon("A", "pickup"), interactive: false }).addTo(map),
    L.marker(to, { icon: pinIcon("B", "dropoff"), interactive: false }).addTo(map)
  ];
  map.fitBounds(L.latLngBounds([from, to]), { padding: [40, 40], maxZoom: 17 });

  const accepted = ride.status === "accepted";
  const underway = ride.status === "on_the_way";
  const hasDriver = accepted || underway;
  byId("active-status").textContent = ride.status === "requested"
    ? "Waiting for a driver to accept."
    : accepted
      ? "A driver accepted your request. If the fare is not OK for you, you can cancel."
      : underway
        ? "Your driver is on the way. You can’t cancel here anymore; please call or text the driver if something changed."
        : "Status: " + ride.status;
  byId("driver-box").classList.toggle("hidden", !hasDriver);
  byId("cancel").classList.toggle("hidden", underway);
  if (hasDriver) {
    byId("driver-fare").textContent = "₱" + ride.fare;
    byId("driver-name").textContent = ride.driverName;
    byId("driver-vehicle").textContent = ride.vehicleType + " • " + ride.plateNumber;
    const phone = byId("driver-contact");
    phone.textContent = ride.driverContact;
    phone.href = "tel:" + ride.driverContact.replace(/[^0-9+]/g, "");
  }
  byId("active-from").textContent = placeText(ride.pickup, "Pin A on the map");
  byId("active-to").textContent = placeText(ride.dropoff, "Pin B on the map");
  byId("active-until").textContent = whenText(ride.expiresAt.toDate());
  const neededLine = byId("active-needed-line");
  neededLine.classList.toggle("hidden", !ride.neededBy);
  if (ride.neededBy) byId("active-needed").textContent = whenText(ride.neededBy.toDate());

  byId("cancel").disabled = ride.status !== "requested" && !accepted;
  byId("cancel").onclick = () => cancelRide(rideId);
}

// Marks the request as finished and frees the student to make a new one.
async function endRide(rideId, newStatus) {
  const batch = writeBatch(db);
  batch.update(doc(db, "rides", rideId), { status: newStatus });
  batch.delete(doc(db, "locks", me.user.uid));
  await batch.commit();
}

async function cancelRide(rideId) {
  if (!window.confirm("Cancel this ride request?")) return;
  say("");
  byId("cancel").disabled = true;
  try {
    await endRide(rideId, "cancelled");
    if (stopWatching) { stopWatching(); stopWatching = null; }
    await showCurrentState();
  } catch (error) {
    byId("cancel").disabled = false;
    say(friendlyError(error));
  }
}

// The driver tapped Completed: release the student's lock and go back to the planner.
async function finishCompleted() {
  try {
    await deleteDoc(doc(db, "locks", me.user.uid));
  } catch (error) {
    say(friendlyError(error));
    return;
  }
  showPlanner();
  say("Your ride is completed. Thank you for using Hatud!");
}

// Looks for an open request and shows the right panel.
async function showCurrentState() {
  const lockSnap = await getDoc(doc(db, "locks", me.user.uid));
  if (!lockSnap.exists()) {
    showPlanner();
    return;
  }

  const rideId = lockSnap.data().rideId;
  let ride;
  try {
    const rideSnap = await getDoc(doc(db, "rides", rideId));
    ride = rideSnap.data();
  } catch (error) {
    say("We couldn’t load your open request. Please refresh, or tell the Hatud owner if this keeps happening.");
    return;
  }

  // A finished ride frees the student to make a new request.
  if (ride.status === "completed") {
    await finishCompleted();
    return;
  }
  // Safety valve: a ride that has been "on the way" for over 6 hours is let go.
  if (ride.status === "on_the_way" && ride.startedAt
      && ride.startedAt.toDate().getTime() < Date.now() - 6 * 60 * 60 * 1000) {
    try {
      await deleteDoc(doc(db, "locks", me.user.uid));
      showPlanner();
      say("Your last ride was never marked as completed, so it was closed. You can make a new request.");
      return;
    } catch (error) {
      // Not allowed yet by the server clock; show it as it is.
    }
  }

  // A request that ran out of time is closed automatically.
  if (ride.status === "requested" && ride.expiresAt.toDate().getTime() <= Date.now()) {
    try {
      await endRide(rideId, "expired");
      showPlanner();
      say("Your last request ran out of time. You can make a new one.");
      return;
    } catch (error) {
      // The server did not agree it has expired yet (for example a wrong phone clock). Show it as open.
    }
  }
  showActive(rideId, ride);

  // Keep the page up to date (for example when a driver accepts).
  if (stopWatching) stopWatching();
  stopWatching = onSnapshot(
    doc(db, "rides", rideId),
    (snap) => {
      const latest = snap.data();
      if (!latest) return;
      if (latest.status === "requested" || latest.status === "accepted" || latest.status === "on_the_way") {
        showActive(rideId, latest);
      } else if (latest.status === "completed") {
        if (stopWatching) { stopWatching(); stopWatching = null; }
        finishCompleted();
      } else {
        if (stopWatching) { stopWatching(); stopWatching = null; }
        showCurrentState();
      }
    },
    () => say("Lost the live connection. Please refresh the page.")
  );
}

// ---------- Start ----------

byId("signout").addEventListener("click", () => logOut());

updateSummary();
updateExpiryText();

requireRole("student")
  .then(async (session) => {
    me = session;
    byId("hello").textContent = session.profile.name;
    await showCurrentState();
  })
  .catch(() => say("Couldn’t load your account. Please check your internet and refresh."));
