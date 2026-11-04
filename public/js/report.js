// The "Report a problem" button on a past ride (used on the student and driver pages).
// A person can report the other person on the ride, or the Hatud app.
//   reports/{rideId}_{reporterId}       about the other person
//   reports/{rideId}_app_{reporterId}   about the app
// A report about a person also adds the reporter to a private list of DIFFERENT reporters
// (reportTally/{personId}), in the same save. When 3 different people have reported the
// same person, that person is blocked automatically (W22). The owner reads reports on the admin page.
import { db } from "./firebase.js";
import { confirmBox } from "./dialog.js";
import {
  doc,
  collection,
  query,
  where,
  getDocs,
  writeBatch,
  updateDoc,
  arrayUnion,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const reported = new Set(); // "rideId|person" or "rideId|app" that this person already reported
let allowed = true; // a blocked person cannot send reports

// Called by the pages when the account is blocked.
export function disableReporting() {
  allowed = false;
}

const PERSON_REASONS = {
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

const APP_REASONS = [
  ["app_bug", "Something is broken (a bug)"],
  ["map_wrong", "The map or the route is wrong"],
  ["slow_or_stuck", "The app is slow or stuck"],
  ["confusing", "Something is confusing"],
  ["other", "Something else"]
];

// Loads which rides this person already reported, so the button is not offered twice.
export async function loadReported(uid) {
  try {
    const snap = await getDocs(query(collection(db, "reports"), where("reporterId", "==", uid)));
    snap.forEach((d) => {
      const data = d.data();
      reported.add(data.rideId + "|" + (data.targetType === "app" ? "app" : "person"));
    });
  } catch (error) {
    // The list is only a convenience; the rules still allow one report per ride and kind.
  }
}

function makeElement(tag, text, className) {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (className) el.className = className;
  return el;
}

// After a report about a person: if 3 different people have now reported him, the rules let
// this reporter block him. With fewer than 3 the rules refuse, which is expected and ignored.
async function tryAutoBlock(personId) {
  try {
    await updateDoc(doc(db, "users", personId), { blocked: true, blockedBy: "auto" });
  } catch (error) {
    // Fewer than 3 different reporters so far.
  }
}

// Adds the report button (and notes about earlier reports) to one past-ride entry.
export function addReportControls(item, rideId, ride, role, uid) {
  if (!allowed) return;
  if (ride.status !== "completed" && ride.status !== "cancelled" && ride.status !== "expired") return;

  const otherId = role === "student" ? ride.driverId : ride.studentId;
  const otherWord = role === "student" ? "the driver" : "the student";
  // A person can be reported only on a ride that had a driver and ended as completed or cancelled.
  const canReportPerson = !!ride.driverId && !!otherId && ride.status !== "expired";

  const holder = document.createElement("div");
  item.appendChild(holder);

  function targetsLeft() {
    const left = [];
    if (canReportPerson && !reported.has(rideId + "|person")) left.push(["person", otherWord.charAt(0).toUpperCase() + otherWord.slice(1)]);
    if (!reported.has(rideId + "|app")) left.push(["app", "The Hatud app"]);
    return left;
  }

  function showButton() {
    holder.textContent = "";
    if (reported.has(rideId + "|person")) {
      holder.appendChild(makeElement("p", "You reported " + otherWord + ". The owner will review it.", "hint"));
    }
    if (reported.has(rideId + "|app")) {
      holder.appendChild(makeElement("p", "You reported the app. The owner will read it.", "hint"));
    }
    if (targetsLeft().length === 0) return;
    const button = makeElement("button", "Report a problem", "secondary");
    button.type = "button";
    button.onclick = showForm;
    holder.appendChild(button);
  }

  function showForm() {
    holder.textContent = "";
    const left = targetsLeft();

    const aboutLabel = makeElement("label", "Who is the report about?");
    const about = document.createElement("select");
    left.forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      about.appendChild(option);
    });

    const reasonLabel = makeElement("label", "What went wrong?");
    const select = document.createElement("select");
    function fillReasons() {
      select.textContent = "";
      const list = about.value === "app" ? APP_REASONS : PERSON_REASONS[role];
      list.forEach(([value, text]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
      });
    }
    about.onchange = fillReasons;
    fillReasons();

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
      const target = about.value;
      const ok = await confirmBox({
        title: "Send this report?",
        message: target === "person"
          ? "The owner will read it. If 3 different people report the same person, that person’s account is blocked automatically."
          : "The owner will read it.",
        okText: "Send report",
        cancelText: "Cancel"
      });
      if (!ok) return;
      send.disabled = true;
      message.classList.add("hidden");
      try {
        const base = {
          rideId,
          reporterId: uid,
          reporterRole: role,
          targetType: target,
          reason: select.value,
          details: details.value.trim(),
          status: "new",
          createdAt: serverTimestamp()
        };
        const batch = writeBatch(db);
        if (target === "app") {
          batch.set(doc(db, "reports", rideId + "_app_" + uid), base);
        } else {
          const reportId = rideId + "_" + uid;
          batch.set(doc(db, "reports", reportId), { ...base, reportedId: otherId });
          // Adds this reporter to the private list of different reporters (never shown to the reported person).
          batch.set(doc(db, "reportTally", otherId), { reporters: arrayUnion(uid), lastReportId: reportId }, { merge: true });
        }
        await batch.commit();
        reported.add(rideId + "|" + target);
        if (target === "person") await tryAutoBlock(otherId);
        showButton();
      } catch (error) {
        send.disabled = false;
        message.textContent = error.code === "permission-denied"
          ? "The report was refused. You may have already sent this report, or your account may have changed."
          : "Couldn’t send the report. Please check your internet and try again.";
        message.classList.remove("hidden");
      }
    };

    [aboutLabel, about, reasonLabel, select, detailsLabel, details, message, send, cancel].forEach((el) => holder.appendChild(el));
  }

  showButton();
}
