// Driver page: an approved driver sees a live list of open ride requests,
// accepts one by typing a fare, and then sees the student's details.
import { requireRole, logOut } from "./session.js";
import { db } from "./firebase.js";
import { makeCaps } from "./caps.js";
import { addReportControls, loadReported } from "./report.js";
import { confirmBox } from "./dialog.js";
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
const ACCEPT_HELP = "Type your fare and tap Accept ride on a request.";
const note = byId("note");
let me = null;           // { user, profile }
let vehicle = null;      // this driver's record (vehicle type, plate, contact)
let map = null;
let shownPins = [];
let rides = [];          // open requests as last received: [{ id, data }]
let myRides = [];        // rides this driver has accepted: [{ id, data }]
let selectedId = null;
let centeredOnDriver = false;
let driverPos = null;    // the driver's own position (stays on his phone, never saved)
let lastListPos = null;  // where the list was last sorted from
let roadAway = {};       // road distance to each pickup: { rideId: { km, min } }
let roadFrom = null;     // where the driver was when the road distances were fetched
let roadAt = 0;          // when they were last fetched (or when to try again after a failure)
let roadKey = "";        // which requests the road distances cover
let roadBusy = false;
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

// The driver's own blue dot. One marker is shared by the list and the current ride;
// his position stays on his phone and is never saved.
function showYou(here) {
  if (!map) return;
  if (!youMarker) {
    youMarker = L.circleMarker(here, {
      radius: 9, color: "#ffffff", weight: 3, fillColor: "#2563eb", fillOpacity: 1
    }).addTo(map).bindTooltip("You");
  } else {
    youMarker.setLatLng(here);
  }
}

// A numbered pin for every open request, matching the order of the cards. Drawing
// them costs nothing: it happens on the phone, with no extra network use.
const requestPins = {};

function numberIcon(number) {
  return L.divIcon({
    className: "pin pin-req",
    html: "<span>" + number + "</span>",
    iconSize: [30, 30],
    iconAnchor: [15, 15]
  });
}

function updateRequestPins(open) {
  const wanted = new Set(currentId ? [] : open.map((r) => r.id));
  Object.keys(requestPins).forEach((id) => {
    if (!wanted.has(id) || id === selectedId) {
      map.removeLayer(requestPins[id]);
      delete requestPins[id];
    }
  });
  if (currentId) return;
  open.forEach(({ id, data }, index) => {
    if (id === selectedId) return; // the selected one is drawn with its A and B pins
    if (requestPins[id]) {
      requestPins[id].setIcon(numberIcon(index + 1));
    } else {
      requestPins[id] = L.marker([data.pickup.lat, data.pickup.lng], { icon: numberIcon(index + 1) })
        .addTo(map)
        .on("click", () => {
          selectedId = id;
          showOnMap(data);
          renderList();
        });
    }
  });
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
  const ok = await confirmBox({
    title: "Accept this ride for ₱" + fare + "?",
    message: "No other driver can take it once you accept. The student then agrees to the fare, makes one counter-offer, or declines.",
    okText: "Accept ride",
    cancelText: "Not yet"
  });
  if (!ok) return;

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
      const mineSnap = await transaction.get(doc(db, "drivers", me.user.uid));
      const mine = mineSnap.data();
      transaction.update(ref, {
        status: "accepted",
        driverId: me.user.uid,
        fare,
        driverName: me.profile.name,
        vehicleType: mine.vehicleType,
        plateNumber: mine.plateNumber,
        driverContact: mine.contactNumber,
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
  // Hide requests that ran out of time but were not closed yet.
  const open = rides
    .filter((r) => r.data.expiresAt.toDate().getTime() > now)
    .map((r) => {
      // Straight-line distance from the driver to the pickup point, in km (null if his position is unknown).
      const straight = driverPos
        ? driverPos.distanceTo(L.latLng(r.data.pickup.lat, r.data.pickup.lng)) / 1000
        : null;
      // Distance by road, when the routing service has answered.
      const road = roadAway[r.id] || null;
      return { ...r, straight, road, away: road ? road.km : straight };
    });

  // Nearest pickup first when his position is known; otherwise the ones closing soonest first.
  if (driverPos) {
    open.sort((a, b) => a.away - b.away || a.data.expiresAt.toMillis() - b.data.expiresAt.toMillis());
  } else {
    open.sort((a, b) => a.data.expiresAt.toMillis() - b.data.expiresAt.toMillis());
  }
  lastListPos = driverPos;

  const anyRoad = open.some((r) => r.road);
  byId("sort-hint").textContent = driverPos
    ? (anyRoad
        ? "Sorted from the nearest pickup to the farthest, by road."
        : "Sorted from the nearest pickup to the farthest. Road distances are loading; until then the distance is in a straight line.")
    : "Allow location access to see how far each pickup is from you and to sort the nearest first. Until then, the ones closing soonest are on top.";
  byId("sort-hint").classList.toggle("hidden", open.length === 0);

  // The "type a fare" instruction at the top shows only when there is something to accept.
  if (status.textContent === ACCEPT_HELP || status.textContent === "") {
    const showHelp = open.length > 0 && !currentId;
    status.textContent = showHelp ? ACCEPT_HELP : "";
    status.classList.toggle("hidden", !showHelp);
  }

  byId("empty").classList.toggle("hidden", open.length > 0);
  const box = byId("requests");
  box.textContent = "";

  if (selectedId && !open.some((r) => r.id === selectedId)) {
    selectedId = null;
    if (!currentId) clearPins();
  }

  open.forEach(({ id, data, away, road }) => {
    const card = document.createElement("article");
    card.className = "request-card" + (id === selectedId ? " selected" : "");

    const km = map.distance(
      L.latLng(data.pickup.lat, data.pickup.lng),
      L.latLng(data.dropoff.lat, data.dropoff.lng)
    ) / 1000;

    if (away !== null) {
      card.appendChild(line(
        "Pickup is from you:",
        road
          ? "about " + road.km.toFixed(1) + " km by road (about " + Math.max(1, Math.round(road.min)) + " min)"
          : "about " + away.toFixed(1) + " km in a straight line"
      ));
    }
    card.appendChild(line("From (A):", placeText(data.pickup, "Pin A on the map")));
    card.appendChild(line("To (B):", placeText(data.dropoff, "Pin B on the map")));
    card.appendChild(line(
      "Trip distance:",
      road && road.tripKm !== undefined
        ? "about " + road.tripKm.toFixed(1) + " km by road (about " + Math.max(1, Math.round(road.tripMin)) + " min)"
        : "about " + km.toFixed(1) + " km in a straight line"
    ));
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

  updateRequestPins(open);
  maybeFetchRoadDistances(open);
}

// Asks the free public routing service (OSRM) for the road distance from the driver to
// ALL open pickups in one request. It asks again only when a request appears or goes,
// or the driver has moved over 150 m, and at most every 10 seconds. If it fails, the
// list keeps working with straight-line distances and tries again after a minute.
async function maybeFetchRoadDistances(open) {
  if (!driverPos || roadBusy || open.length === 0) return;
  const key = open.map((r) => r.id).sort().join(",");
  const moved = !roadFrom || driverPos.distanceTo(roadFrom) > 150;
  if (key === roadKey && !moved) return;
  if (Date.now() - roadAt < 10000) return;

  // At most 25 requests (the nearest ones) get road distances; the rest keep straight lines.
  const batch = [...open].sort((a, b) => a.straight - b.straight).slice(0, 25);
  roadBusy = true;
  roadAt = Date.now();
  const from = driverPos;
  try {
    // Points in order: the driver (0), then every pickup (1..n), then every drop-off (n+1..2n).
    const n = batch.length;
    const points = [
      from,
      ...batch.map((r) => L.latLng(r.data.pickup.lat, r.data.pickup.lng)),
      ...batch.map((r) => L.latLng(r.data.dropoff.lat, r.data.dropoff.lng))
    ];
    const coords = points.map((p) => p.lng + "," + p.lat).join(";");
    const sources = Array.from({ length: n + 1 }, (_, i) => i).join(";");
    const destinations = Array.from({ length: 2 * n }, (_, i) => i + 1).join(";");
    const response = await fetch(
      "https://router.project-osrm.org/table/v1/driving/" + coords
        + "?sources=" + sources + "&destinations=" + destinations + "&annotations=distance,duration"
    );
    if (!response.ok) throw new Error("table " + response.status);
    const json = await response.json();
    if (json.code !== "Ok") throw new Error("table " + json.code);

    const next = {};
    batch.forEach((r, i) => {
      // Row 0 is the driver; row i + 1 is pickup i. Columns start at point 1.
      const meters = json.distances[0][i];
      const seconds = json.durations[0][i];
      const tripMeters = json.distances[i + 1][n + i];
      const tripSeconds = json.durations[i + 1][n + i];
      if (meters !== null && seconds !== null) {
        next[r.id] = { km: meters / 1000, min: seconds / 60 };
        if (tripMeters !== null && tripSeconds !== null) {
          next[r.id].tripKm = tripMeters / 1000;
          next[r.id].tripMin = tripSeconds / 60;
        }
      }
    });
    roadAway = next;
    roadFrom = from;
    roadKey = key;
    const typing = document.activeElement && document.activeElement.tagName === "INPUT";
    if (!typing) renderList();
  } catch (error) {
    roadAt = Date.now() + 60 * 1000; // wait a minute before trying again
  } finally {
    roadBusy = false;
  }
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
  showYou(here);

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
  const ok = await confirmBox(status === "on_the_way"
    ? {
        title: "Leave for the pickup now?",
        message: "Tap Yes when you are leaving. After this the student can cancel only if you have not arrived within 10 minutes.",
        okText: "Yes, I’m on the way",
        cancelText: "Not yet"
      }
    : {
        title: "Mark this ride as completed?",
        message: "Do this when the student has been dropped off and the fare is paid.",
        okText: "Yes, completed",
        cancelText: "Not yet"
      });
  if (!ok) return;
  button.disabled = true;
  try {
    await updateDoc(doc(db, "rides", id),
      status === "on_the_way"
        ? { status: "on_the_way", startedAt: serverTimestamp() }
        : { status: "completed", completedAt: serverTimestamp() });
    // The live listener redraws the panel.
  } catch (error) {
    say(error.code === "permission-denied"
      ? "That was refused. The student may not have agreed to the fare yet, or the ride changed."
      : friendlyError(error));
  } finally {
    button.disabled = false;
  }
}

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
let releasedByMe = false;

// The driver gives the ride back (before "On the way"): other drivers can accept it.
async function releaseRide(id) {
  say("");
  const ok = await confirmBox({
    title: "Release this ride?",
    message: "The request goes back to the open list for other drivers, and you will no longer see the student’s details. Release it only if you can’t take this ride.",
    okText: "Yes, release",
    cancelText: "Keep the ride",
    danger: true
  });
  if (!ok) return;
  const button = byId("release");
  button.disabled = true;
  releasedByMe = true;
  try {
    await updateDoc(doc(db, "rides", id), REOPEN);
    say("You released the ride. It is open for other drivers again.");
  } catch (error) {
    releasedByMe = false;
    say(error.code === "permission-denied"
      ? "That was refused. The ride may have changed (for example the student cancelled)."
      : friendlyError(error));
  } finally {
    button.disabled = false;
  }
}

function isActiveRide(r) {
  return r.data.status === "accepted" || r.data.status === "on_the_way";
}

// ---------- Counter-offer from the student (one time only) ----------

function isCounterPending(data) {
  const sent = data.counterOffer !== null && data.counterOffer !== undefined;
  return data.status === "accepted" && sent && !data.counterAnswer;
}

async function answerCounter(id, accept, offer) {
  say("");
  const ok = await confirmBox(accept
    ? {
        title: "Accept the offer of ₱" + offer + "?",
        message: "The fare will change to ₱" + offer + " and the student does not need to agree again.",
        okText: "Accept ₱" + offer,
        cancelText: "Not yet"
      }
    : {
        title: "Keep your fare?",
        message: "You say no to the offer. The student can then agree to your fare, or decline and look for another driver.",
        okText: "Keep my fare",
        cancelText: "Not yet"
      });
  if (!ok) return;
  const accepted = byId("counter-accept");
  const kept = byId("counter-keep");
  accepted.disabled = true;
  kept.disabled = true;
  try {
    await updateDoc(doc(db, "rides", id),
      accept ? { counterAnswer: "accepted", fare: offer } : { counterAnswer: "kept" });
    // The live listener redraws the panel.
  } catch (error) {
    say(friendlyError(error));
  } finally {
    accepted.disabled = false;
    kept.disabled = false;
  }
}

function renderCounter(ride) {
  const data = ride.data;
  const sent = data.counterOffer !== null && data.counterOffer !== undefined;
  const panel = byId("counter-panel");
  panel.classList.toggle("hidden", !sent);
  if (!sent) return;

  const pending = isCounterPending(data);
  byId("counter-accept").classList.toggle("hidden", !pending);
  byId("counter-keep").classList.toggle("hidden", !pending);

  if (pending) {
    byId("counter-info").textContent = "The student offers ₱" + data.counterOffer + " instead of ₱" + data.fare + ". Answer once: accept it, or keep your fare.";
    byId("counter-accept").textContent = "Accept ₱" + data.counterOffer;
    byId("counter-accept").onclick = () => answerCounter(ride.id, true, data.counterOffer);
    byId("counter-keep").onclick = () => answerCounter(ride.id, false, data.counterOffer);
  } else if (data.counterAnswer === "accepted") {
    byId("counter-info").textContent = "You accepted the student’s offer. The fare is now ₱" + data.fare + ".";
  } else if (data.counterAnswer === "kept") {
    byId("counter-info").textContent = "You kept your fare of ₱" + data.fare + " (the student offered ₱" + data.counterOffer + ").";
  } else {
    byId("counter-info").textContent = "The student offered ₱" + data.counterOffer + ".";
  }
}

// ---------- Past rides (about 30 days) ----------
// The page already listens to every ride this driver accepted, so the list costs
// no extra reads. Rides older than 30 days are hidden here and are removed from the
// database when the student's app tidies up.

const FINISHED = ["completed", "cancelled"];

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

function renderHistory() {
  const now = Date.now();
  const past = myRides
    .filter((r) => FINISHED.includes(r.data.status)
      && (!r.data.deleteAfter || r.data.deleteAfter.toDate().getTime() > now))
    .sort((a, b) => rideMillis(b.data) - rideMillis(a.data));

  byId("history").classList.toggle("hidden", past.length === 0);
  const list = byId("history-list");
  list.textContent = "";

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
    strong.textContent = when + " • " + (d.status === "completed" ? "Completed" : "Cancelled");
    head.appendChild(strong);
    item.appendChild(head);
    historyLine(item, "From:", placeText(d.pickup, "Pin A on the map"));
    historyLine(item, "To:", placeText(d.dropoff, "Pin B on the map"));
    if (d.fare !== null && d.fare !== undefined) historyLine(item, "Fare:", "₱" + d.fare + " (cash)");
    addReportControls(item, r.id, d, "driver", me.user.uid);
    list.appendChild(item);
  });
}

async function renderCurrent() {
  renderHistory();
  const active = myRides.find(isActiveRide);

  // A ride this driver was on has ended.
  if (!active && currentId) {
    const gone = myRides.find((r) => r.id === currentId);
    if (gone && gone.data.status === "cancelled") say("The student cancelled the ride.");
    if (gone && gone.data.status === "completed") say("Ride completed. Thank you!");
    // The ride is no longer in his list: the student declined the fare (or he released it himself).
    if (!gone && !releasedByMe) {
      say("The student declined the fare, so the ride is no longer yours. It is open for other drivers again.");
    }
    releasedByMe = false;
  }

  byId("current").classList.toggle("hidden", !active);
  byId("open-area-list").classList.toggle("hidden", !!active);

  if (!active) {
    const hadRide = currentId !== null;
    currentId = null;
    stopTracking();
    if (hadRide) {
      // The ride ended (completed or cancelled): clear its A and B pins and go back to him.
      clearPins();
      selectedId = null;
      if (driverPos) map.setView(driverPos, 15);
    }
    renderList(); // the numbered request pins come back
    return;
  }
  // The status line and the buttons follow the ride's status every time.
  const underway = active.data.status === "on_the_way";
  // "I'm on the way" unlocks only when the student agreed to the fare (or the driver accepted his offer).
  const agreed = active.data.fareAgreed === true || active.data.counterAnswer === "accepted";
  const counterPending = isCounterPending(active.data);

  byId("current-status").textContent = underway
    ? "You are on the way. Tap Completed when the ride is done."
    : agreed
      ? "The student agreed to the fare. You can leave for the pickup."
      : "Accepted. Waiting for the student to agree to the fare. You can’t leave until he agrees.";
  byId("advance").textContent = underway ? "Completed" : "I’m on the way";
  byId("advance").onclick = () => advance(active.id, underway ? "completed" : "on_the_way");
  byId("advance").disabled = !underway && !agreed;
  byId("current-hint").textContent = underway
    ? ""
    : counterPending
      ? "First answer the student’s counter-offer above."
      : agreed
        ? "Tap the button when you leave for the pickup."
        : "If the student does not answer, you can release the ride for other drivers.";
  byId("release").classList.toggle("hidden", underway);
  byId("release").onclick = () => releaseRide(active.id);

  // The fare and a counter-offer can change while the ride is open, so they follow the ride every time.
  byId("current-fare").textContent = "₱" + active.data.fare;
  renderCounter(active);

  if (currentId === active.id) return; // the details below are already shown
  currentId = active.id;
  renderList(); // the numbered request pins go away while he is on a ride

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

// Follows the driver's own position so the list can show distances and sort nearest first.
// The position stays on his phone. The list is only redrawn after he has moved a good way,
// and never while he is typing a fare.
function startPositionForList() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition(
    (position) => {
      driverPos = L.latLng(position.coords.latitude, position.coords.longitude);
      showYou(driverPos);
      if (!centeredOnDriver && !selectedId && !currentId) {
        centeredOnDriver = true;
        map.setView(driverPos, 15);
      }
      const moved = !lastListPos || driverPos.distanceTo(lastListPos) > 100;
      const typing = document.activeElement && document.activeElement.tagName === "INPUT";
      if (moved && !typing) renderList();
    },
    () => { /* Location not allowed: the list still works, sorted by closing time. */ },
    { enableHighAccuracy: false, maximumAge: 15000, timeout: 20000 }
  );
}

function startListening() {
  startPositionForList();
  const fail = () => {
    status.textContent = "Couldn’t load the requests. Please check your internet and refresh.";
    status.classList.remove("hidden");
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

// ---------- Changing the vehicle or plate number ----------
// A driver can change these, but his account then goes back to pending (the owner checks
// the vehicle again). A ride he already accepted keeps the vehicle
// the student was shown, so changes wait until that ride is finished.

function showVehicleLine() {
  byId("vehicle").textContent = vehicle.vehicleType + " • " + vehicle.plateNumber;
  byId("vehicle").classList.remove("hidden");
}

function openVehicleForm() {
  say("");
  if (currentId) {
    say("Please finish your current ride before changing your vehicle.");
    return;
  }
  byId("vehicle-type").value = vehicle.vehicleType;
  byId("plate").value = vehicle.plateNumber;
  byId("vehicle-form").classList.remove("hidden");
  byId("vehicle-edit").classList.add("hidden");
}

function closeVehicleForm() {
  byId("vehicle-form").classList.add("hidden");
  byId("vehicle-edit").classList.remove("hidden");
}

async function saveVehicle() {
  say("");
  if (currentId) {
    say("Please finish your current ride before changing your vehicle.");
    return;
  }
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
  const button = byId("vehicle-save");
  button.disabled = true;
  try {
    await updateDoc(doc(db, "drivers", me.user.uid), { vehicleType, plateNumber, approvalStatus: "pending" });
    window.alert("Saved. Your account is now pending: the owner will check your vehicle again before you can accept rides.");
    window.location.reload(); // the page starts again as a pending driver
  } catch (error) {
    say(friendlyError(error));
  } finally {
    button.disabled = false;
  }
}

requireRole("driver")
  .then(async (session) => {
    me = session;
    byId("hello").textContent = session.profile.name;
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

    if (vehicle && vehicle.approvalStatus === "approved" && session.profile.blocked !== true) {
      status.textContent = "";
      status.classList.add("hidden");
      byId("open-area").classList.remove("hidden");
      await loadReported(session.user.uid);
      startMap();
      startListening();
    } else {
      status.textContent = "Waiting for approval. The owner will meet you to check your papers.";
    }
  })
  .catch(() => {
    status.textContent = "Couldn’t load your account. Please check your internet and refresh.";
  });
