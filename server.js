const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(process.env.DATA_DIR || path.join(__dirname, 'data'), 'db.json');

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- DB ----------
function seed() {
  return { users: [], posts: [], messages: [], notifications: [], follows: [], tokens: {} };
}

function hashPw(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPw(pw, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const h = crypto.scryptSync(pw, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(h));
  } catch { return false; }
}
function uid(p) { return p + crypto.randomBytes(6).toString('hex'); }

let db;
let pgClient;
let pendingSave = Promise.resolve();
let storageError = null;

async function initializeStorage() {
  if (process.env.DATABASE_URL) {
    pgClient = new Client({ connectionString: process.env.DATABASE_URL });
    await pgClient.connect();
    // This application holds one in-memory snapshot; prohibit multiple writers.
    const lock = await pgClient.query("SELECT pg_try_advisory_lock(1936744552) AS acquired");
    if (!lock.rows[0].acquired) throw new Error('Another Splash instance is already using this database');
    pgClient.on('error', err => { console.error('Database connection lost:', err.message); storageError = err; });
    await pgClient.query('CREATE TABLE IF NOT EXISTS splash_state (id integer PRIMARY KEY CHECK (id = 1), data jsonb NOT NULL)');
    const result = await pgClient.query('SELECT data FROM splash_state WHERE id = 1');
    if (result.rows.length) db = result.rows[0].data;
    else {
      // Import only when explicitly requested; never replace an existing database.
      if (process.env.IMPORT_LOCAL_DATA === 'true') {
        if (!fs.existsSync(DB_PATH)) throw new Error('IMPORT_LOCAL_DATA is set but the local data file does not exist');
        db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      } else db = seed();
      await pgClient.query('INSERT INTO splash_state (id, data) VALUES (1, $1::jsonb)', [JSON.stringify(db)]);
    }
  } else {
    if (process.env.RENDER && !process.env.DATA_DIR) throw new Error('Set DATABASE_URL or DATA_DIR to persistent storage before deploying on Render');
    if (fs.existsSync(DB_PATH)) db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    else {
      db = seed();
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    }
  }
  removeDemoAccounts();
  await pendingSave;
}

// Remove only the original seeded accounts, identified by their fixed ID and username.
// Registered accounts receive random IDs, so even a matching username is preserved.
function removeDemoAccounts() {
const demoIds = new Map([['u1', 'splash'], ['u2', 'amara'], ['u3', 'kofi'], ['u4', 'zuri'], ['u5', 'dante']]);
const removed = new Set(db.users.filter(u => demoIds.get(u.id) === u.username).map(u => u.id));
if (removed.size) {
  const removedPosts = new Set(db.posts.filter(p => removed.has(p.userId)).map(p => p.id));
  db.users = db.users.filter(u => !removed.has(u.id));
  db.posts = db.posts.filter(p => !removed.has(p.userId));
  for (const post of db.posts) {
    post.likes = post.likes.filter(id => !removed.has(id));
    post.comments = post.comments.filter(c => !removed.has(c.userId));
  }
  const removedRooms = new Set(db.messages.filter(m => m.room.startsWith('dm:') && m.room.slice(3).split(':').some(id => removed.has(id))).map(m => m.room));
  db.messages = db.messages.filter(m => !removed.has(m.userId) && !removedRooms.has(m.room));
  db.follows = db.follows.filter(f => !removed.has(f.followerId) && !removed.has(f.followingId));
  db.notifications = db.notifications.filter(n => !removed.has(n.userId) && !removed.has(n.refId) && !removedPosts.has(n.refId) && !removedRooms.has(n.refId));
  for (const [token, id] of Object.entries(db.tokens)) if (removed.has(id)) delete db.tokens[token];
  save();
}
}
// Queue complete snapshots in order. A response is not acknowledged until its write finishes.
function save() {
  const snapshot = JSON.stringify(db);
  pendingSave = pendingSave.then(async () => {
    if (storageError) throw storageError;
    if (pgClient) await pgClient.query('UPDATE splash_state SET data = $1::jsonb WHERE id = 1', [snapshot]);
    else {
      const tmp = DB_PATH + '.tmp';
      fs.writeFileSync(tmp, snapshot);
      fs.renameSync(tmp, DB_PATH);
    }
  });
  pendingSave.catch(err => { storageError = err; console.error('Failed to save Splash data:', err.message); });
}
app.use('/api', (req, res, next) => {
  if (storageError) return res.status(503).json({ error: 'Storage unavailable; please try again later' });
  const end = res.end;
  res.end = function (chunk, encoding, callback) {
    const response = this;
    pendingSave.then(() => end.call(response, chunk, encoding, callback), () => {
      if (!response.headersSent) {
        response.statusCode = 503;
        response.removeHeader('Content-Length');
        response.setHeader('Content-Type', 'application/json');
        end.call(response, JSON.stringify({ error: 'Unable to save data; please try again later' }));
      } else end.call(response);
    });
    return response;
  };
  next();
});
function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, displayName: u.displayName, avatar: u.avatar, color: u.color, bio: u.bio || '', createdAt: u.createdAt, lastSeen: u.lastSeen };
}
function userById(id) { return db.users.find(u => u.id === id); }
function userByName(name) { return db.users.find(u => u.username.toLowerCase() === String(name).toLowerCase()); }
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  const userId = t && db.tokens[t];
  const u = userId && userById(userId);
  if (!u) return res.status(401).json({ error: 'Not logged in' });
  req.user = u; req.token = t; next();
}
function notify(userId, type, text, refId) {
  if (!userId || userId === arguments[4]) {}
  db.notifications.unshift({ id: uid('n'), userId, type, text, refId: refId || null, read: false, createdAt: Date.now() });
  io.to('user:' + userId).emit('notification:new', db.notifications.find(n => n.userId === userId));
  save();
}
function enrichPost(p, me) {
  const u = userById(p.userId);
  return { ...p, author: publicUser(u), likedByMe: me ? p.likes.includes(me.id) : false, likeCount: p.likes.length, commentCount: p.comments.length };
}
function enrichMsg(m) { return { ...m, author: publicUser(userById(m.userId)) }; }

// ---------- Auth ----------
app.post('/api/auth/register', (req, res) => {
  const { username, password, displayName, avatar, color } = req.body || {};
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Please enter a valid email address' });
  if (db.users.some(u => u.email === email)) return res.status(400).json({ error: 'Email already in use' });
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const uname = String(username).trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (uname.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters (letters, numbers, _)' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (userByName(uname)) return res.status(400).json({ error: 'Username already taken' });
  const u = { id: uid('u'), username: uname, email, displayName: String(displayName || uname).slice(0, 40), passwordHash: hashPw(String(password)), avatar: String(avatar || '😎').slice(0, 4), color: String(color || '#06b6d4'), bio: '', createdAt: Date.now(), lastSeen: Date.now() };
  db.users.push(u);
  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = u.id; save();
  res.json({ token, user: publicUser(u) });
});
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const identifier = String(username || req.body?.email || '').trim().toLowerCase();
  const u = db.users.find(user => user.email === identifier) || userByName(identifier);
  if (!u || !verifyPw(String(password || ''), u.passwordHash)) return res.status(401).json({ error: 'Invalid email, username or password' });
  const token = crypto.randomBytes(24).toString('hex');
  db.tokens[token] = u.id; u.lastSeen = Date.now(); save();
  res.json({ token, user: publicUser(u) });
});
// Google Identity Services sends a signed ID token; verify it before using any claims.
app.get('/api/auth/config', (req, res) => res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null }));
app.post('/api/auth/google', async (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google sign-in is not configured' });
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: req.body?.credential, audience: process.env.GOOGLE_CLIENT_ID });
    const claims = ticket.getPayload();
    if (!claims.email_verified || !claims.email || !claims.sub) return res.status(401).json({ error: 'Google email must be verified' });
    const email = claims.email.toLowerCase();
    let u = db.users.find(user => user.googleId === claims.sub);
    // Do not automatically link an existing password account: its email has not been verified by Splash.
    if (!u && db.users.some(user => user.email === email)) return res.status(409).json({ error: 'This email is already registered. Please log in with your password.' });
    if (!u) {
      const base = (email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 18) || 'user');
      let username = base;
      while (userByName(username)) username = base + crypto.randomBytes(3).toString('hex');
      u = { id: uid('u'), username, email, googleId: claims.sub, displayName: String(claims.name || username).slice(0, 40), avatar: '😎', color: '#06b6d4', bio: '', createdAt: Date.now(), lastSeen: Date.now() };
      db.users.push(u);
    }
    const token = crypto.randomBytes(24).toString('hex');
    db.tokens[token] = u.id; u.lastSeen = Date.now(); save();
    res.json({ token, user: publicUser(u) });
  } catch { res.status(401).json({ error: 'Google sign-in failed. Please try again.' }); }
});
app.post('/api/auth/logout', auth, (req, res) => { delete db.tokens[req.token]; save(); res.json({ ok: true }); });
app.get('/api/me', auth, (req, res) => res.json(publicUser(req.user)));
app.patch('/api/me', auth, (req, res) => {
  const { displayName, avatar, color, bio } = req.body || {};
  if (displayName) req.user.displayName = String(displayName).slice(0, 40);
  if (avatar) req.user.avatar = String(avatar).slice(0, 4);
  if (color) req.user.color = String(color);
  if (bio !== undefined) req.user.bio = String(bio).slice(0, 160);
  save(); res.json(publicUser(req.user));
});

// ---------- Users / follows ----------
app.get('/api/users', auth, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  const list = db.users.filter(u => u.id !== req.user.id && (!q || u.username.includes(q) || u.displayName.toLowerCase().includes(q)));
  res.json(list.map(u => ({ ...publicUser(u), following: db.follows.some(f => f.followerId === req.user.id && f.followingId === u.id), followers: db.follows.filter(f => f.followingId === u.id).length })));
});
app.get('/api/users/:username', auth, (req, res) => {
  const u = userByName(req.params.username);
  if (!u) return res.status(404).json({ error: 'User not found' });
  const posts = db.posts.filter(p => p.userId === u.id).map(p => enrichPost(p, req.user));
  res.json({ ...publicUser(u), followers: db.follows.filter(f => f.followingId === u.id).length, following: db.follows.filter(f => f.followerId === u.id).length, isFollowing: db.follows.some(f => f.followerId === req.user.id && f.followingId === u.id), isMe: u.id === req.user.id, posts });
});
app.post('/api/users/:username/follow', auth, (req, res) => {
  const u = userByName(req.params.username);
  if (!u || u.id === req.user.id) return res.status(400).json({ error: 'Cannot follow' });
  const i = db.follows.findIndex(f => f.followerId === req.user.id && f.followingId === u.id);
  let following;
  if (i >= 0) { db.follows.splice(i, 1); following = false; }
  else { db.follows.push({ followerId: req.user.id, followingId: u.id }); following = true; notify(u.id, 'follow', `${req.user.displayName} started following you`, req.user.id); }
  save(); res.json({ following });
});

// ---------- Posts ----------
app.get('/api/posts', auth, (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  let posts = [...db.posts].sort((a, b) => b.createdAt - a.createdAt);
  if (q) posts = posts.filter(p => p.text.toLowerCase().includes(q) || (userById(p.userId)?.displayName || '').toLowerCase().includes(q));
  res.json(posts.map(p => enrichPost(p, req.user)));
});
app.post('/api/posts', auth, (req, res) => {
  const text = String(req.body?.text || '').trim().slice(0, 500);
  if (!text) return res.status(400).json({ error: 'Post cannot be empty' });
  const post = { id: uid('p'), userId: req.user.id, text, mood: String(req.body?.mood || '💧').slice(0, 4), likes: [], comments: [], createdAt: Date.now() };
  db.posts.push(post); save();
  const enriched = enrichPost(post, req.user);
  io.emit('post:new', enriched);
  res.status(201).json(enriched);
});
app.post('/api/posts/:id/like', auth, (req, res) => {
  const p = db.posts.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Post not found' });
  const i = p.likes.indexOf(req.user.id);
  if (i >= 0) p.likes.splice(i, 1); else { p.likes.push(req.user.id); if (p.userId !== req.user.id) notify(p.userId, 'like', `${req.user.displayName} liked your post`, p.id); }
  save();
  const enriched = enrichPost(p, req.user);
  io.emit('post:like', { id: p.id, likes: p.likes, likeCount: p.likes.length });
  res.json(enriched);
});
app.post('/api/posts/:id/comment', auth, (req, res) => {
  const p = db.posts.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Post not found' });
  const text = String(req.body?.text || '').trim().slice(0, 300);
  if (!text) return res.status(400).json({ error: 'Comment cannot be empty' });
  const c = { id: uid('c'), userId: req.user.id, text, createdAt: Date.now() };
  p.comments.push(c); save();
  if (p.userId !== req.user.id) notify(p.userId, 'comment', `${req.user.displayName} commented: "${text.slice(0, 40)}"`, p.id);
  const enrichedComment = { ...c, author: publicUser(req.user) };
  io.emit('post:comment', { postId: p.id, comment: enrichedComment, commentCount: p.comments.length });
  res.status(201).json(enrichedComment);
});
app.delete('/api/posts/:id/comment/:cid', auth, (req, res) => {
  const p = db.posts.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ error: 'Post not found' });
  const i = p.comments.findIndex(c => c.id === req.params.cid);
  if (i < 0) return res.status(404).json({ error: 'Comment not found' });
  if (p.comments[i].userId !== req.user.id && p.userId !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
  p.comments.splice(i, 1); save();
  io.emit('post:comment:delete', { postId: p.id, commentId: req.params.cid, commentCount: p.comments.length });
  res.json({ ok: true });
});
app.delete('/api/posts/:id', auth, (req, res) => {
  const i = db.posts.findIndex(p => p.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Post not found' });
  if (db.posts[i].userId !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
  db.posts.splice(i, 1); save();
  io.emit('post:delete', { id: req.params.id });
  res.json({ ok: true });
});

// ---------- Messages ----------
function dmRoom(a, b) { return 'dm:' + [a, b].sort().join(':'); }
function canAccessRoom(room, userId) {
  if (room === 'global') return true;
  if (typeof room !== 'string') return false;
  const parts = room.split(':');
  return parts.length === 3 && parts[0] === 'dm' && parts[1] !== parts[2] &&
    parts.includes(userId) && !!userById(parts[1]) && !!userById(parts[2]) && room === dmRoom(parts[1], parts[2]);
}
function roomAudience(room) {
  if (room === 'global') return io.to('global');
  const [, a, b] = room.split(':');
  return io.to('user:' + a).to('user:' + b);
}
app.get('/api/messages', auth, (req, res) => {
  const room = String(req.query.room || 'global');
  if (!canAccessRoom(room, req.user.id)) return res.status(403).json({ error: 'Not allowed' });
  let msgs = db.messages.filter(m => m.room === room);
  msgs = msgs.slice(-100);
  res.json(msgs.map(enrichMsg));
});
app.get('/api/chats', auth, (req, res) => {
  // list of DM partners with last message + unread-ish preview
  const partners = new Map();
  for (const m of db.messages) {
    if (!m.room.startsWith('dm:')) continue;
    const [a, b] = m.room.slice(3).split(':');
    if (a !== req.user.id && b !== req.user.id) continue;
    const otherId = a === req.user.id ? b : a;
    const prev = partners.get(otherId);
    if (!prev || m.createdAt > prev.createdAt) partners.set(otherId, m);
  }
  const list = [...partners.entries()].map(([otherId, m]) => ({ user: publicUser(userById(otherId)), lastMessage: enrichMsg(m), room: m.room }));
  list.sort((x, y) => y.lastMessage.createdAt - x.lastMessage.createdAt);
  res.json(list);
});
app.post('/api/messages', auth, (req, res) => {
  const { room, text } = req.body || {};
  const t = String(text || '').trim().slice(0, 1000);
  if (!t || !room) return res.status(400).json({ error: 'Message cannot be empty' });
  if (!canAccessRoom(room, req.user.id)) return res.status(403).json({ error: 'Not allowed' });
  const msg = { id: uid('m'), room, userId: req.user.id, text: t, createdAt: Date.now() };
  db.messages.push(msg); save();
  const enriched = enrichMsg(msg);
  roomAudience(room).emit('message:new', enriched);
  if (room.startsWith('dm:')) {
    const otherId = room.slice(3).split(':').find(id => id !== req.user.id);
    if (otherId) notify(otherId, 'message', `${req.user.displayName}: ${t.slice(0, 50)}`, room);
  }
  res.status(201).json(enriched);
});
app.delete('/api/messages/:id', auth, (req, res) => {
  const i = db.messages.findIndex(m => m.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'Message not found' });
  if (db.messages[i].userId !== req.user.id) return res.status(403).json({ error: 'Not allowed' });
  const room = db.messages[i].room;
  db.messages.splice(i, 1); save();
  roomAudience(room).emit('message:delete', { id: req.params.id, room });
  res.json({ ok: true });
});

// ---------- Notifications ----------
app.get('/api/notifications', auth, (req, res) => {
  res.json(db.notifications.filter(n => n.userId === req.user.id).slice(0, 30));
});
app.post('/api/notifications/read', auth, (req, res) => {
  db.notifications.forEach(n => { if (n.userId === req.user.id) n.read = true; });
  save(); res.json({ ok: true });
});

// ---------- Socket ----------
const online = new Map(); // socketId -> userId
io.on('connection', (socket) => {
  let user = null;
  socket.on('join', (token) => {
    if (user) return;
    const userId = token && db.tokens[token];
    user = userId && userById(userId);
    if (!user) return;
    user.lastSeen = Date.now();
    online.set(socket.id, user.id);
    socket.join('user:' + user.id);
    socket.join('global');
    io.emit('presence', { userId: user.id, online: true, lastSeen: user.lastSeen });
  });
  socket.on('typing', ({ room } = {}) => {
    if (!user || !canAccessRoom(room, user.id)) return;
    const audience = room === 'global' ? socket.to('global') : socket.to('user:' + room.split(':').find(id => id !== 'dm' && id !== user.id));
    audience.emit('message:typing', { room, userId: user.id, displayName: user.displayName, avatar: user.avatar });
  });
  socket.on('disconnect', () => {
    if (user) {
      user.lastSeen = Date.now(); save();
      online.delete(socket.id);
      if (![...online.values()].includes(user.id)) io.emit('presence', { userId: user.id, online: false, lastSeen: user.lastSeen });
    }
  });
});
io.engine.on('connection_error', () => {});

// presence helper for REST
app.get('/api/online', auth, (req, res) => {
  const ids = [...new Set(online.values())];
  res.json(ids);
});

app.get('/api/health', (req, res) => res.json({ ok: true, app: 'Splash', users: db.users.length, posts: db.posts.length }));

app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initializeStorage().then(() => {
  server.listen(PORT, '0.0.0.0', () => console.log(`💧 Splash running on http://0.0.0.0:${PORT}`));
}).catch(err => { console.error('Unable to initialize persistent storage:', err.message); process.exit(1); });
