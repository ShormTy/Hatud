# Hatud
 
A free ride-booking web app for students, made for a small pilot in Tagbilaran City, Bohol. "Hatud" is the Visayan word for bringing or dropping off someone.
 
Live site: https://hatud.web.app
Install page: https://hatud.web.app/install.html
Help: hatud.support@gmail.com
 
Status: the pilot build is finished and tested on real Android phones (login, rides, fare agreement, history, reports, admin page, account settings, installable app, Android APK 1.0.0.1, install guide). The database security rules also passed 210 automated attack tests in the Firebase emulator. Next: the owner's last checks, then the pilot at Tagbilaran City College.
 
## What it does
 
- Two kinds of people: **students** and **drivers**. The owner also has an **admin page**.
- Students sign up with a pilot invite code. Drivers sign up as "pending" and can only see requests after the owner approves them in person.
- A student taps pickup and drop-off pins on a map (or taps "Use my location as pickup") and chooses how long the request stays open (up to 24 hours).
- Approved drivers see open requests, nearest first by road, type a fare and accept. The first driver to accept wins.
- Fare agreement: the student agrees to the fare, sends one lower counter-offer, or declines (the request opens again for other drivers). The driver can accept the offer or keep his fare, or release the ride. The driver's "I'm on the way" button stays locked until the fare is agreed.
- The student's name and number are shown to the driver only after the fare is agreed. The driver's details are shown to the student after he accepts.
- The student can cancel until the driver taps "On the way", and after 5 minutes of waiting if the driver never comes.
- The driver sees his own live position and the route to the pickup and drop-off. This stays on his phone and is never saved. His screen stays on during a ride.
- A short beep, vibration and tab title change tell people about an accepted ride or a new request while the page is open.
- Past rides are listed for 30 days. Either person can report the other person or the app. Three different people reporting the same person blocks the account automatically; a blocked person can send one appeal.
- Account settings (students and drivers): edit profile, change vehicle or plate (a driver goes back to "pending" until the owner checks again), and Delete my account (a 24-hour countdown, then password).
- Light, dark or automatic theme, a sidebar menu, and a link to a Google Form for pilot feedback.
- The admin page has four tabs: To do, Users (filter by students, drivers, pending, blocked, deleting, admins), Reports and Closed accounts. The owner can approve, pause, block, unblock and remove people, read appeals, keep a private note per person and clear old rides.
## How it is built (all free, no credit card)
 
- Firebase free plan (Spark): Hosting, email and password login, and the Firestore database (Singapore, asia-southeast1) protected by security rules.
- No Cloud Functions and no Cloud Storage, because both need the card-based Blaze plan. Never upgrade to Blaze.
- Maps: Leaflet with OpenStreetMap. Routes and road distances: the free public OSRM server (light use only).
- Plain HTML, CSS and JavaScript. There is no build step and no npm. Firebase is loaded from Google's CDN as ES modules (version 12.3.0).
- It is a PWA: it can be installed from the browser ("Install app" or "Add to Home Screen").
- The Android app is the same website wrapped as a Trusted Web Activity (TWA) with PWABuilder. It is installed from an APK file outside Google Play (see "Android app (APK)" below).
- Password reset emails are sent from hatud.support@gmail.com through Firebase's custom SMTP setting (a Google app password, kept only in the Firebase console).
## Folders
 
- `public/` is the website that gets deployed.
  - Pages: `index.html` (home page), `login.html` (log in and sign up), `student.html`, `driver.html`, `account.html` (account settings), `admin.html`, `install.html` (how to install), `privacy.html` (privacy notice), `offline.html` (shown when there is no signal), `404.html`.
  - `css/app.css` and `css/app-pages.css` hold the styles.
  - `js/firebase.js` starts Firebase once; `js/firebase-config.js` holds the project's public web settings.
  - `js/session.js` checks who is signed in and their role; `js/auth-page.js` is the log in and sign up code; `js/home.js` is the home page code.
  - `js/student.js`, `js/driver.js`, `js/account.js` and `js/admin.js` are the code of those pages; `js/account-state.js` decides if an account is blocked, deleting, pending or active.
  - Helpers: `js/report.js`, `js/appeal.js`, `js/delete-account.js`, `js/alerts.js`, `js/wakelock.js`, `js/dialog.js` (confirm popups), `js/chips.js`, `js/caps.js`, `js/feedback.js`, `js/support.js`, `js/sidebar.js`, `js/theme.js` and `js/motion.js`. Every new page must load `theme.js` and `motion.js`.
  - `manifest.webmanifest`, `sw.js`, `js/pwa.js` and `icons/` make the site installable. The service worker keeps only `offline.html`; nothing else is cached on purpose, so everyone always gets the newest version.
  - `robots.txt`, `sitemap.xml` and `og-image.png` are for Google search and share previews. Only the home, install and privacy pages are meant to be found.
  - `well-known/assetlinks.json` is the Digital Asset Links file that proves the Android app belongs to this website. `firebase.json` serves it at `/.well-known/assetlinks.json` (see "Android app (APK)").
  - `vendor/leaflet/` is a copy of the Leaflet 1.9.4 map software (BSD 2-Clause license), served from this site so no outside service delivers it.
- `firestore.rules` and `firestore.indexes.json` are the database rules and indexes.
- `firebase.json` and `.firebaserc` connect this folder to the Firebase project.
- Kept only on the owner's computer, **not in this repository** (all listed in `.gitignore`): `plan/` (the project brief), `apk/` (the PWABuilder output: `Hatud.apk`, `Hatud.aab`, `signing.keystore`, `signing-key-info.txt`), `rules-tests/` (the emulator tests of the security rules) and the `apply-*.sh` helper scripts.
## Deploy
 
    firebase deploy --only hosting      # the website
    firebase deploy --only firestore    # database rules and indexes
 
A deploy is manual. Pushing to GitHub does not deploy. Deploy the rules before the pages when a change touches both. After a deploy that changes CSS or JavaScript, a phone may need its site data cleared once.
 
## Test the security rules

The rules in `firestore.rules` are tested against the Firebase emulator, a fake local database. Nothing touches the live data and no accounts are needed. The tests (210, in 10 groups) try to break the rules: sign-up and profiles, driver approval, creating rides, accepting and fares, student details, cancel timing, old-data cleanup, reports and blocks, account deletion and the admin powers.

    cd rules-tests && npm install    # once
    bash rules-tests/run.sh          # from the Hatud folder; needs Java

Run the whole set again after ANY change to `firestore.rules`, and deploy the rules only when every test passes. `rules-tests/` stays on the owner's computer and is not in this repository.

## Android app (APK)
 
- Package: `app.web.hatud.twa`, made with PWABuilder from exactly `https://hatud.web.app`, with location delegation switched on (so "Use my location" and the driver map ask for location inside the app). When making a new APK, type the Package ID as `app.web.hatud.twa` and check the result.
- Current version: 1.0.0.1 (version code 2). It opens the home page (`/index.html`); a signed-in person goes straight to the student or driver page. The first APK (1.0.0.0) opened `login.html`.
- The APK is published as the GitHub release `v1.0.0.1`, which holds only `Hatud.apk`. Its SHA-256 and the download link are on `install.html`. Tag names match the app's version name.
- The app opens the website full-screen (no address bar) only when `https://hatud.web.app/.well-known/assetlinks.json` lists the package name and the SHA-256 fingerprint of the signing key. The file is in `public/well-known/assetlinks.json`.
- Firebase Hosting makes its own empty `assetlinks.json` (`[]`) unless `firebase.json` has `"appAssociation": "NONE"`. Keep that setting. A page that shows `[]` is a failure.
- After changing that file, uninstall the app, clear Chrome's data on the phone and install again, because Android remembers a failed check.
- The signing key (`signing.keystore`, with its password and alias in `signing-key-info.txt`) must stay out of this repository and have a backup somewhere else. If it is lost, installed phones cannot receive updates and everyone must uninstall and reinstall.
- A new version of the website needs no new APK. A new APK is only needed if the start address, package, icon, name or key settings change. It must use the same package ID and the same key, and a higher version code, so it installs over the old one.
- The APK is shared as a download outside Google Play. Android asks the person to allow "install unknown apps". iPhone users use Add to Home Screen from Safari.
## Owner setup (done once, in the Firebase console)
 
1. Firestore: make the document `settings/pilot` with a text field `inviteCode` holding the code you give to students. Never write the code in this repository.
2. Firestore: make the document `admins/<your account UID>` with a field `ok` set to true. The UID is in Authentication, Users. Use a separate admin email and a strong password.
3. Open `/admin.html` while logged in and approve drivers there, after checking their papers and vehicle in person. Nothing is photographed or kept.
4. Removing a person on the admin page does not delete their login. To free the email, delete the login in Authentication, Users (three dots, Delete account), then press Forget on the person's note under Closed accounts. To keep someone out, use Block, not Remove.
5. The Firebase web API key is limited to the three site addresses (Google Cloud console, APIs & Services, Credentials). Add `localhost` there if you ever test locally.
## Privacy
 
- Saved: name, contact number, school (students), vehicle type and plate (drivers), ride records, and reports. The owner can add a short private note about an account.
- A student's name and number are shown to a driver only after the driver accepts AND the student agrees to the fare. The driver's details are shown to the student after acceptance.
- Every approved driver can see the exact pickup and drop-off points (and their names) of open requests before accepting one. A student's name and number stay private until the fare is agreed.
- Driver location is never saved. The app does not track the student's location; "Use my location as pickup" only fills in the pickup pin of that one ride when the student taps it. Pickup, drop-off and driver points are sent to the free OSRM routing server for routes.
- Ride records are deleted 30 days after the ride, when the student, the driver or the owner (admin page) next opens the app. Reports hold only ids, a reason and an optional short note, and stay until the owner deletes them.
- Delete my account removes the profile, driver record, finished rides and the login after a 24-hour countdown. Reports about the person are kept on purpose.
- The consent wording on the sign-up page and `privacy.html` are drafts for the owner to review under the Data Privacy Act of 2012 (RA 10173).
## Known limits
 
- The emulator tests check the rules file, not the live project. After a rules change, deploy from the tested file (`firebase deploy --only firestore`).
- Expired requests are hidden by the driver page, and one active ride per driver is enforced by the page, not by the rules.
- Cleanup of old data runs only when someone opens the app; there is no server.
- A person who is not blocked can delete his account and sign up again with a new email.
- The free OpenStreetMap and OSRM servers are for light use. A small pilot is fine.
- The Firebase password reset email shows the sender name Hatud, but Firebase currently refuses changes to its wording, so the text is the default.
## Rules for this repository
 
- **No secrets, ever.** No passwords, tokens, private keys, app passwords or APK signing keys (the `apk/` folder is in `.gitignore` for this reason), because the repository is public. The Firebase web settings in `js/firebase-config.js` are public by design; the protection comes from `firestore.rules`.
- Nothing may need a credit card.
