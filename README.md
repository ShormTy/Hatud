# Hatud

A free ride-booking web app for students, made for a small pilot in Tagbilaran City, Bohol. "Hatud" is the Visayan word for bringing or dropping off someone.

Live site: https://hatud.web.app

Status: the pilot build is finished (login, rides, fares, history, reports, admin page, install as an app). The Android APK and the install guide are next.

## What it does

- Two kinds of people: **students** and **drivers**. The owner also has an **admin page**.
- Students sign up with a pilot invite code. Drivers sign up as "pending" and can only see requests after the owner approves them in person.
- A student taps pickup and drop-off pins on a map, chooses how long the request stays open (up to 24 hours) and, if wanted, a "needed by" time.
- Approved drivers see open requests, nearest first by road, type a fare and accept. The first driver to accept wins.
- The student sees the fare and the driver's details, can send one counter-offer, and can cancel until the driver taps "On the way".
- The driver sees his own live position and the route to the pickup and drop-off. This stays on his phone and is never saved.
- Past rides are listed for 30 days. Either person can report a problem. A link opens a Google Form for pilot feedback.
- The admin page approves or pauses drivers, blocks or removes people, keeps a list of removed people, and reads reports.

## How it is built (all free, no credit card)

- Firebase free plan (Spark): Hosting, email and password login, and the Firestore database (Singapore, asia-southeast1) protected by security rules.
- No Cloud Functions and no Cloud Storage, because both need the card-based Blaze plan. Never upgrade to Blaze.
- Maps: Leaflet with OpenStreetMap. Routes and road distances: the free public OSRM server (light use only).
- Plain HTML, CSS and JavaScript. There is no build step and no npm. Firebase is loaded from Google's CDN as ES modules (version 12.3.0).
- It is a PWA: it can be installed from the browser ("Install app" or "Add to Home Screen").

## Folders

- `public/` is the website that gets deployed.
  - Pages: `index.html` (log in and sign up), `student.html`, `driver.html`, `admin.html`, `404.html`.
  - `css/app.css` and `css/app-pages.css` hold the styles.
  - `js/firebase.js` starts Firebase once; `js/firebase-config.js` holds the project's public web settings.
  - `js/session.js` checks who is signed in and their role; `js/auth-page.js` is the log in and sign up code.
  - `js/student.js`, `js/driver.js` and `js/admin.js` are the code of those pages; `js/report.js`, `js/feedback.js` and `js/caps.js` are small helpers.
  - `manifest.webmanifest`, `sw.js`, `js/pwa.js` and `icons/` make the site installable. The service worker caches nothing on purpose, so everyone always gets the newest version.
- `plan/` holds the project brief (`HATUD_PROJECT_BRIEF.md`).
- `firestore.rules` and `firestore.indexes.json` are the database rules and indexes.
- `firebase.json` and `.firebaserc` connect this folder to the Firebase project.

## Deploy

    firebase deploy --only hosting      # the website
    firebase deploy --only firestore    # database rules and indexes

A deploy is manual. Pushing to GitHub does not deploy.

## Owner setup (done once, in the Firebase console)

1. Firestore: make the document `settings/pilot` with a text field `inviteCode` holding the code you give to students. Never write the code in this repository.
2. Firestore: make the document `admins/<your account UID>` with a field `ok` set to true. The UID is in Authentication, Users.
3. Open `/admin.html` while logged in and approve drivers there, after checking their papers and vehicle in person.
4. Removing a person on the admin page does not delete their login. To free the email, delete the login in Authentication, Users, then press Forget on the Removed tab.

## Privacy

- Saved: name, contact number, school (students), vehicle type and plate (drivers), and ride records.
- A student's name and number are shown to a driver only after the driver accepts. The driver's details are shown to the student after acceptance.
- Driver location is never saved. The app does not track the student's location; his location is only the pins he chooses.
- Ride records are deleted when the student next opens the app, 30 days after the ride. Reports hold only ids, a reason and an optional short note.
- The consent wording on the sign-up page is a draft for the owner to review under the Data Privacy Act of 2012 (RA 10173).

## Known limits

- The security rules have been checked by real use, not yet by the Firebase emulator.
- Expired requests are hidden by the driver page, and one active ride per driver is enforced by the page, not by the rules.
- The free OpenStreetMap and OSRM servers are for light use. A small pilot is fine.

## Rules for this repository

- **No secrets, ever.** No passwords, tokens, private keys or APK signing keys, whether the repository is public or private. The Firebase web settings in `js/firebase-config.js` are public by design; the protection comes from `firestore.rules`.
- Nothing may need a credit card.
- Keep `plan/HATUD_PROJECT_BRIEF.md` up to date; it is the full context for anyone (or any AI) continuing the project.
