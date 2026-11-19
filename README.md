# 💧 Splash

Splash is a social app for chatting with friends in real time and posting moments.

## Features

- **Accounts** — sign up / log in with username + password, pick an avatar emoji & color
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

## Demo accounts

All demo accounts use password `demo123`:

| Username | Name |
|---|---|
| `amara` | Amara Otieno |
| `kofi` | Kofi Mensah |
| `zuri` | Zuri Wanjiru |
| `dante` | Dante Kimani |
| `splash` | Splash Official |

Or click **"Try the demo"** on the login screen, or sign up with your own username.

## Tech

Node.js + Express + Socket.IO. Data is stored in `data/db.json` (auto-seeded on first run). Passwords are hashed with scrypt; sessions use random tokens.
