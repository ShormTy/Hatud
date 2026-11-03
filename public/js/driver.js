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
