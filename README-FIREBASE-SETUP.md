# Life Admin — Firebase Setup

This copy of Life Admin uses:

- Firebase Authentication for email/password accounts
- Cloud Firestore for reminders, expenses and appearance settings
- Firestore Security Rules so each user can access only their own data
- Firebase Hosting configuration
- Realtime Firestore listeners for cross-device refresh
- Local browser storage plus an offline-change queue
- The existing installable PWA, logo and themes

## STEP 1 — Create your Firebase project

1. Open the Firebase Console.
2. Choose **Create a project**.
3. Name it, for example: `Life Admin`.
4. Google Analytics is optional for this app.

## STEP 2 — Register the web app

1. Open the project overview.
2. Choose the **Web** icon (`</>`).
3. Give the web app a nickname such as `Life Admin Web`.
4. Register the app.
5. Firebase will show a `firebaseConfig` object.

Open:

`public/firebase-config.js`

Replace the placeholder values with the values Firebase gives you.

## STEP 3 — Enable Email/Password login

In the Firebase Console:

**Authentication → Sign-in method → Email/Password**

Enable **Email/Password** and save it.

The app already contains:

- Create account
- Sign in
- Sign out
- Password reset email
- Persistent browser sessions

## STEP 4 — Create Cloud Firestore

In the Firebase Console:

**Firestore Database → Create database**

Choose a production database location appropriate for your users.

Do not leave your database on open test rules.

After the database exists, open:

**Firestore Database → Rules**

Replace the rules with the contents of:

`firestore.rules`

Then publish them.

These rules allow a user to read/write only:

`users/{their Firebase UID}/...`

## STEP 5 — Test locally

From the `life-admin-firebase` folder, run a normal local web server.

For example:

`python -m http.server 8080 -d public`

Then open:

`http://localhost:8080`

Do not simply double-click `index.html`, because module imports and PWA/service-worker behavior work best from a web server.

## STEP 6 — Deploy to Firebase Hosting

Install Node.js first if you do not already have it.

Then:

`npm install -g firebase-tools`

Sign in:

`firebase login`

Inside the `life-admin-firebase` folder:

`firebase use --add`

Choose your Firebase project.

Then deploy:

`firebase deploy`

Firebase will deploy:

- Firestore security rules
- The website in `public/`

Your app will receive an HTTPS `web.app` / `firebaseapp.com` address.

## Your own domain

You can later connect a custom domain from:

**Firebase Console → Hosting → Add custom domain**

## Important security note

The normal Firebase Web configuration is expected to be present in browser code.
Private access is not protected by hiding the Firebase `apiKey`; it is protected by Firebase Authentication and Firestore Security Rules.

Do not place unrelated private API secrets, service-account JSON, Gemini API keys, or server credentials into `firebase-config.js`.

## Data structure

Each signed-in user's data is kept under their UID:

users
  └── USER_UID
      ├── reminders
      │   └── REMINDER_ID
      ├── expenses
      │   └── EXPENSE_ID
      └── settings
          └── appearance

This keeps each user's Life Admin data separated.

## Existing local data

When a user signs into an empty Firebase account for the first time, the app can move the reminders and expenses already stored locally in that browser into their Firebase account.

## Notifications

The existing reminder notifications still work while the PWA/browser is running.

A future upgrade can add Firebase Cloud Messaging if you want true push notifications delivered while the app is closed.
