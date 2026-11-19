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

Node.js + Express + Socket.IO. Data is stored in `data/db.json` (starts empty on first run). Passwords are hashed with scrypt; sessions use random tokens.


## Google sign-in on Render

1. In Google Cloud, configure the OAuth consent screen and create a **Web application** OAuth client. Add your site origin (for example `https://splash-2.onrender.com`) under **Authorized JavaScript origins**. Add `http://localhost:3000` for local testing.
2. In Render, add an environment variable with key `GOOGLE_CLIENT_ID` and the OAuth client ID as its value. Do not put a client secret in the app. Redeploy after saving.
3. Google sign-in is hidden until a client ID is configured. Google requires a verified email. Existing email/password accounts are not automatically linked to Google accounts; use your password to access them.

## Important before a public launch

This is a prototype, not production-ready. Email addresses are not verified, and there is no password reset, rate limiting, moderation, or durable production database. Render's free instance storage is ephemeral: account and post data can disappear on restart or redeploy. Use a persistent database and address these security and operational gaps before inviting real users. For a Render persistent disk, set `DATA_DIR` to its mount path (such as `/var/data`); persistent disks require an eligible paid service.

Existing databases automatically remove the five original demo accounts and their posts, messages, direct-message conversations, follows, sessions, and related activity at startup. Real accounts and their unrelated content are preserved. Back up persistent data before deploying.
