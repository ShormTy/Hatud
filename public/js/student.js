// Student page: a map where the student taps to set a pickup and a drop-off.
// Nothing is saved yet (that comes in the next step).
import { requireRole, logOut } from "./session.js";

const L = window.L; // Leaflet, loaded by student.html
const byId = (id) => document.getElementById(id);

const TAGBILARAN = [9.6472, 123.855];

const note = byId("note");
const summary = byId("summary");

function say(text) {
  note.textContent = text;
  note.classList.toggle("hidden", !text);
}

let pickup = null;   // map marker or null
let dropoff = null;  // map marker or null
let active = "pickup";

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
  if (pickup) { map.removeLayer(pickup); pickup = null; }
  if (dropoff) { map.removeLayer(dropoff); dropoff = null; }
  setActive("pickup");
  say("");
  updateSummary();
});

byId("signout").addEventListener("click", () => logOut());

updateSummary();

requireRole("student")
  .then(({ profile }) => {
    byId("hello").textContent = profile.name;
  })
  .catch(() => say("Couldn’t load your account. Please check your internet and refresh."));
