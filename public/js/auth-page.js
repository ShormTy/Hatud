// Log in / sign up page (index.html).
import { auth } from "./firebase.js";
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";

const tabLogin = document.getElementById("tab-login");
const tabSignup = document.getElementById("tab-signup");
const form = document.getElementById("auth-form");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const submitButton = document.getElementById("submit");
const authView = document.getElementById("auth-view");
const signedInView = document.getElementById("signed-in-view");
const signedInEmail = document.getElementById("signed-in-email");
const signOutButton = document.getElementById("signout");
const messageBox = document.getElementById("message");

let mode = "login"; // "login" or "signup"

function showMessage(text) {
  messageBox.textContent = text;
  messageBox.classList.toggle("hidden", !text);
}

function setMode(newMode) {
  mode = newMode;
  const isLogin = mode === "login";
  tabLogin.setAttribute("aria-selected", String(isLogin));
  tabSignup.setAttribute("aria-selected", String(!isLogin));
  submitButton.textContent = isLogin ? "Log in" : "Create account";
  passwordInput.autocomplete = isLogin ? "current-password" : "new-password";
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
      return "No internet connection. Please try again.";
    default:
      return "Something went wrong (" + (error.code || "unknown") + "). Please try again.";
  }
}

tabLogin.addEventListener("click", () => setMode("login"));
tabSignup.addEventListener("click", () => setMode("signup"));

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage("");
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) {
    showMessage("Please type your email and password.");
    return;
  }
  submitButton.disabled = true;
  try {
    if (mode === "signup") {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
    form.reset();
  } catch (error) {
    showMessage(friendlyError(error));
  } finally {
    submitButton.disabled = false;
  }
});

signOutButton.addEventListener("click", async () => {
  try {
    await signOut(auth);
  } catch (error) {
    showMessage(friendlyError(error));
  }
});

// Runs on page load and every time someone signs in or out.
onAuthStateChanged(auth, (user) => {
  const signedIn = Boolean(user);
  authView.classList.toggle("hidden", signedIn);
  signedInView.classList.toggle("hidden", !signedIn);
  signedInEmail.textContent = signedIn ? user.email : "";
  showMessage("");
});
  
