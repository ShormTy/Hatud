#!/bin/bash
# Hatud stage 5a: drivers see a live list of open requests.
# Run inside your Hatud folder, then deploy firestore and hosting.
set -e
[ -f firebase.json ] || { echo "Run this inside your Hatud folder."; exit 1; }
cat > firestore.rules <<'HATUD_EOF'
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // ---- Small helper checks ----

    function isSelf(uid) {
      return request.auth != null && request.auth.uid == uid;
    }

    function isText(value, maxLength) {
      return value is string && value.size() > 0 && value.size() <= maxLength;
    }

    function isPhone(value) {
      return value is string && value.matches('^[0-9+() -]{7,20}$');
    }

    // The pilot invite code. Only these rules can read it.
    function pilotCode() {
      return get(/databases/$(database)/documents/settings/pilot).data.inviteCode;
    }

    // ---- settings: never readable or writable from the app ----
    // The owner edits settings/pilot in the Firebase console.
    match /settings/{document=**} {
      allow read, write: if false;
    }

    // ---- users: one profile per person, readable only by that person ----
    match /users/{uid} {
      allow read: if isSelf(uid);
      allow create: if isSelf(uid)
        && (isNewStudent(request.resource.data) || isNewDriver(request.resource.data));
      // No updates or deletes from the app for now.
    }

    function isNewStudent(d) {
      return d.keys().hasOnly(['name', 'role', 'school', 'contactNumber', 'inviteCode', 'createdAt', 'consentAt', 'blocked'])
        && d.keys().hasAll(['name', 'role', 'school', 'contactNumber', 'inviteCode', 'createdAt', 'consentAt', 'blocked'])
        && d.role == 'student'
        && isText(d.name, 60)
        && isText(d.school, 80)
        && isPhone(d.contactNumber)
        && d.createdAt == request.time
        && d.consentAt == request.time
        && d.blocked == false
        && d.inviteCode == pilotCode();
    }

    function isNewDriver(d) {
      return d.keys().hasOnly(['name', 'role', 'contactNumber', 'createdAt', 'consentAt', 'blocked'])
        && d.keys().hasAll(['name', 'role', 'contactNumber', 'createdAt', 'consentAt', 'blocked'])
        && d.role == 'driver'
        && isText(d.name, 60)
        && isPhone(d.contactNumber)
        && d.createdAt == request.time
        && d.consentAt == request.time
        && d.blocked == false;
    }

    // ---- drivers: vehicle details and approval status ----
    // A driver can create only a "pending" record for himself, in the same
    // batch as his users record. The owner switches approvalStatus to
    // "approved" in the Firebase console (the console ignores these rules).
    match /drivers/{uid} {
      allow read: if isSelf(uid);
      allow create: if isSelf(uid)
        && isNewDriverRecord(request.resource.data)
        && getAfter(/databases/$(database)/documents/users/$(uid)).data.role == 'driver';
      // No updates or deletes from the app for now.
    }

    function isNewDriverRecord(d) {
      return d.keys().hasOnly(['vehicleType', 'plateNumber', 'contactNumber', 'approvalStatus', 'available'])
        && d.keys().hasAll(['vehicleType', 'plateNumber', 'contactNumber', 'approvalStatus', 'available'])
        && d.vehicleType in ['tricycle', 'motorcycle', 'car', 'van']
        && isText(d.plateNumber, 12)
        && isPhone(d.contactNumber)
        && d.approvalStatus == 'pending'
        && d.available == false;
    }

    // ---- rides: a student's ride requests ----
    // A request is created together with a small "lock" record (below). The
    // lock can only exist once per student, so a student can have only one open
    // request at a time. Drivers will be able to read open requests in the
    // next stage.
    match /rides/{rideId} {
      // A student reads his own rides. An approved driver can read rides that
      // are still open ("requested"); his query must ask for status == "requested".
      // Expired-but-unclosed requests are hidden by the driver's page, not by the rules
      // (rules cannot compare a query against the phone's clock).
      allow read: if isSelf(resource.data.studentId)
        || (resource.data.status == 'requested' && isApprovedDriver());
      allow create: if isActiveStudent()
        && isNewRide(request.resource.data)
        && existsAfter(/databases/$(database)/documents/locks/$(request.auth.uid))
        && getAfter(/databases/$(database)/documents/locks/$(request.auth.uid)).data.rideId == rideId;
      // The student can only cancel his own open request, or close it once it
      // has really run out of time. Nothing else may change from the student's side.
      allow update: if isSelf(resource.data.studentId)
        && resource.data.status == 'requested'
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['status'])
        && (request.resource.data.status == 'cancelled'
            || (request.resource.data.status == 'expired' && resource.data.expiresAt <= request.time));
    }

    // ---- locks: one per student while a request is open ----
    match /locks/{uid} {
      allow read: if isSelf(uid);
      // Only a create is allowed (no updates), so a second lock cannot be made.
      allow create: if isSelf(uid)
        && request.resource.data.keys().hasOnly(['rideId', 'studentId'])
        && request.resource.data.keys().hasAll(['rideId', 'studentId'])
        && request.resource.data.studentId == uid
        && request.resource.data.rideId is string
        && !exists(/databases/$(database)/documents/rides/$(request.resource.data.rideId))
        && getAfter(/databases/$(database)/documents/rides/$(request.resource.data.rideId)).data.studentId == uid;
      // The lock can go only in the same batch that cancels or expires the ride.
      allow delete: if isSelf(uid)
        && get(/databases/$(database)/documents/rides/$(resource.data.rideId)).data.status == 'requested'
        && getAfter(/databases/$(database)/documents/rides/$(resource.data.rideId)).data.status in ['cancelled', 'expired'];
    }

    // A signed-in driver who is not blocked and whom the owner has approved.
    function isApprovedDriver() {
      return request.auth != null
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'driver'
        && get(/databases/$(database)/documents/users/$(request.auth.uid)).data.blocked == false
        && get(/databases/$(database)/documents/drivers/$(request.auth.uid)).data.approvalStatus == 'approved';
    }

    function isActiveStudent() {
      let account = get(/databases/$(database)/documents/users/$(request.auth.uid)).data;
      return account.role == 'student' && account.blocked == false;
    }

    // A pickup or drop-off point: latitude, longitude (inside Bohol) and a short label.
    function isPoint(p) {
      return p is map
        && p.keys().hasOnly(['lat', 'lng', 'label'])
        && p.keys().hasAll(['lat', 'lng', 'label'])
        && p.lat is number && p.lng is number
        && p.lat >= 9.3 && p.lat <= 10.3
        && p.lng >= 123.6 && p.lng <= 124.8
        && p.label is string && p.label.size() <= 60;
    }

    function isNewRide(d) {
      return d.keys().hasOnly(['studentId', 'driverId', 'pickup', 'dropoff', 'fare', 'counterOffer', 'status', 'neededBy', 'expiresAt', 'createdAt', 'deleteAfter'])
        && d.keys().hasAll(['studentId', 'driverId', 'pickup', 'dropoff', 'fare', 'counterOffer', 'status', 'neededBy', 'expiresAt', 'createdAt', 'deleteAfter'])
        && d.studentId == request.auth.uid
        && d.driverId == null
        && d.fare == null
        && d.counterOffer == null
        && d.status == 'requested'
        && isPoint(d.pickup)
        && isPoint(d.dropoff)
        && d.createdAt == request.time
        // Open for at least a moment and at most 24 hours (plus 15 minutes of slack for phone clocks).
        && d.expiresAt is timestamp
        && d.expiresAt > request.time
        && d.expiresAt <= request.time + duration.value(1455, 'm')
        // "Needed by" is optional, and must fall inside the open time.
        && (d.neededBy == null || (d.neededBy is timestamp && d.neededBy <= d.expiresAt))
        // The record is kept for about 30 days (the tidy-up step comes later).
        && d.deleteAfter is timestamp
        && d.deleteAfter > request.time + duration.value(29, 'd')
        && d.deleteAfter <= request.time + duration.value(31, 'd');
    }

    // Everything not listed above is denied.
  }
}
HATUD_EOF
cat > public/driver.html <<'HATUD_EOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hatud: Driver</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css">
  <link rel="stylesheet" href="css/app.css">
  <link rel="stylesheet" href="css/app-pages.css">
</head>
<body class="app-page">
  <header class="topbar">
    <strong>Hatud</strong>
    <span id="hello"></span>
    <button class="link-button" id="signout" type="button">Sign out</button>
  </header>

  <section class="panel">
    <p class="status hidden" id="vehicle"></p>
    <p class="status" id="status">Loading…</p>
  </section>

  <!-- Shown only to approved drivers -->
  <div id="open-area" class="hidden">
    <div id="map" role="application" aria-label="Map of the selected request"></div>
    <section class="panel">
      <h2 class="panel-title">Open requests</h2>
      <p class="hint" id="empty">No open requests right now. New ones appear here by themselves.</p>
      <div id="requests"></div>
    </section>
  </div>

  <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
  <script type="module" src="js/driver.js"></script>
</body>
</html>
HATUD_EOF
cat > public/js/driver.js <<'HATUD_EOF'
// Driver page: an approved driver sees a live list of open ride requests.
// (Accepting a request, with a fare, comes in the next step.)
import { requireRole, logOut } from "./session.js";
import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const L = window.L; // Leaflet, loaded by driver.html
const byId = (id) => document.getElementById(id);

const TAGBILARAN = [9.6472, 123.855];

const status = byId("status");
let map = null;
let shownPins = [];
let rides = [];          // open requests as last received: [{ id, data }]
let selectedId = null;

byId("signout").addEventListener("click", () => logOut());

// ---------- Map ----------

function pinIcon(letter, kind) {
  return L.divIcon({
    className: "pin pin-" + kind,
    html: "<span>" + letter + "</span>",
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

function startMap() {
  map = L.map("map").setView(TAGBILARAN, 14);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap</a> contributors"
  }).addTo(map);
}

function clearPins() {
  shownPins.forEach((pin) => map.removeLayer(pin));
  shownPins = [];
}

function showOnMap(ride) {
  clearPins();
  const from = L.latLng(ride.pickup.lat, ride.pickup.lng);
  const to = L.latLng(ride.dropoff.lat, ride.dropoff.lng);
  shownPins = [
    L.marker(from, { icon: pinIcon("A", "pickup"), interactive: false }).addTo(map),
    L.marker(to, { icon: pinIcon("B", "dropoff"), interactive: false }).addTo(map)
  ];
  map.fitBounds(L.latLngBounds([from, to]), { padding: [40, 40], maxZoom: 17 });
}

// ---------- The list ----------

function whenText(date) {
  return date.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
}

function placeText(point, fallback) {
  return point.label ? point.label : fallback;
}

function line(label, text) {
  const p = document.createElement("p");
  p.className = "ride-line";
  const strong = document.createElement("strong");
  strong.textContent = label + " ";
  p.appendChild(strong);
  p.appendChild(document.createTextNode(text));
  return p;
}

function renderList() {
  const now = Date.now();
  // Hide requests that ran out of time but were not closed yet. Oldest deadline first.
  const open = rides
    .filter((r) => r.data.expiresAt.toDate().getTime() > now)
    .sort((a, b) => a.data.expiresAt.toMillis() - b.data.expiresAt.toMillis());

  byId("empty").classList.toggle("hidden", open.length > 0);
  const box = byId("requests");
  box.textContent = "";

  if (selectedId && !open.some((r) => r.id === selectedId)) {
    selectedId = null;
    clearPins();
  }

  open.forEach(({ id, data }) => {
    const card = document.createElement("article");
    card.className = "request-card" + (id === selectedId ? " selected" : "");

    const km = map.distance(
      L.latLng(data.pickup.lat, data.pickup.lng),
      L.latLng(data.dropoff.lat, data.dropoff.lng)
    ) / 1000;

    card.appendChild(line("From (A):", placeText(data.pickup, "Pin A on the map")));
    card.appendChild(line("To (B):", placeText(data.dropoff, "Pin B on the map")));
    card.appendChild(line("Distance:", "about " + km.toFixed(1) + " km in a straight line"));
    if (data.neededBy) card.appendChild(line("Needed by:", whenText(data.neededBy.toDate())));
    card.appendChild(line("Open until:", whenText(data.expiresAt.toDate())));

    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = "Show on map";
    button.addEventListener("click", () => {
      selectedId = id;
      showOnMap(data);
      renderList();
      byId("map").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    card.appendChild(button);

    box.appendChild(card);
  });
}

function startListening() {
  const openRides = query(collection(db, "rides"), where("status", "==", "requested"));
  onSnapshot(
    openRides,
    (snapshot) => {
      rides = snapshot.docs.map((d) => ({ id: d.id, data: d.data() }));
      renderList();
    },
    () => {
      status.textContent = "Couldn’t load the requests. Please check your internet and refresh.";
    }
  );
  // Requests run out of time while the page stays open, so re-check every 30 seconds.
  setInterval(renderList, 30 * 1000);
}

// ---------- Start ----------

requireRole("driver")
  .then(async ({ user, profile }) => {
    byId("hello").textContent = profile.name;
    const snap = await getDoc(doc(db, "drivers", user.uid));
    const driver = snap.exists() ? snap.data() : null;

    if (driver) {
      byId("vehicle").textContent = driver.vehicleType + " • " + driver.plateNumber;
      byId("vehicle").classList.remove("hidden");
    }

    if (driver && driver.approvalStatus === "approved" && profile.blocked !== true) {
      status.textContent = "Approved. Accepting a request comes in the next step.";
      byId("open-area").classList.remove("hidden");
      startMap();
      startListening();
    } else {
      status.textContent = "Waiting for approval. The owner will meet you to check your papers.";
    }
  })
  .catch(() => {
    status.textContent = "Couldn’t load your account. Please check your internet and refresh.";
  });
HATUD_EOF
cat > public/css/app-pages.css <<'HATUD_EOF'
/* Styles for the pages after login (student.html, driver.html). */
body.app-page { display: block; padding: 0; min-height: 100vh; }
.topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--card);
  border-bottom: 1px solid var(--line);
}
.topbar strong { color: var(--brand); font-size: 20px; }
.topbar span {
  flex: 1;
  min-width: 0;
  color: var(--muted);
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.link-button {
  padding: 8px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font-size: 14px;
  cursor: pointer;
}
#map { width: 100%; height: 55vh; min-height: 280px; }
.panel { max-width: 520px; margin: 0 auto; padding: 16px; }
.secondary {
  width: 100%;
  margin-top: 10px;
  padding: 11px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: transparent;
  color: var(--text);
  font-size: 15px;
  cursor: pointer;
}
.pin span {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 2px solid #ffffff;
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  color: #ffffff;
  font-weight: 700;
}
.pin-pickup span { background: #0f766e; }
.pin-dropoff span { background: #c2410c; }

/* Request form additions */
input[type="range"] {
  padding: 0;
  border: 0;
  background: transparent;
  accent-color: var(--brand);
}
input[type="datetime-local"] { min-height: 46px; }
.panel-title { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
.ride-line { margin: 6px 0; font-size: 15px; }
.ride-line strong { color: var(--muted); font-weight: 600; }

/* Driver: list of open requests */
.request-card {
  margin: 0 0 12px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--card);
}
.request-card.selected { border-color: var(--brand); }
HATUD_EOF
echo "Done. Now run: firebase deploy --only firestore  then  firebase deploy --only hosting"
