// Student page: set pickup and drop-off on the map, send a ride request,
// see the open request, cancel it.
import { requireRole, logOut } from "./session.js";
import { db } from "./firebase.js";
import { addReportControls, loadReported, disableReporting } from "./report.js";
import { showAppeal } from "./appeal.js";
import { confirmBox } from "./dialog.js";
import { SUPPORT_EMAIL } from "./support.js";
import {
  doc,
  collection,
  getDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
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
let lastStatus = null;   // the status of the open request the last time the page saw it
let cancelTimer = null;  // shows the late-cancel button once 10 minutes have passed
const CANCEL_AFTER_MS = 10 * 60 * 1000;
const BLOCKED_TEXT = "Your account is blocked, so you can’t make new requests. Please contact the owner at " + SUPPORT_EMAIL + ".";

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
      return me && me.profile && me.profile.blocked === true
        ? BLOCKED_TEXT
        : "The request was refused. Please check that your phone’s date and time are correct, then try again. If it still fails, write to " + SUPPORT_EMAIL + ".";
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

// ---------- The fare: agree, one counter-offer, or decline ----------
// After a driver accepts with a fare, the student must agree to the final fare before
// the driver can tap "I'm on the way". Before agreeing he can send ONE lower price
// (the driver accepts it or keeps his fare), or decline and let other drivers accept.

// What a ride looks like when it goes back to the open list.
const REOPEN = {
  status: "requested",
  driverId: null,
  fare: null,
  counterOffer: null,
  counterAnswer: null,
  fareAgreed: null,
  driverName: null,
  vehicleType: null,
  plateNumber: null,
  driverContact: null,
  acceptedAt: null
};
let reopenNote = ""; // why the ride went back to the open list, when the student did it himself

function showCounter(rideId, ride, accepted) {
  const box = byId("counter-box");
  const form = byId("counter-form");
  const text = byId("counter-text");
  const sent = ride.counterOffer !== null && ride.counterOffer !== undefined;
  const answer = ride.counterAnswer || null;
  const agreed = ride.fareAgreed === true;
  const underway = ride.status === "on_the_way";
  const show = accepted || underway;

  box.classList.toggle("hidden", !show);
  if (!show) return;

  const bothAgreed = agreed || answer === "accepted";
  const canAgree = accepted && !bothAgreed && (!sent || !!answer);
  const canDecline = accepted && !bothAgreed;
  form.classList.toggle("hidden", !(accepted && !sent && !bothAgreed));
  byId("agree-actions").classList.toggle("hidden", !(canAgree || canDecline));
  byId("agree-fare").classList.toggle("hidden", !canAgree);
  byId("decline-fare").classList.toggle("hidden", !canDecline);

  if (underway) {
    text.textContent = "Agreed fare: ₱" + ride.fare + " (cash).";
  } else if (agreed) {
    text.textContent = "You agreed to ₱" + ride.fare + ". Waiting for the driver to leave for your pickup. You can still cancel until he taps I’m on the way.";
  } else if (answer === "accepted") {
    text.textContent = "The driver accepted your offer. The fare is now ₱" + ride.fare + " and you are all set. Waiting for the driver to leave for your pickup.";
  } else if (!sent) {
    text.textContent = "The driver’s fare is ₱" + ride.fare + ". Agree to it, send one lower offer, or decline to look for another driver. The driver can’t leave until you agree.";
  } else if (!answer) {
    text.textContent = "You offered ₱" + ride.counterOffer + ". Waiting for the driver to answer. You can also decline to look for another driver.";
  } else {
    text.textContent = "The driver kept the fare at ₱" + ride.fare + " (you offered ₱" + ride.counterOffer + "). Agree to ₱" + ride.fare + ", or decline to look for another driver.";
  }

  byId("counter-send").onclick = () => sendCounter(rideId, ride.fare);
  byId("agree-fare").textContent = "Agree to ₱" + ride.fare;
  byId("agree-fare").onclick = () => agreeFare(rideId, ride.fare);
  byId("decline-fare").onclick = () => declineFare(rideId);
}

function refusedMessage(error) {
  if (error.code === "permission-denied") {
    return "That was refused. The ride may have changed (for example the driver left, or you already answered). Please look at the ride details.";
  }
  return friendlyError(error);
}

async function sendCounter(rideId, fare) {
  say("");
  const input = byId("counter-input");
  const offer = Number(input.value);
  if (!Number.isInteger(offer) || offer < 1) {
    say("Please type your offer in whole pesos, for example 40.");
    return;
  }
  if (offer >= fare) {
    say("Your offer must be lower than the driver’s fare of ₱" + fare + ".");
    return;
  }
  const ok = await confirmBox({
    title: "Send ₱" + offer + " as your offer?",
    message: "You can send only one counter-offer. The driver will accept it or keep his fare of ₱" + fare + ".",
    okText: "Send offer",
    cancelText: "Not now"
  });
  if (!ok) return;

  const button = byId("counter-send");
  button.disabled = true;
  try {
    await updateDoc(doc(db, "rides", rideId), { counterOffer: offer });
    input.value = "";
    // The live listener redraws the panel.
  } catch (error) {
    say(refusedMessage(error));
  } finally {
    button.disabled = false;
  }
}

async function agreeFare(rideId, fare) {
  say("");
  const ok = await confirmBox({
    title: "Agree to ₱" + fare + "?",
    message: "After you agree, the driver can leave for your pickup. You can still cancel until he taps I’m on the way.",
    okText: "Yes, agree",
    cancelText: "Not yet"
  });
  if (!ok) return;
  const button = byId("agree-fare");
  button.disabled = true;
  try {
    await updateDoc(doc(db, "rides", rideId), { fareAgreed: true });
  } catch (error) {
    say(refusedMessage(error));
  } finally {
    button.disabled = false;
  }
}

async function declineFare(rideId) {
  say("");
  const ok = await confirmBox({
    title: "Decline this driver?",
    message: "Your request will open again so other drivers can accept it. This driver will not have your ride anymore.",
    okText: "Yes, decline",
    cancelText: "Keep this driver",
    danger: true
  });
  if (!ok) return;
  const button = byId("decline-fare");
  button.disabled = true;
  reopenNote = "You declined the driver. Your request is open again for other drivers.";
  try {
    await updateDoc(doc(db, "rides", rideId), REOPEN);
  } catch (error) {
    reopenNote = "";
    say(refusedMessage(error));
  } finally {
    button.disabled = false;
  }
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
  // After the driver taps "I'm on the way", the student can cancel only when 10 minutes have passed.
  const waitedMs = underway && ride.startedAt ? Date.now() - ride.startedAt.toDate().getTime() : 0;
  const canCancelLate = underway && waitedMs >= CANCEL_AFTER_MS;
  clearTimeout(cancelTimer);
  if (underway && ride.startedAt && !canCancelLate) {
    cancelTimer = setTimeout(() => showActive(rideId, ride), CANCEL_AFTER_MS - waitedMs + 1000);
  }

  byId("active-status").textContent = ride.status === "requested"
    ? "Waiting for a driver to accept."
    : accepted
      ? "A driver accepted your request. Please check the fare below. The driver can’t leave until you agree."
      : underway
        ? (canCancelLate
            ? "Your driver is on the way, but it has been over 10 minutes. If he is not coming, you can cancel. You can also call or text him first."
            : "Your driver is on the way. Please call or text him if something changed. You can cancel if he has not arrived after 10 minutes.")
        : "Status: " + ride.status;
  byId("driver-box").classList.toggle("hidden", !hasDriver);
  byId("cancel").classList.toggle("hidden", underway && !canCancelLate);
  byId("cancel").textContent = underway ? "Driver is not here? Cancel the ride" : "Cancel request";
  if (hasDriver) {
    byId("driver-fare").textContent = "₱" + ride.fare;
    byId("driver-name").textContent = ride.driverName;
    byId("driver-vehicle").textContent = ride.vehicleType + " • " + ride.plateNumber;
    const phone = byId("driver-contact");
    phone.textContent = ride.driverContact;
    phone.href = "tel:" + ride.driverContact.replace(/[^0-9+]/g, "");
  }
  showCounter(rideId, ride, accepted);
  byId("active-from").textContent = placeText(ride.pickup, "Pin A on the map");
  byId("active-to").textContent = placeText(ride.dropoff, "Pin B on the map");
  byId("active-until").textContent = whenText(ride.expiresAt.toDate());

  byId("cancel").disabled = ride.status !== "requested" && !accepted && !canCancelLate;
  byId("cancel").onclick = () => cancelRide(rideId, underway);
}

// Marks the request as finished and frees the student to make a new one.
async function endRide(rideId, newStatus) {
  const batch = writeBatch(db);
  batch.update(doc(db, "rides", rideId), { status: newStatus });
  batch.delete(doc(db, "locks", me.user.uid));
  await batch.commit();
}

async function cancelRide(rideId, underway) {
  const ok = await confirmBox(underway
    ? {
        title: "Cancel the ride?",
        message: "The driver said he is on the way. Cancel only if he is not coming. You can report a problem afterwards.",
        okText: "Yes, cancel the ride",
        cancelText: "No, keep it",
        danger: true
      }
    : {
        title: "Cancel this ride request?",
        message: "Your request will be closed. You can make a new one anytime.",
        okText: "Yes, cancel",
        cancelText: "No, keep it",
        danger: true
      });
  if (!ok) return;
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

  if (!ride) {
    // The request is gone (for example the owner deleted it): free the student.
    try {
      await deleteDoc(doc(db, "locks", me.user.uid));
      showPlanner();
      say("Your last request could not be found, so it was cleared. You can make a new one.");
    } catch (error) {
      say("We couldn’t load your open request. Please refresh, or tell the Hatud owner if this keeps happening.");
    }
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
  lastStatus = ride.status;
  showActive(rideId, ride);

  // Keep the page up to date (for example when a driver accepts).
  if (stopWatching) stopWatching();
  stopWatching = onSnapshot(
    doc(db, "rides", rideId),
    (snap) => {
      const latest = snap.data();
      if (!latest) {
        // The request was deleted while the page was open.
        if (stopWatching) { stopWatching(); stopWatching = null; }
        showCurrentState();
        return;
      }
      if (latest.status === "requested" || latest.status === "accepted" || latest.status === "on_the_way") {
        // The ride went back to the open list: say why.
        if (lastStatus === "accepted" && latest.status === "requested") {
          say(reopenNote || "The driver left the ride, so your request is open again for other drivers.");
          reopenNote = "";
        }
        lastStatus = latest.status;
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

// ---------- The student's own blue dot ----------
// Drawn on his own map only. His position stays on his phone: it is never saved,
// and no driver can see it. The only places he shares are the pins he chooses.

let youMarker = null;
let centeredOnYou = false;

function startWatchingMe() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    (position) => {
      const here = L.latLng(position.coords.latitude, position.coords.longitude);
      if (!youMarker) {
        youMarker = L.circleMarker(here, {
          radius: 9, color: "#ffffff", weight: 3, fillColor: "#2563eb", fillOpacity: 1,
          interactive: false // taps near the dot still set pins on the map
        }).addTo(map).bindTooltip("You");
      } else {
        youMarker.setLatLng(here);
      }
      // Centre the map on him once, only if he has not started setting pins.
      if (!centeredOnYou && planning && !pickup && !dropoff) {
        centeredOnYou = true;
        map.setView(here, 15);
      }
    },
    () => { /* Location not allowed: the map still works without the dot. */ },
    { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 }
  );
}

// ---------- Past rides and the 30-day tidy-up ----------
// Finished rides (completed, cancelled, expired) are listed for about 30 days.
// When the page opens, this student's own rides older than that are deleted.
// Nothing here needs a server: it only runs on his phone, for his own rides.

const FINISHED = ["completed", "cancelled", "expired"];
let historyStarted = false;
let tidied = false;

function rideMillis(data) {
  const t = data.completedAt || data.createdAt;
  return t ? t.toDate().getTime() : 0;
}

function historyLine(parent, label, text) {
  const p = document.createElement("p");
  p.className = "ride-line";
  const strong = document.createElement("strong");
  strong.textContent = label + " ";
  p.appendChild(strong);
  p.appendChild(document.createTextNode(text));
  parent.appendChild(p);
}

function renderHistory(past) {
  const list = byId("history-list");
  list.textContent = "";
  byId("history-empty").classList.toggle("hidden", past.length > 0);
  const words = { completed: "Completed", cancelled: "Cancelled", expired: "Expired (no driver)" };

  past.forEach((r) => {
    const d = r.data;
    const item = document.createElement("div");
    item.className = "history-item";
    const when = new Date(rideMillis(d)).toLocaleString([], {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
    });
    const head = document.createElement("p");
    head.className = "ride-line";
    const strong = document.createElement("strong");
    strong.textContent = when + " • " + (words[d.status] || d.status);
    head.appendChild(strong);
    item.appendChild(head);
    historyLine(item, "From:", placeText(d.pickup, "Pin A on the map"));
    historyLine(item, "To:", placeText(d.dropoff, "Pin B on the map"));
    if (d.fare !== null && d.fare !== undefined) historyLine(item, "Fare:", "₱" + d.fare + " (cash)");
    if (d.driverName) historyLine(item, "Driver:", d.driverName + " • " + d.vehicleType + " • " + d.plateNumber);
    addReportControls(item, r.id, d, "student", me.user.uid);
    list.appendChild(item);
  });
}

// Deletes old finished rides (and their private records) in small batches.
async function tidyUp(old) {
  try {
    for (let i = 0; i < old.length; i += 200) {
      const batch = writeBatch(db);
      old.slice(i, i + 200).forEach((r) => {
        batch.delete(doc(db, "rides", r.id, "private", "student"));
        batch.delete(doc(db, "rides", r.id));
      });
      await batch.commit();
    }
  } catch (error) {
    // Not allowed yet (for example a wrong phone clock): the rides stay hidden and it is tried again next time.
    console.warn("Tidy-up skipped:", error.code || error);
  }
}

function startHistory() {
  if (historyStarted) return;
  historyStarted = true;
  onSnapshot(
    query(collection(db, "rides"), where("studentId", "==", me.user.uid)),
    (snapshot) => {
      const now = Date.now();
      const finished = snapshot.docs
        .map((d) => ({ id: d.id, data: d.data() }))
        .filter((r) => FINISHED.includes(r.data.status));
      const isOld = (r) => r.data.deleteAfter && r.data.deleteAfter.toDate().getTime() <= now;
      const recent = finished.filter((r) => !isOld(r)).sort((a, b) => rideMillis(b.data) - rideMillis(a.data));
      renderHistory(recent);
      const old = finished.filter(isOld);
      if (old.length > 0 && !tidied) {
        tidied = true; // once per page load
        tidyUp(old);
      }
    },
    () => { /* History is an extra: the rest of the page still works. */ }
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
    if (session.profile.blocked === true) {
      requestButton.disabled = true;
      requestButton.textContent = "Account blocked";
      say(BLOCKED_TEXT);
      disableReporting(); // a blocked person cannot send reports (W22)
      showAppeal({ uid: session.user.uid, profile: session.profile, before: byId("history") });
    }
    startWatchingMe();
    await showCurrentState();
    await loadReported(session.user.uid);
    startHistory();
  })
  .catch(() => say("Couldn’t load your account. Please check your internet and refresh."));
