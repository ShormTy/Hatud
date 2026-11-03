// The "Report a problem" button on a past ride (used on the student and driver pages).
// A report is saved as reports/{rideId}_{reporterId}: one per person per ride.
// The owner reads reports in the Firebase console.
import { db } from "./firebase.js";
import {
  doc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const reported = new Set(); // ride ids this person has already reported

const REASONS = {
  student: [
    ["unreasonable_fare", "The fare was unreasonable"],
    ["unsafe_or_rude", "Unsafe or rude behavior"],
    ["no_show", "The driver did not show up"],
    ["wrong_vehicle", "Wrong vehicle or plate number"],
    ["other", "Something else"]
  ],
  driver: [
    ["no_show", "The student did not show up"],
    ["unsafe_or_rude", "Unsafe or rude behavior"],
    ["refused_to_pay", "The student refused to pay"],
    ["other", "Something else"]
  ]
};

// Loads which rides this person already reported, so the button is not offered twice.
export async function loadReported(uid) {
  try {
    const snap = await getDocs(query(collection(db, "reports"), where("reporterId", "==", uid)));
    snap.forEach((d) => reported.add(d.data().rideId));
  } catch (error) {
    // The list is only a convenience; the rules still allow one report per ride.
  }
}

function makeElement(tag, text, className) {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (className) el.className = className;
  return el;
}

// Adds the report button (or "already reported" text) to one past-ride entry.
export function addReportControls(item, rideId, ride, role, uid) {
  if (!ride.driverId) return; // nobody to report
  if (ride.status !== "completed" && ride.status !== "cancelled") return;

  const holder = document.createElement("div");
  item.appendChild(holder);

  function showButton() {
    holder.textContent = "";
    if (reported.has(rideId)) {
      holder.appendChild(makeElement("p", "You reported this ride. The owner will review it.", "hint"));
      return;
    }
    const button = makeElement("button", "Report a problem", "secondary");
    button.type = "button";
    button.onclick = showForm;
    holder.appendChild(button);
  }

  function showForm() {
    holder.textContent = "";

    const reasonLabel = makeElement("label", "What went wrong?");
    const select = document.createElement("select");
    REASONS[role].forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.appendChild(option);
    });

    const detailsLabel = makeElement("label", "Details (optional, up to 200 characters)");
    const details = document.createElement("textarea");
    details.rows = 3;
    details.maxLength = 200;

    const message = makeElement("p", "", "hint hidden");
    const send = makeElement("button", "Send report", "primary");
    send.type = "button";
    const cancel = makeElement("button", "Cancel", "secondary");
    cancel.type = "button";
    cancel.onclick = showButton;

    send.onclick = async () => {
      if (!window.confirm("Send this report to the owner?")) return;
      send.disabled = true;
      message.classList.add("hidden");
      try {
        await setDoc(doc(db, "reports", rideId + "_" + uid), {
          rideId,
          reporterId: uid,
          reporterRole: role,
          reportedId: role === "student" ? ride.driverId : ride.studentId,
          reason: select.value,
          details: details.value.trim(),
          status: "new",
          createdAt: serverTimestamp()
        });
        reported.add(rideId);
        showButton();
      } catch (error) {
        send.disabled = false;
        message.textContent = error.code === "permission-denied"
          ? "The report was refused. You may have already reported this ride."
          : "Couldn’t send the report. Please check your internet and try again.";
        message.classList.remove("hidden");
      }
    };

    [reasonLabel, select, detailsLabel, details, message, send, cancel].forEach((el) => holder.appendChild(el));
  }

  showButton();
}
