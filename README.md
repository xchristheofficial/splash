# 💧 Splash

Splash is a social app for chatting with friends in real time and posting moments.

## Features

- **Accounts** — sign up with email and password; log in with email or username; optional Google sign-in, pick an avatar emoji & color
- **Feed** — post with a mood emoji, like ❤️, comment, delete your posts, search
- **Chat** — 🌍 Global chat (everyone) + private DMs, typing indicators, online presence, delete your messages
- **People** — discover users, follow/unfollow, jump straight into a DM
- **Profile** — bio, stats (posts / followers / following), edit your profile
- **Notifications** — likes, comments, follows & new messages (bell icon)
- **Stories row & trending moods** on the feed
- **Real-time** — everything updates live via Socket.IO (no refresh needed)

## Run it

```bash
npm install
npm start        # http://localhost:3000
```

## Tech

Node.js + Express + Socket.IO. Locally, data is stored in `data/db.json` (starts empty on first run); in production configure PostgreSQL or a persistent disk as described below. Passwords are hashed with scrypt; sessions use random tokens.


## Google sign-in on Render

1. In Google Cloud, configure the OAuth consent screen and create a **Web application** OAuth client. Add your site origin (for example `https://splash-2.onrender.com`) under **Authorized JavaScript origins**. Add `http://localhost:3000` for local testing.
2. In Render, add an environment variable with key `GOOGLE_CLIENT_ID` and the OAuth client ID as its value. Do not put a client secret in the app. Redeploy after saving.
3. Google sign-in is hidden until a client ID is configured. Google requires a verified email. Existing email/password accounts are not automatically linked to Google accounts; use your password to access them.

## Persistent storage on Render

Render web service filesystems are temporary unless a persistent disk is mounted. To keep accounts, posts, messages and other data across deploys and restarts, create a Render Postgres database and set the web service environment variable **`DATABASE_URL`** to its internal database URL. Keep the URL private. Deploy the updated code after setting it. The app refuses to start on Render without `DATABASE_URL` or `DATA_DIR`, rather than silently saving to temporary storage.

The app stores a single snapshot in PostgreSQL and allows only one running app instance per database. Do not scale to multiple instances. For larger deployments, migrate to a database schema designed for concurrent access. As an alternative, on an eligible paid Render service, attach a persistent disk and set `DATA_DIR` to its mount path, for example `/var/data` (do not set `DATABASE_URL` at the same time). A `DATA_DIR` pointing to the ordinary Render filesystem is not persistent.

**Existing data:** Connecting a new empty database does not automatically copy the old service's local file. Back up and export the existing `data/db.json` from the current running service *before* redeploying, then place that file in a directory accessible to the new deployment and temporarily set `DATA_DIR` to that directory and `IMPORT_LOCAL_DATA=true` alongside `DATABASE_URL`. Import only happens when the PostgreSQL state is empty; remove `IMPORT_LOCAL_DATA` after the first successful start. If the old instance's ephemeral data has already been lost, it cannot be recovered by this app.

No storage system guarantees data forever. Configure database backups and check Render's retention, expiration and billing terms; an expired or deleted database can still lose data. Verify backups and recovery before using the app publicly.

## Important before a public launch

This remains a prototype: email addresses are not verified, and there is no password reset, rate limiting or moderation. Address these and other security and operational gaps before inviting real users.
Existing databases automatically remove the five original demo accounts and their posts, messages, direct-message conversations, follows, sessions, and related activity at startup. Real accounts and their unrelated content are preserved. Back up persistent data before deploying.
