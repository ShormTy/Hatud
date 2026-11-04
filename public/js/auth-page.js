// Log in / sign up page (login.html).
import { auth, db } from "./firebase.js";
import { makeCaps } from "./caps.js";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  deleteUser,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  doc,
  getDoc,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const byId = (id) => document.getElementById(id);

makeCaps(byId("vehicle-type"));
makeCaps(byId("plate"));

const tabLogin = byId("tab-login");
const tabSignup = byId("tab-signup");
const form = byId("auth-form");
const submitButton = byId("submit");
const authView = byId("auth-view");
const signedInView = byId("signed-in-view");
const profileTitle = byId("profile-title");
const signedInEmail = byId("signed-in-email");
const profileStatus = byId("profile-status");
const signOutButton = byId("signout");
const messageBox = byId("message");

const PHONE_PATTERN = /^[0-9+() -]{7,20}$/;

let mode = "login";    // "login" or "signup"
let busy = false;      // true while an account and its profile are being made
let renderRun = 0;     // lets an old profile lookup give way to a newer one

function showMessage(text) {
  messageBox.textContent = text;
  messageBox.classList.toggle("hidden", !text);
}

function selectedRole() {
  return form.elements["role"].value; // "student" or "driver"
}

function updateForm() {
  const signup = mode === "signup";
  const role = selectedRole();
  tabLogin.setAttribute("aria-selected", String(!signup));
  tabSignup.setAttribute("aria-selected", String(signup));
  document.querySelectorAll(".signup-only").forEach((el) => {
    el.classList.toggle("hidden", !signup);
  });
  document.querySelectorAll(".student-only").forEach((el) => {
    el.classList.toggle("hidden", !(signup && role === "student"));
  });
  document.querySelectorAll(".driver-only").forEach((el) => {
    el.classList.toggle("hidden", !(signup && role === "driver"));
  });
  submitButton.textContent = signup ? "Create account" : "Log in";
  byId("password").autocomplete = signup ? "new-password" : "current-password";
  byId("forgot").classList.toggle("hidden", signup);
}

function setMode(newMode) {
  mode = newMode;
  updateForm();
  showMessage("");
}

function friendlyError(error) {
  switch (error.code) {
    case "auth/email-already-in-use":
      return "That email already has an account. Try logging in instead.";
    case "auth/invalid-email":
      return "That email doesn’t look right. Please check it.";
    case "auth/weak-password":
      return "Your password needs at least 6 characters.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Wrong email or password.";
    case "auth/too-many-requests":
      return "Too many tries. Please wait a few minutes and try again.";
    case "auth/network-request-failed":
    case "unavailable":
      return "No internet connection. Please try again.";
    case "permission-denied":
      return "The invite code doesn’t match, or something in the form isn’t accepted. Please check it and try again.";
    default:
      return "Something went wrong (" + (error.code || "unknown") + "). Please try again.";
  }
}

// Reads and checks the sign-up fields. Returns { error } or { data }.
function readSignupForm() {
  const role = selectedRole();
  const data = {
    role,
    name: byId("full-name").value.trim(),
    contactNumber: byId("contact").value.trim()
  };

  if (!data.name) return { error: "Please type your full name." };
  if (!PHONE_PATTERN.test(data.contactNumber)) {
    return { error: "Please type a contact number (digits only, or with + and spaces)." };
  }

  if (role === "student") {
    data.school = byId("school").value.trim();
    data.inviteCode = byId("invite").value.trim();
    if (!data.school) return { error: "Please type your school." };
    if (!data.inviteCode) return { error: "Please type the pilot invite code." };
  } else {
    data.vehicleType = byId("vehicle-type").value.trim().replace(/\s+/g, " ").toUpperCase();
    data.plateNumber = byId("plate").value.trim().replace(/\s+/g, " ").toUpperCase();
    if (!data.vehicleType) return { error: "Please type your vehicle type, for example TRICYCLE." };
    if (!data.plateNumber) return { error: "Please type your plate number." };
  }

  if (!byId("consent").checked) {
    return { error: "Please tick the box to agree before creating your account." };
  }
  return { data };
}

// Makes the login and then the profile. If the profile is refused (for
// example a wrong invite code), the new login is deleted again so the person
// can simply try again with the same email.
async function signUp(email, password, data) {
  busy = true;
  let created = null;
  try {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    created = credential.user;
    const now = serverTimestamp();
    const batch = writeBatch(db);

    if (data.role === "student") {
      batch.set(doc(db, "users", created.uid), {
        name: data.name,
        role: "student",
        school: data.school,
        contactNumber: data.contactNumber,
        inviteCode: data.inviteCode,
        createdAt: now,
        consentAt: now,
        blocked: false
      });
    } else {
      batch.set(doc(db, "users", created.uid), {
        name: data.name,
        role: "driver",
        contactNumber: data.contactNumber,
        createdAt: now,
        consentAt: now,
        blocked: false
      });
      batch.set(doc(db, "drivers", created.uid), {
        vehicleType: data.vehicleType,
        plateNumber: data.plateNumber,
        contactNumber: data.contactNumber,
        approvalStatus: "pending",
        available: false
      });
    }
    await batch.commit();
  } catch (error) {
    if (created) {
      try { await deleteUser(created); } catch (ignored) { /* nothing more to do */ }
    }
    throw error;
  } finally {
    busy = false;
  }
}

function showStatus(text) {
  profileStatus.textContent = text;
  profileStatus.classList.toggle("hidden", !text);
}

// Shows the right screen for whoever is (or is not) signed in.
async function render(user) {
  if (busy) return;
  const myRun = ++renderRun;
  authView.classList.toggle("hidden", Boolean(user));
  signedInView.classList.toggle("hidden", !user);
  if (!user) return;

  signedInEmail.textContent = user.email;
  profileTitle.textContent = "Loading…";
  showStatus("");

  try {
    const profileSnap = await getDoc(doc(db, "users", user.uid));
    if (myRun !== renderRun) return;

    if (!profileSnap.exists()) {
      profileTitle.textContent = "This account has no profile yet.";
      showStatus("It was probably made before profiles existed. Sign out and sign up again with another email.");
      return;
    }

    const profile = profileSnap.data();
    // Each role has its own page.
    location.replace(profile.role === "driver" ? "driver.html" : "student.html");
  } catch (error) {
    if (myRun !== renderRun) return;
    profileTitle.textContent = "Signed in";
    showMessage(friendlyError(error));
  }
}

tabLogin.addEventListener("click", () => setMode("login"));
tabSignup.addEventListener("click", () => setMode("signup"));
form.elements["role"].forEach((radio) => radio.addEventListener("change", updateForm));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  const email = byId("email").value.trim();
  const password = byId("password").value;
  if (!email || !password) {
    showMessage("Please type your email and password.");
    return;
  }

  submitButton.disabled = true;
  try {
    if (mode === "signup") {
      const result = readSignupForm();
      if (result.error) {
        showMessage(result.error);
        return;
      }
      await signUp(email, password, result.data);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    form.reset();
    updateForm();
  } catch (error) {
    showMessage(friendlyError(error));
  } finally {
    submitButton.disabled = false;
    render(auth.currentUser);
  }
});

// "Forgot password?": Firebase sends a free reset email. The same answer is shown whether or
// not an account exists, so nobody can use this button to find out who has an account.
const forgotButton = byId("forgot");

function resetForgotButton() {
  forgotButton.disabled = false;
  forgotButton.style.opacity = "";
  forgotButton.textContent = "Forgot password?";
}

// After a request the button waits 30 seconds before it can be tapped again. This shows that the
// tap worked and also protects the free limit of reset emails.
function waitForgotButton() {
  let left = 30;
  forgotButton.disabled = true;
  forgotButton.style.opacity = "0.6";
  forgotButton.textContent = "Request sent. Try again in " + left + "s";
  const timer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(timer);
      resetForgotButton();
    } else {
      forgotButton.textContent = "Request sent. Try again in " + left + "s";
    }
  }, 1000);
}

forgotButton.addEventListener("click", async () => {
  showMessage("");
  const email = byId("email").value.trim();
  if (!email) {
    showMessage("Type your email above first, then tap Forgot password?");
    return;
  }
  forgotButton.disabled = true;
  forgotButton.style.opacity = "0.6";
  forgotButton.textContent = "Sending…";
  try {
    await sendPasswordResetEmail(auth, email);
  } catch (error) {
    if (error.code !== "auth/user-not-found") {
      resetForgotButton();
      showMessage(friendlyError(error));
      return;
    }
  }
  // The same answer for every email, so nobody can find out who has an account.
  showMessage("Reset link requested for " + email + ". Check your inbox and the spam folder; it can take a few minutes.");
  waitForgotButton();
});

signOutButton.addEventListener("click", async () => {
  showMessage("");
  try {
    await signOut(auth);
  } catch (error) {
    showMessage(friendlyError(error));
  }
});

// Runs on page load and every time someone signs in or out.
onAuthStateChanged(auth, (user) => {
  render(user);
});

updateForm();

// The Sign up button on the home page opens this page on the Sign up tab.
if (location.hash === "#signup") setMode("signup");
