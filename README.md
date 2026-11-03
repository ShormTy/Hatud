# Hatud

A free ride-booking web app for students (Tagbilaran City, Bohol). Built as a PWA on Firebase (free Spark plan), with OpenStreetMap and Leaflet for maps.

Live site: https://hatud.web.app

## Folders

- `public/` is the website that gets deployed.
  - `index.html` is the log in and sign up page.
  - `css/app.css` holds the shared styles.
  - `js/firebase.js` starts Firebase once; every page imports from it.
  - `js/firebase-config.js` holds the project's public web settings.
  - `js/auth-page.js` is the code for the log in page.
- `plan/` holds the project brief (`HATUD_PROJECT_BRIEF.md`).
- `firestore.rules` and `firestore.indexes.json` are the database rules and indexes.
- `firebase.json` and `.firebaserc` connect this folder to the Firebase project.

## Deploy

    firebase deploy --only hosting      # the website
    firebase deploy --only firestore    # database rules and indexes

## Rule: no secrets in this repository

It is public. Never commit passwords, tokens, private keys or APK signing keys, ever.