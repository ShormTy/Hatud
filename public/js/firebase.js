// Shared Firebase setup. Every page imports what it needs from here.
// The settings come from firebase-config.js (they are public by design;
// your data is protected by firestore.rules, not by hiding these).
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
