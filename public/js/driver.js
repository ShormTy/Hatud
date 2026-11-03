// Driver page (placeholder for now): shows the approval status.
import { requireRole, logOut } from "./session.js";
import { db } from "./firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const byId = (id) => document.getElementById(id);
const status = byId("status");

byId("signout").addEventListener("click", () => logOut());

requireRole("driver")
  .then(async ({ user, profile }) => {
    byId("hello").textContent = profile.name;
    const snap = await getDoc(doc(db, "drivers", user.uid));
    const driver = snap.exists() ? snap.data() : null;
    if (driver && driver.approvalStatus === "approved") {
      status.textContent = "Approved. Open ride requests will appear here in the next stage.";
    } else {
      status.textContent = "Waiting for approval. The owner will meet you to check your papers.";
    }
    if (driver) {
      byId("vehicle").textContent = driver.vehicleType + " • " + driver.plateNumber;
      byId("vehicle").classList.remove("hidden");
    }
  })
  .catch(() => {
    status.textContent = "Couldn’t load your account. Please check your internet and refresh.";
  });
