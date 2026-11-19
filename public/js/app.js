/* Splash — frontend */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const AVATARS = ['😎','🌺','🎧','✨','⚽','🦁','🚀','🎨','🍕','🐱','🔥','💎','🌙','⭐','🎸','🏀'];
const COLORS = ['#06b6d4','#f472b6','#a78bfa','#fbbf24','#34d399','#f87171','#60a5fa','#fb923c'];
const MOODS = ['💧','🎉','🌅','🎧','📚','⚽','🔥','❤️','😂','😢','🤔','💪'];

let me = null, token = localStorage.getItem('splash_token') || null;
let posts = [], users = [], chats = [], messages = [], notifications = [];
let activeRoom = 'global', activeView = 'feed', selectedMood = '💧', selectedAvatar = '😎', selectedColor = '#06b6d4';
let onlineSet = new Set(), unreadChat = 0, searchQ = '', profileUser = null;
let socket = null, typingTimer = null;

function timeAgo(ts){
  const s = Math.floor((Date.now()-ts)/1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60)+'m ago';
  if (s < 86400) return Math.floor(s/3600)+'h ago';
  return Math.floor(s/86400)+'d ago';
}
function avatarHtml(u, cls=''){
  if(!u) return `<span class="avatar ${cls}" style="background:#334155">❓</span>`;
  return `<span class="avatar ${cls}" style="background:${esc(u.color)}33;border:2px solid ${esc(u.color)}">${esc(u.avatar)}</span>`;
}
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.remove('hidden'); setTimeout(()=>t.classList.add('hidden'),2500); }

async function api(path, opts={}){
  const res = await fetch(path, { ...opts, headers:{ 'Content-Type':'application/json', ...(token?{Authorization:'Bearer '+token}:{}), ...(opts.headers||{}) }});
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

/* ---------- AUTH ---------- */
function setAuthMode(login){
  $('#tabLogin').classList.toggle('active', login);
  $('#tabRegister').classList.toggle('active', !login);
  $('#loginForm').classList.toggle('hidden', !login);
  $('#registerForm').classList.toggle('hidden', login);
  $('#authError').textContent='';
}
$('#tabLogin').onclick = ()=>setAuthMode(true);
$('#tabRegister').onclick = ()=>setAuthMode(false);

function buildPickers(){
  $('#avatarPicker').innerHTML = AVATARS.map(a=>`<button type="button" data-a="${a}" class="${a===selectedAvatar?'sel':''}">${a}</button>`).join('');
  $('#avatarPicker').onclick = e=>{ const b=e.target.closest('button'); if(!b)return; selectedAvatar=b.dataset.a; $$('#avatarPicker button').forEach(x=>x.classList.toggle('sel',x===b)); };
  $('#colorPicker').innerHTML = COLORS.map(c=>`<button type="button" data-c="${c}" style="background:${c}" class="${c===selectedColor?'sel':''}"></button>`).join('');
  $('#colorPicker').onclick = e=>{ const b=e.target.closest('button'); if(!b)return; selectedColor=b.dataset.c; $$('#colorPicker button').forEach(x=>x.classList.toggle('sel',x===b)); };
  $('#moodPicker').innerHTML = MOODS.map(m=>`<button type="button" data-m="${m}" class="${m===selectedMood?'sel':''}">${m}</button>`).join('');
  $('#moodPicker').onclick = e=>{ const b=e.target.closest('button'); if(!b)return; selectedMood=b.dataset.m; $$('#moodPicker button').forEach(x=>x.classList.toggle('sel',x===b)); };
}
buildPickers();

async function doLogin(username, password){
  const data = await api('/api/auth/login', {method:'POST', body:JSON.stringify({username,password})});
  token = data.token; me = data.user; localStorage.setItem('splash_token', token);
  enterApp();
}
$('#loginForm').onsubmit = async e=>{
  e.preventDefault();
  try{ await doLogin($('#loginUser').value.trim(), $('#loginPass').value); }
  catch(err){ $('#authError').textContent = err.message; }
};
$('#registerForm').onsubmit = async e=>{
  e.preventDefault();
  try{
    const data = await api('/api/auth/register', {method:'POST', body:JSON.stringify({
      username: $('#regUser').value.trim(), password: $('#regPass').value,
      displayName: $('#regName').value.trim(), avatar: selectedAvatar, color: selectedColor })});
    token = data.token; me = data.user; localStorage.setItem('splash_token', token);
    toast('Welcome to Splash! 💧'); enterApp();
  }catch(err){ $('#authError').textContent = err.message; }
};
$('#demoBtn').onclick = async ()=>{
  try{ await doLogin('amara','demo123'); }catch(err){ $('#authError').textContent = err.message; }
};
$('#logoutBtn').onclick = async ()=>{
  try{ await api('/api/auth/logout',{method:'POST'}); }catch{}
  token=null; me=null; localStorage.removeItem('splash_token');
  location.reload();
};

/* ---------- APP SHELL ---------- */
function enterApp(){
  $('#authScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#meAvatar').outerHTML = avatarHtml(me,'sm').replace('class="avatar sm"','id="meAvatar" class="avatar sm"');
  $('#meName').textContent = me.displayName;
  $('#composerAvatar').outerHTML = avatarHtml(me).replace('class="avatar"','id="composerAvatar" class="avatar"');
  connectSocket();
  loadAll();
  switchView('feed');
}
$('#meBtn').onclick = ()=>{ profileUser=null; switchView('profile'); };

function switchView(v){
  activeView = v;
  $$('.nav-item[data-view]').forEach(b=>b.classList.toggle('active', b.dataset.view===v));
  ['feed','chat','people','profile'].forEach(x=>$('#view-'+x).classList.toggle('hidden', x!==v));
  if(v==='people') loadPeople();
  if(v==='profile') loadProfile(profileUser ? profileUser.username : me.username);
  if(v==='chat'){ loadChats(); loadMessages(); unreadChat=0; updateBadges(); }
}
$$('.nav-item[data-view]').forEach(b=> b.onclick = ()=>switchView(b.dataset.view));
$('#chatBack').onclick = ()=>{ $('#chatListItems').scrollIntoView(); };

async function loadAll(){
  await Promise.all([loadPosts(), loadPeople(true), loadChats(), loadNotifications(), loadOnline()]);
  renderStories(); renderTrending();
}

/* ---------- POSTS ---------- */
async function loadPosts(){
  try{ posts = await api('/api/posts' + (searchQ ? '?q='+encodeURIComponent(searchQ) : '')); renderFeed(); }catch(e){ console.error(e); }
}
function renderFeed(){
  const el = $('#feedList');
  if(!posts.length){ el.innerHTML = `<div class="empty">💧 No posts yet.<br>Be the first to make a splash!</div>`; return; }
  el.innerHTML = posts.map(postHtml).join('');
  el.querySelectorAll('[data-like]').forEach(b=> b.onclick = ()=>likePost(b.dataset.like));
  el.querySelectorAll('[data-del-post]').forEach(b=> b.onclick = ()=>deletePost(b.dataset.delPost));
  el.querySelectorAll('[data-toggle-comments]').forEach(b=> b.onclick = ()=>{ const c=$('#comments-'+b.dataset.toggleComments); c.classList.toggle('hidden'); });
  el.querySelectorAll('[data-author]').forEach(b=> b.onclick = ()=>{ profileUser={username:b.dataset.author}; switchView('profile'); });
  el.querySelectorAll('.comment-form').forEach(f=> f.onsubmit = e=>{ e.preventDefault(); submitComment(f.dataset.post, f.querySelector('input').value); });
  el.querySelectorAll('[data-del-comment]').forEach(b=> b.onclick = ()=>deleteComment(b.dataset.post, b.dataset.delComment));
}
function postHtml(p){
  const mine = me && p.author && p.author.id===me.id;
  return `<article class="card post" id="post-${p.id}">
    <div class="post-head">
      ${avatarHtml(p.author)}
      <div><div class="post-author" data-author="${esc(p.author?.username||'')}">${esc(p.author?.displayName||'Unknown')}</div>
      <div class="post-time">@${esc(p.author?.username||'')} · ${timeAgo(p.createdAt)}</div></div>
      <span class="post-mood">${esc(p.mood||'💧')}</span>
    </div>
    <p class="post-text">${esc(p.text)}</p>
    <div class="post-actions">
      <button class="action-btn ${p.likedByMe?'liked':''}" data-like="${p.id}">${p.likedByMe?'❤️':'🤍'} <span>${p.likeCount}</span></button>
      <button class="action-btn" data-toggle-comments="${p.id}">💬 <span id="ccount-${p.id}">${p.commentCount}</span></button>
      ${mine?`<button class="action-btn post-delete" data-del-post="${p.id}">🗑 Delete</button>`:''}
    </div>
    <div id="comments-${p.id}" class="comments ${p.commentCount?'':'hidden'}">
      ${p.comments.map(c=>commentHtml(p.id,c)).join('')}
      <form class="comment-form" data-post="${p.id}"><input placeholder="Add a comment..." maxlength="300"><button type="submit">Reply</button></form>
    </div>
  </article>`;
}
function commentHtml(postId, c){
  const canDel = me && (c.userId===me.id || posts.find(p=>p.id===postId)?.userId===me.id);
  return `<div class="comment" id="comment-${c.id}">${avatarHtml(c.author)}
    <div class="comment-body"><b>${esc(c.author?.displayName||'')}</b> <span class="post-time">${timeAgo(c.createdAt)}</span><br>${esc(c.text)}</div>
    ${canDel?`<button class="comment-del" data-del-comment="${c.id}" data-post="${postId}">✕</button>`:''}</div>`;
}
$('#postInput').addEventListener('input', e=> $('#charCount').textContent = 500 - e.target.value.length);
$('#postBtn').onclick = async ()=>{
  const text = $('#postInput').value.trim();
  if(!text) return;
  try{
    const p = await api('/api/posts',{method:'POST', body:JSON.stringify({text, mood:selectedMood})});
    posts.unshift(p); $('#postInput').value=''; $('#charCount').textContent=500; renderFeed(); renderTrending();
  }catch(e){ toast(e.message); }
};
async function likePost(id){
  try{ const p = await api(`/api/posts/${id}/like`,{method:'POST'}); const i=posts.findIndex(x=>x.id===id); if(i>=0) posts[i]=p; renderFeed(); }
  catch(e){ toast(e.message); }
}
async function deletePost(id){ if(!confirm('Delete this post?'))return; try{ await api(`/api/posts/${id}`,{method:'DELETE'}); posts=posts.filter(p=>p.id!==id); renderFeed(); }catch(e){toast(e.message);} }
async function submitComment(postId, text){
  text=(text||'').trim(); if(!text) return;
  try{ const c = await api(`/api/posts/${postId}/comment`,{method:'POST', body:JSON.stringify({text})});
    const p = posts.find(x=>x.id===postId); if(p){ p.comments.push(c); p.commentCount=p.comments.length; }
    renderFeed(); const box=$('#comments-'+postId); if(box) box.classList.remove('hidden');
  }catch(e){ toast(e.message); }
}
async function deleteComment(postId, cid){
  try{ await api(`/api/posts/${postId}/comment/${cid}`,{method:'DELETE'});
    const p=posts.find(x=>x.id===postId); if(p){ p.comments=p.comments.filter(c=>c.id!==cid); p.commentCount=p.comments.length; } renderFeed();
  }catch(e){ toast(e.message); }
}

/* ---------- STORIES & TRENDING ---------- */
function renderStories(){
  const seen=new Set();
  const storyUsers = users.filter(u=>!seen.has(u.id) && seen.add(u.id));
  $('#storiesRow').innerHTML = storyUsers.slice(0,10).map(u=>`
    <div class="story" data-user="${esc(u.username)}"><div class="story-ring">${avatarHtml(u)}</div><span>${esc(u.displayName.split(' ')[0])}</span></div>`).join('');
  $$('#storiesRow .story').forEach(s=> s.onclick=()=>{ profileUser={username:s.dataset.user}; switchView('profile'); });
}
function renderTrending(){
  const counts={};
  posts.forEach(p=> counts[p.mood]=(counts[p.mood]||0)+1);
  const top=Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  $('#trending').innerHTML = top.length ? top.map(([m,c])=>`<div class="trend-item"><span>${esc(m)} Mood</span><b>${c} posts</b></div>`).join('') : '<p class="muted">No posts yet</p>';
}

/* ---------- PEOPLE ---------- */
async function loadPeople(silent){
  try{ users = await api('/api/users'); renderPeople(); renderStories(); renderOnline(); }catch(e){ if(!silent) toast(e.message); }
}
function renderPeople(){
  const el=$('#peopleList');
  if(!users.length){ el.innerHTML='<div class="empty">No other people yet. Invite friends! 💧</div>'; return; }
  el.innerHTML = users.map(u=>`<div class="card person-card">
    ${avatarHtml(u,'lg')}
    <div class="name">${esc(u.displayName)}</div><div class="uname">@${esc(u.username)}</div>
    <p class="bio">${esc(u.bio||'New to Splash 💧')}</p>
    <div style="display:flex;gap:8px;justify-content:center">
      <button class="btn-follow ${u.following?'following':''}" data-follow="${esc(u.username)}">${u.following?'✓ Following':'＋ Follow'}</button>
      <button class="btn-follow" data-dm="${u.id}">💬 Chat</button>
    </div></div>`).join('');
  el.querySelectorAll('[data-follow]').forEach(b=> b.onclick=async()=>{
    try{ const r=await api(`/api/users/${b.dataset.follow}/follow`,{method:'POST'}); toast(r.following?'Following! 💧':'Unfollowed'); loadPeople(); }catch(e){toast(e.message);}
  });
  el.querySelectorAll('[data-dm]').forEach(b=> b.onclick=()=>{ openDm(b.dataset.dm); });
}
function openDm(otherId){
  activeRoom = 'dm:' + [me.id, otherId].sort().join(':');
  switchView('chat'); loadMessages(); loadChats();
}

/* ---------- PROFILE ---------- */
async function loadProfile(username){
  try{
    const data = await api('/api/users/'+encodeURIComponent(username));
    const isMe = data.isMe;
    $('#profileContent').innerHTML = `
      <div class="card">
        <div class="profile-head">${avatarHtml(data,'lg')}
          <div><h2>${esc(data.displayName)}</h2><div class="muted">@${esc(data.username)} · joined ${new Date(data.createdAt).toLocaleDateString()}</div>
          <div class="profile-stats">
            <div><b>${data.posts.length}</b><span>Posts</span></div>
            <div><b>${data.followers}</b><span>Followers</span></div>
            <div><b>${data.following}</b><span>Following</span></div>
          </div></div>
          ${!isMe?`<button class="btn-follow ${data.isFollowing?'following':''}" id="profileFollow" style="margin-left:auto">${data.isFollowing?'✓ Following':'＋ Follow'}</button>`:''}
        </div>
        <p>${esc(data.bio||'No bio yet.')}</p>
        ${isMe?`<form class="edit-form" id="editForm">
          <div class="row"><input id="editName" value="${esc(data.displayName)}" maxlength="40" placeholder="Display name">
          <input id="editBio" value="${esc(data.bio||'')}" maxlength="160" placeholder="Bio"></div>
          <div class="row"><span>Avatar:</span><div id="editAvatar" class="emoji-picker"></div>
          <span>Color:</span><div id="editColor" class="color-picker"></div>
          <button class="btn-primary" type="submit" style="margin-left:auto">Save</button></div>
        </form>`:''}
      </div>
      <h3 style="margin:16px 0 10px">Posts</h3>
      <div id="profilePosts">${data.posts.length? data.posts.map(postHtml).join('') : '<div class="empty">No posts yet 💧</div>'}</div>`;
    // wire profile posts
    const wrap=$('#profilePosts');
    wrap.querySelectorAll('[data-like]').forEach(b=> b.onclick=()=>likePost(b.dataset.like));
    wrap.querySelectorAll('[data-del-post]').forEach(b=> b.onclick=async()=>{ await deletePost(b.dataset.delPost); loadProfile(username); });
    wrap.querySelectorAll('[data-toggle-comments]').forEach(b=> b.onclick=()=> $('#comments-'+b.dataset.toggleComments)?.classList.toggle('hidden'));
    wrap.querySelectorAll('.comment-form').forEach(f=> f.onsubmit=e=>{e.preventDefault(); submitComment(f.dataset.post, f.querySelector('input').value);});
    const pf=$('#profileFollow'); if(pf) pf.onclick=async()=>{ await api(`/api/users/${username}/follow`,{method:'POST'}); loadProfile(username); };
    const ef=$('#editForm');
    if(ef){
      let ea=me.avatar, ec=me.color;
      $('#editAvatar').innerHTML=AVATARS.map(a=>`<button type="button" data-a="${a}" class="${a===ea?'sel':''}">${a}</button>`).join('');
      $('#editAvatar').onclick=e=>{const b=e.target.closest('button'); if(!b)return; ea=b.dataset.a; $$('#editAvatar button').forEach(x=>x.classList.toggle('sel',x===b));};
      $('#editColor').innerHTML=COLORS.map(c=>`<button type="button" data-c="${c}" style="background:${c}" class="${c===ec?'sel':''}"></button>`).join('');
      $('#editColor').onclick=e=>{const b=e.target.closest('button'); if(!b)return; ec=b.dataset.c; $$('#editColor button').forEach(x=>x.classList.toggle('sel',x===b));};
      ef.onsubmit=async e=>{ e.preventDefault();
        me = await api('/api/me',{method:'PATCH', body:JSON.stringify({displayName:$('#editName').value, bio:$('#editBio').value, avatar:ea, color:ec})});
        $('#meName').textContent=me.displayName; toast('Profile updated ✓'); loadProfile(username); loadAll();
      };
    }
  }catch(e){ $('#profileContent').innerHTML=`<div class="empty">${esc(e.message)}</div>`; }
}

/* ---------- CHAT ---------- */
async function loadChats(){
  try{ chats = await api('/api/chats'); renderChatList(); }catch{}
}
function roomTitle(){
  if(activeRoom==='global') return '🌍 Global Chat';
  const otherId = activeRoom.slice(3).split(':').find(id=>id!==me.id);
  const u = users.find(x=>x.id===otherId) || chats.find(c=>c.user.id===otherId)?.user;
  return u ? `${esc(u.avatar)} ${esc(u.displayName)}` : '💬 Chat';
}
function renderChatList(){
  const el=$('#chatListItems');
  const globalActive = activeRoom==='global' ? 'active':'';
  let html = `<button class="chat-item ${globalActive}" data-room="global"><span class="avatar" style="background:#06b6d433;border:2px solid #06b6d4">🌍</span><span><div class="name">Global Chat</div><div class="preview">Everyone is here</div></span></button>`;
  html += chats.map(c=>`<button class="chat-item ${activeRoom===c.room?'active':''}" data-room="${c.room}">${avatarHtml(c.user)}<span><div class="name">${esc(c.user.displayName)}</div><div class="preview">${esc(c.lastMessage.text)}</div></span></button>`).join('');
  // also list all users as new DM options
  html += users.map(u=>{ const room='dm:'+[me.id,u.id].sort().join(':'); if(chats.some(c=>c.room===room)) return '';
    return `<button class="chat-item ${activeRoom===room?'active':''}" data-room="${room}">${avatarHtml(u)}<span><div class="name">${esc(u.displayName)}</div><div class="preview">Start a chat...</div></span></button>`; }).join('');
  el.innerHTML = html;
  el.querySelectorAll('[data-room]').forEach(b=> b.onclick=()=>{ activeRoom=b.dataset.room; renderChatList(); loadMessages(); });
  $('#chatTitle').textContent = roomTitle();
}
async function loadMessages(){
  try{
    messages = await api('/api/messages?room='+encodeURIComponent(activeRoom));
    renderMessages();
    $('#chatTitle').textContent = roomTitle();
  }catch(e){ toast(e.message); }
}
function renderMessages(){
  const el=$('#messages');
  if(!messages.length){ el.innerHTML='<div class="empty">No messages yet. Say hi! 👋</div>'; return; }
  el.innerHTML = messages.map(m=>{
    const mine = me && m.userId===me.id;
    return `<div class="msg-row ${mine?'mine':''}" id="msg-${m.id}">${avatarHtml(m.author)}
      <div><div class="bubble">${esc(m.text)}<span class="meta">${esc(m.author?.displayName||'')} · ${timeAgo(m.createdAt)}</span></div></div>
      ${mine?`<button class="msg-del" data-del-msg="${m.id}">delete</button>`:''}</div>`;
  }).join('');
  el.querySelectorAll('[data-del-msg]').forEach(b=> b.onclick=async()=>{
    try{ await api(`/api/messages/${b.dataset.delMsg}`,{method:'DELETE'}); messages=messages.filter(m=>m.id!==b.dataset.delMsg); renderMessages(); loadChats(); }catch(e){toast(e.message);}
  });
  el.scrollTop = el.scrollHeight;
}
$('#msgForm').onsubmit = async e=>{
  e.preventDefault();
  const text = $('#msgInput').value.trim(); if(!text) return;
  $('#msgInput').value='';
  try{
    const m = await api('/api/messages',{method:'POST', body:JSON.stringify({room:activeRoom, text})});
    messages.push(m); renderMessages(); loadChats();
  }catch(err){ toast(err.message); }
};
$('#msgInput').addEventListener('input', ()=>{
  if(socket) socket.emit('typing',{room:activeRoom});
});

/* ---------- ONLINE / NOTIFICATIONS ---------- */
async function loadOnline(){
  try{ const ids = await api('/api/online'); onlineSet = new Set(ids); renderOnline(); }catch{}
}
function renderOnline(){
  const all = [me, ...users].filter(Boolean);
  const uniq = [...new Map(all.map(u=>[u.id,u])).values()];
  $('#onlineList').innerHTML = uniq.slice(0,8).map(u=>`
    <div class="online-item" data-user="${esc(u.username)}"><span class="dot ${onlineSet.has(u.id)?'':'off'}"></span>${esc(u.displayName)}</div>`).join('') || '<p class="muted">No one online</p>';
  $$('#onlineList .online-item').forEach(el=> el.onclick=()=>{ profileUser={username:el.dataset.user}; switchView('profile'); });
}
async function loadNotifications(){
  try{ notifications = await api('/api/notifications'); updateBadges(); renderNotifs(); }catch{}
}
function renderNotifs(){
  const el=$('#notifPanel');
  el.innerHTML = `<h4 style="padding:8px">Notifications</h4>` + (notifications.length
    ? notifications.map(n=>`<div class="notif-item ${n.read?'':'unread'}">${esc(n.text)}<div class="time">${timeAgo(n.createdAt)}</div></div>`).join('')
    : '<div class="notif-item muted">No notifications yet</div>');
}
$('#bellBtn').onclick = async ()=>{
  const p=$('#notifPanel'); p.classList.toggle('hidden');
  if(!p.classList.contains('hidden')){ await api('/api/notifications/read',{method:'POST'}).catch(()=>{}); notifications.forEach(n=>n.read=true); updateBadges(); renderNotifs(); }
};
function updateBadges(){
  const unread = notifications.filter(n=>!n.read).length;
  const bb=$('#bellBadge'); bb.textContent=unread; bb.classList.toggle('hidden', !unread);
  const cb=$('#chatBadge'); cb.textContent=unreadChat; cb.classList.toggle('hidden', !unreadChat);
}

/* ---------- SEARCH ---------- */
let searchTimer;
$('#globalSearch').addEventListener('input', e=>{
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>{ searchQ=e.target.value.trim(); if(activeView!=='feed') switchView('feed'); loadPosts(); },300);
});

/* ---------- SOCKET ---------- */
function connectSocket(){
  socket = io();
  socket.on('connect', ()=> socket.emit('join', token));
  socket.on('post:new', p=>{ posts.unshift(p); if(activeView==='feed') renderFeed(); renderTrending(); });
  socket.on('post:like', ({id, likes, likeCount})=>{ const p=posts.find(x=>x.id===id); if(p){ p.likes=likes; p.likeCount=likeCount; p.likedByMe=likes.includes(me.id);} if(activeView==='feed') renderFeed(); });
  socket.on('post:comment', ({postId, comment, commentCount})=>{ const p=posts.find(x=>x.id===postId); if(p){ p.comments.push(comment); p.commentCount=commentCount; } if(activeView==='feed') renderFeed(); });
  socket.on('post:comment:delete', ({postId, commentId, commentCount})=>{ const p=posts.find(x=>x.id===postId); if(p){ p.comments=p.comments.filter(c=>c.id!==commentId); p.commentCount=commentCount; } if(activeView==='feed') renderFeed(); });
  socket.on('post:delete', ({id})=>{ posts=posts.filter(p=>p.id!==id); if(activeView==='feed') renderFeed(); });
  socket.on('message:new', m=>{
    if(m.room===activeRoom){ messages.push(m); renderMessages(); }
    else { unreadChat++; updateBadges(); }
    loadChats();
  });
  socket.on('message:delete', ({id})=>{ messages=messages.filter(m=>m.id!==id); renderMessages(); loadChats(); });
  socket.on('message:typing', ({room, displayName})=>{
    if(room!==activeRoom) return;
    $('#typingBar').textContent = displayName+' is typing...';
    clearTimeout(typingTimer); typingTimer=setTimeout(()=> $('#typingBar').textContent='', 2500);
  });
  socket.on('presence', ({userId, online})=>{ online?onlineSet.add(userId):onlineSet.delete(userId); renderOnline(); });
  socket.on('notification:new', n=>{ notifications.unshift(n); updateBadges(); renderNotifs(); });
}

/* ---------- INIT ---------- */
(async ()=>{
  if(token){
    try{ me = await api('/api/me'); enterApp(); return; }
    catch{ token=null; localStorage.removeItem('splash_token'); }
  }
})();
