// The appeal box shown to a blocked person on the student and driver pages (W22).
// A blocked person can send ONE appeal at a time (appeals/{uid}). The owner reads it on the
// admin page and either unblocks the person or denies the appeal.
import { db } from "./firebase.js";
import { confirmBox } from "./dialog.js";
import { SUPPORT_EMAIL } from "./support.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

function make(tag, text, className) {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (className) el.className = className;
  return el;
}

// Adds the appeal panel before the given element (the page's history panel).
export async function showAppeal({ uid, profile, before }) {
  if (!before || !before.parentNode) return;
  const panel = make("section", "", "panel");
  panel.id = "appeal-panel";
  before.parentNode.insertBefore(panel, before);

  const why = profile.blockedBy === "auto"
    ? "Your account was blocked automatically after reports from several different people."
    : profile.blockedBy === "owner"
      ? "Your account was blocked by the owner."
      : "Your account is blocked.";

  function draw(appeal, problem) {
    panel.textContent = "";
    panel.appendChild(make("p", "Appeal your block", "panel-title"));
    panel.appendChild(make("p", why, "ride-line"));

    if (problem) {
      panel.appendChild(make("p", problem, "hint"));
      return;
    }
    if (appeal && appeal.status === "denied") {
      panel.appendChild(make("p", "The owner read your appeal and denied it. If something has changed, write to " + SUPPORT_EMAIL + ".", "hint"));
      return;
    }
    if (appeal) {
      panel.appendChild(make("p", "Your appeal was sent. The owner will read it and decide. Please check back later.", "hint"));
      return;
    }

    panel.appendChild(make("p", "If you think this is a mistake, tell the owner why. You can send one appeal at a time. You can also write to " + SUPPORT_EMAIL + ".", "hint"));
    const label = make("label", "Your appeal (up to 300 characters)");
    const text = document.createElement("textarea");
    text.rows = 4;
    text.maxLength = 300;
    label.htmlFor = "appeal-text";
    text.id = "appeal-text";
    const message = make("p", "", "hint hidden");
    const send = make("button", "Send appeal", "primary");
    send.type = "button";
    send.onclick = async () => {
      const value = text.value.trim();
      if (value.length < 5) {
        message.textContent = "Please write a few words about why you are appealing.";
        message.classList.remove("hidden");
        return;
      }
      const ok = await confirmBox({
        title: "Send your appeal?",
        message: "The owner will read it. You can send only one at a time.",
        okText: "Send appeal",
        cancelText: "Cancel"
      });
      if (!ok) return;
      send.disabled = true;
      message.classList.add("hidden");
      try {
        await setDoc(doc(db, "appeals", uid), { message: value, status: "new", createdAt: serverTimestamp() });
        draw({ status: "new" });
      } catch (error) {
        send.disabled = false;
        message.textContent = error.code === "permission-denied"
          ? "The appeal was refused. You may have already sent one."
          : "Couldn’t send the appeal. Please check your internet and try again.";
        message.classList.remove("hidden");
      }
    };
    [label, text, message, send].forEach((el) => panel.appendChild(el));
  }

  try {
    const snap = await getDoc(doc(db, "appeals", uid));
    draw(snap.exists() ? snap.data() : null);
  } catch (error) {
    draw(null, "Couldn’t load your appeal. Please check your internet and refresh, or write to " + SUPPORT_EMAIL + ".");
  }
}
