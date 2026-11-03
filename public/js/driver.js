// Driver page: an approved driver sees a live list of open ride requests,
// accepts one by typing a fare, and then sees the student's details.
import { requireRole, logOut } from "./session.js";
import { db } from "./firebase.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  onSnapshot,
  runTransaction,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const L = window.L; // Leaflet, loaded by driver.html
const byId = (id) => document.getElementById(id);

const TAGBILARAN = [9.6472, 123.855];

const status = byId("status");
const note = byId("note");
let me = null;           // { user, profile }
let vehicle = null;      // this driver's record (vehicle type, plate, contact)
let map = null;
let shownPins = [];
let rides = [];          // open requests as last received: [{ id, data }]
let myRides = [];        // rides this driver has accepted: [{ id, data }]
let selectedId = null;
let currentId = null;    // the ride shown in "Your current ride"
const typedFares = {};   // what the driver typed per request, kept while the list redraws

byId("signout").addEventListener("click", () => logOut());

function say(text) {
  note.textContent = text;
  note.classList.toggle("hidden", !text);
}

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

// ---------- Helpers ----------

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

function friendlyError(error) {
  switch (error.code) {
    case "taken":
    case "permission-denied":
      return "Sorry, this request was already taken, cancelled, or has run out of time.";
    case "unavailable":
    case "network-request-failed":
      return "No internet connection. Please try again.";
    default:
      return "Something went wrong (" + (error.code || "unknown") + "). Please try again.";
  }
}

// ---------- Accepting a request ----------

async function accept(id, fareText) {
  say("");
  const fare = Number(fareText);
  if (!fareText || !Number.isInteger(fare) || fare < 1 || fare > 5000) {
    say("Please type the fare in whole pesos, from 1 to 5000.");
    return;
  }
  if (!window.confirm("Accept this ride for ₱" + fare + "?")) return;

  try {
    // The first driver to get here wins. If someone else accepted a moment
    // earlier, the status is no longer "requested" and this stops.
    await runTransaction(db, async (transaction) => {
      const ref = doc(db, "rides", id);
      const snap = await transaction.get(ref);
      const ride = snap.exists() ? snap.data() : null;
      if (!ride || ride.status !== "requested" || ride.expiresAt.toDate().getTime() <= Date.now()) {
        const taken = new Error("taken");
        taken.code = "taken";
        throw taken;
      }
      transaction.update(ref, {
        status: "accepted",
        driverId: me.user.uid,
        fare,
        driverName: me.profile.name,
        vehicleType: vehicle.vehicleType,
        plateNumber: vehicle.plateNumber,
        driverContact: vehicle.contactNumber,
        acceptedAt: serverTimestamp()
      });
    });
    delete typedFares[id];
    // The live listener below now shows "Your current ride".
  } catch (error) {
    say(friendlyError(error));
  }
}

// ---------- The open list ----------

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
    if (!currentId) clearPins();
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

    const show = document.createElement("button");
    show.type = "button";
    show.className = "secondary";
    show.textContent = "Show on map";
    show.addEventListener("click", () => {
      selectedId = id;
      showOnMap(data);
      renderList();
      byId("map").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    card.appendChild(show);

    const label = document.createElement("label");
    label.textContent = "Your fare in pesos (cash)";
    const fareInput = document.createElement("input");
    fareInput.type = "number";
    fareInput.inputMode = "numeric";
    fareInput.min = "1";
    fareInput.max = "5000";
    fareInput.step = "1";
    fareInput.placeholder = "For example 50";
    fareInput.value = typedFares[id] || "";
    fareInput.addEventListener("input", () => { typedFares[id] = fareInput.value; });
    label.appendChild(fareInput);
    card.appendChild(label);

    const acceptButton = document.createElement("button");
    acceptButton.type = "button";
    acceptButton.className = "primary";
    acceptButton.textContent = "Accept ride";
    acceptButton.addEventListener("click", async () => {
      acceptButton.disabled = true;
      await accept(id, fareInput.value.trim());
      acceptButton.disabled = false;
    });
    card.appendChild(acceptButton);

    box.appendChild(card);
  });
}

// ---------- Driver's own live map (his position stays on his phone) ----------
// His GPS position is drawn on his own map only; nothing about it is saved to the
// database. To draw road routes, the start and end points of each route are sent
// to OpenStreetMap's free public routing server (OSRM), which is why route
// requests are kept few.

const OSRM = "https://router.project-osrm.org/route/v1/driving/";
let watchId = null;
let youMarker = null;
let legs = { toPickup: null, pickupToDrop: null };
let tracked = null;           // the ride being followed
let lastRouteFrom = null;
let lastRouteAt = 0;
let legInfo = { toPickup: "", pickupToDrop: "" };
let gpsFirstFix = true;

async function fetchRoute(from, to) {
  const url = OSRM + from.lng + "," + from.lat + ";" + to.lng + "," + to.lat
    + "?overview=full&geometries=geojson";
  const response = await fetch(url);
  if (!response.ok) throw new Error("route " + response.status);
  const json = await response.json();
  if (json.code !== "Ok" || !json.routes.length) throw new Error("no route");
  const route = json.routes[0];
  return {
    points: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    km: route.distance / 1000,
    minutes: route.duration / 60
  };
}

function setLeg(key, points, style) {
  if (legs[key]) map.removeLayer(legs[key]);
  legs[key] = points ? L.polyline(points, style).addTo(map) : null;
}

function legText(label, km, minutes) {
  return label + ": " + km.toFixed(1) + " km, about " + Math.max(1, Math.round(minutes)) + " min";
}

function showRouteInfo() {
  const parts = [legInfo.toPickup, legInfo.pickupToDrop].filter(Boolean);
  byId("route-info").textContent = parts.join("  •  ");
  byId("route-info").classList.toggle("hidden", parts.length === 0);
}

// Draws one leg of the trip. If the road route can't be loaded, it falls back
// to a dashed straight line so the driver still sees the direction.
async function drawLeg(key, from, to, style, label, ride) {
  try {
    const route = await fetchRoute(from, to);
    if (tracked !== ride) return;
    setLeg(key, route.points, style);
    legInfo[key] = legText(label, route.km, route.minutes);
  } catch (error) {
    if (tracked !== ride) return;
    setLeg(key, [from, to], Object.assign({}, style, { dashArray: "6 8" }));
    legInfo[key] = label + ": road route unavailable (straight line shown)";
  }
  showRouteInfo();
}

function onPosition(position, ride) {
  if (tracked !== ride) return;
  const here = L.latLng(position.coords.latitude, position.coords.longitude);
  if (!youMarker) {
    youMarker = L.circleMarker(here, {
      radius: 9, color: "#ffffff", weight: 3, fillColor: "#2563eb", fillOpacity: 1
    }).addTo(map);
  } else {
    youMarker.setLatLng(here);
  }

  const pickup = L.latLng(ride.pickup.lat, ride.pickup.lng);
  const dropoff = L.latLng(ride.dropoff.lat, ride.dropoff.lng);

  if (gpsFirstFix) {
    gpsFirstFix = false;
    map.fitBounds(L.latLngBounds([here, pickup, dropoff]), { padding: [40, 40], maxZoom: 17 });
  }

  // Near the pickup point: the first leg is done, only pickup to drop-off remains.
  if (map.distance(here, pickup) < 80) {
    setLeg("toPickup", null);
    legInfo.toPickup = "You are at the pickup point";
    showRouteInfo();
    return;
  }

  // Redraw the way to the pickup only after he has moved a good way, and not too often.
  const now = Date.now();
  const moved = !lastRouteFrom || map.distance(lastRouteFrom, here) > 150;
  if (moved && now - lastRouteAt > 20000) {
    lastRouteFrom = here;
    lastRouteAt = now;
    drawLeg("toPickup", here, pickup, { color: "#2563eb", weight: 5, opacity: 0.85 }, "To pickup", ride);
  }
}

function startTracking(ride) {
  stopTracking();
  tracked = ride;
  const pickup = L.latLng(ride.pickup.lat, ride.pickup.lng);
  const dropoff = L.latLng(ride.dropoff.lat, ride.dropoff.lng);
  // Pickup to drop-off is drawn once.
  drawLeg("pickupToDrop", pickup, dropoff, { color: "#c2410c", weight: 5, opacity: 0.85 }, "Pickup to drop-off", ride);

  if (!navigator.geolocation) {
    legInfo.toPickup = "This phone can’t share its position, so only the trip route is shown.";
    showRouteInfo();
    return;
  }
  watchId = navigator.geolocation.watchPosition(
    (position) => onPosition(position, ride),
    () => {
      legInfo.toPickup = "Allow location access to see your position and the way to the pickup.";
      showRouteInfo();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}

function stopTracking() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  tracked = null;
  if (youMarker) { map.removeLayer(youMarker); youMarker = null; }
  setLeg("toPickup", null);
  setLeg("pickupToDrop", null);
  lastRouteFrom = null;
  lastRouteAt = 0;
  legInfo = { toPickup: "", pickupToDrop: "" };
  gpsFirstFix = true;
  showRouteInfo();
}

// ---------- Current ride ----------

// Moves the current ride forward: accepted -> on the way -> completed.
async function advance(id, status) {
  say("");
  const button = byId("advance");
  if (status === "on_the_way") {
    if (!window.confirm("Tap OK when you are leaving for the pickup. The student can no longer cancel after this.")) return;
  } else if (!window.confirm("Mark this ride as completed?")) {
    return;
  }
  button.disabled = true;
  try {
    await updateDoc(doc(db, "rides", id),
      status === "on_the_way"
        ? { status: "on_the_way", startedAt: serverTimestamp() }
        : { status: "completed", completedAt: serverTimestamp() });
    // The live listener redraws the panel.
  } catch (error) {
    say(friendlyError(error));
  } finally {
    button.disabled = false;
  }
}

function isActiveRide(r) {
  return r.data.status === "accepted" || r.data.status === "on_the_way";
}

async function renderCurrent() {
  const active = myRides.find(isActiveRide);

  // A ride this driver was on has ended.
  if (!active && currentId) {
    const gone = myRides.find((r) => r.id === currentId);
    if (gone && gone.data.status === "cancelled") say("The student cancelled the ride.");
    if (gone && gone.data.status === "completed") say("Ride completed. Thank you!");
  }

  byId("current").classList.toggle("hidden", !active);
  byId("open-area-list").classList.toggle("hidden", !!active);

  if (!active) {
    currentId = null;
    stopTracking();
    return;
  }
  // The status line and the button follow the ride's status every time.
  const underway = active.data.status === "on_the_way";
  byId("current-status").textContent = underway
    ? "You are on the way. Tap Completed when the ride is done."
    : "Accepted. The student can still cancel until you tap I’m on the way.";
  byId("advance").textContent = underway ? "Completed" : "I’m on the way";
  byId("advance").onclick = () => advance(active.id, underway ? "completed" : "on_the_way");
  byId("current-hint").textContent = underway
    ? ""
    : "Tap the button when you leave for the pickup.";

  if (currentId === active.id) return; // the details below are already shown
  currentId = active.id;

  const data = active.data;
  byId("current-fare").textContent = "₱" + data.fare;
  byId("current-from").textContent = placeText(data.pickup, "Pin A on the map");
  byId("current-to").textContent = placeText(data.dropoff, "Pin B on the map");
  byId("current-student").textContent = "Loading…";
  byId("current-contact").textContent = "";
  byId("current-contact").removeAttribute("href");
  showOnMap(data);
  startTracking(data);

  try {
    const snap = await getDoc(doc(db, "rides", active.id, "private", "student"));
    if (currentId !== active.id) return;
    if (snap.exists()) {
      const student = snap.data();
      byId("current-student").textContent = student.name;
      const phone = byId("current-contact");
      phone.textContent = student.contactNumber;
      phone.href = "tel:" + student.contactNumber.replace(/[^0-9+]/g, "");
    } else {
      byId("current-student").textContent = "Details not available for this older request";
    }
  } catch (error) {
    byId("current-student").textContent = "Couldn’t load the student’s details. Please refresh.";
  }
}

// ---------- Listening ----------

function startListening() {
  const fail = () => {
    status.textContent = "Couldn’t load the requests. Please check your internet and refresh.";
  };

  onSnapshot(
    query(collection(db, "rides"), where("status", "==", "requested")),
    (snapshot) => {
      rides = snapshot.docs.map((d) => ({ id: d.id, data: d.data() }));
      renderList();
    },
    fail
  );

  onSnapshot(
    query(collection(db, "rides"), where("driverId", "==", me.user.uid)),
    (snapshot) => {
      myRides = snapshot.docs.map((d) => ({ id: d.id, data: d.data() }));
      renderCurrent();
    },
    fail
  );

  // Requests run out of time while the page stays open, so re-check every 30 seconds.
  // (The list is not redrawn while the driver is typing a fare.)
  setInterval(() => {
    if (document.activeElement && document.activeElement.tagName === "INPUT") return;
    renderList();
  }, 30 * 1000);
}

// ---------- Start ----------

requireRole("driver")
  .then(async (session) => {
    me = session;
    byId("hello").textContent = session.profile.name;
    const snap = await getDoc(doc(db, "drivers", session.user.uid));
    vehicle = snap.exists() ? snap.data() : null;

    if (vehicle) {
      byId("vehicle").textContent = vehicle.vehicleType + " • " + vehicle.plateNumber;
      byId("vehicle").classList.remove("hidden");
    }

    if (vehicle && vehicle.approvalStatus === "approved" && session.profile.blocked !== true) {
      status.textContent = "Approved. Type a fare and tap Accept ride on a request.";
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
