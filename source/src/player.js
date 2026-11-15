// ===== App shell: the start screen, and the player app =====
// Player flow: your details (name + email) -> Home: the best bar right now (closest, shortest wait), scan a QR code,
// your rating and games -> a bar's page -> join its queue -> Home shows your place, the wait and the live game ->
// called (3-minute timer, plus an email) -> in a game (ask the referee, flag a foul) -> result (new rating, rank,
// play again or stop). After the first game the player makes an account with a password to keep playing.
// The address picks the app: #play (also #mobile, which the bar's QR code and the emails open) for players,
// #bar for bars, #tv for the bar TV. A first visit with no address shows the start screen.
// Like business.js, this file only uses the page helpers ($, esc, act, S, ...) inside functions.
var PAPP = { tab: 'home', bar: null, from: 'list', ev: null, joinFor: null, invite: null, acct: null, login: false, geo: null, geoAsked: false, scan: null, sig: {} };
var APP_ICONS = {
  play: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="11" cy="11" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M11 8.6v4.8" stroke="currentColor" stroke-width="1.4"/></svg>',
  bars: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M11 20s6.5-6 6.5-11a6.5 6.5 0 0 0-13 0c0 5 6.5 11 6.5 11Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="11" cy="9" r="2.4" fill="currentColor"/></svg>',
  ranks: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M3 19h16M5.5 19v-6h3v6M9.5 19V7h3v12M13.5 19v-9h3v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  me: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="7.5" r="3.8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19.5c.8-4 3.8-6 7.5-6s6.7 2 7.5 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  star: '<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="m11 2.8 2.5 5.2 5.7.8-4.1 4 1 5.6L11 15.7l-5.1 2.7 1-5.6-4.1-4 5.7-.8Z" fill="var(--fill,none)" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>',
  qr: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M2 7V2h5M13 2h5v5M18 13v5h-5M7 18H2v-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><rect x="6" y="6" width="8" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
};
const backBtn = (act, label) => `<button class="backbtn" data-act="${act}"><span aria-hidden="true">${ICON.back}</span>${esc(label)}</button>`;

// ---------- which app the address asks for ----------
function shellRoute(h) {
  document.body.classList.toggle('served', servedByN8n);
  const view = shellView(h); document.body.dataset.app = view; return view;
}
function shellView(h) {
  if (h === 'tv' || h === 'live') return 'live';
  const hp = hashParts();
  if (hp.invite) PAPP.invite = hp.invite;
  if (hp.bar) { PAPP.tab = 'bars'; PAPP.bar = hp.bar; PAPP.from = 'home'; PAPP.ev = null; PAPP.joinFor = null; PAPP.sig = {}; }   // a scanned QR code opens that bar's page
  let role = null;
  if (['play', 'mobile', 'phone', 'player'].includes(h)) role = 'player';
  else if (['bar', 'venue', 'counter', 'business', 'camera'].includes(h)) role = 'biz';
  if (role) { store.set('role', role); return role; }
  const saved = store.get('role', null);
  return saved === 'player' || saved === 'biz' ? saved : 'start';
}
function goRole(role) {
  store.set('role', role);
  PAPP.tab = 'home'; PAPP.bar = null; PAPP.ev = null; PAPP.joinFor = null; PAPP.acct = null; PAPP.sig = {};   // land on the main page
  if (typeof BAPP !== 'undefined') { BAPP.screen = 'home'; BAPP.editing = false; BAPP.sig = {}; }
  if (S.sigs) S.sigs.clear(); const h = role === 'biz' ? '#bar' : role === 'player' ? '#play' : ''; if (location.hash === h || (!h && !location.hash)) route(); else location.hash = h; }

// ---------- the player's profile: name + email, kept on this phone; a password once they've played a game ----------
function playerProfile() { return store.get('player', null) || PAPP.mem || null; }
function savePlayerProfile(p) { PAPP.mem = p; store.set('player', p); }
function favs() { return store.get('favs', null) || PAPP.favMem || []; }
function setFavs(list) { PAPP.favMem = list; store.set('favs', list); }
const validEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
async function hashPassword(email, pw) {           // the password never leaves the phone; n8n stores this hash
  const text = 'loopool|' + email.trim().toLowerCase() + '|' + pw;
  try { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)); return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join(''); }
  catch (e) { let h = 2166136261, out = ''; for (let r = 0; r < 4; r++) { for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i) + r; h = Math.imul(h, 16777619); } out += (h >>> 0).toString(16).padStart(8, '0'); } return out + out; }
}
function needsAccount(st) { const P = playerProfile(); return !!(P && !P.account && st.my && (st.my.w + st.my.l) >= 1); }

// ---------- bars, distance and the wait ----------
function bars(st) {
  const v = st.venue || {};
  const list = v.setup ? [Object.assign({}, v, { id: 'home', home: true, events: st.events || [] })] : [];
  return list.concat(st.directory || []);
}
function mapsLink(b) { return b.mapsUrl || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([b.name, b.address].filter(Boolean).join(' ')); }
function distKm(b) {
  if (!PAPP.geo || b.lat == null || b.lng == null) return null;
  const R = 6371, rad = x => x * Math.PI / 180, dLat = rad(b.lat - PAPP.geo.lat), dLng = rad(b.lng - PAPP.geo.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(PAPP.geo.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
function distText(b) { const d = distKm(b); return d == null ? '' : d < 1 ? Math.round(d * 1000 / 10) * 10 + ' m away' : (d < 10 ? d.toFixed(1) : Math.round(d)) + ' km away'; }
function askLocation() {
  if (PAPP.geoAsked || !navigator.geolocation) return; PAPP.geoAsked = true;
  navigator.geolocation.getCurrentPosition(p => { PAPP.geo = { lat: p.coords.latitude, lng: p.coords.longitude }; PAPP.sig = {}; render(); }, () => { /* no location: no distances */ }, { timeout: 8000, maximumAge: 600000 });
}
function waitText(st) {                                       // a rough wait for someone joining now, from the live board
  const free = st.tables.filter(t => t.status === 'empty' || (t.status === 'waiting' && !t.challenger)).length;
  if (free && !st.queue.length) return 'A table is free now';
  const lefts = st.tables.map(t => t.game && t.game.left).filter(x => x != null);
  const soonest = lefts.length ? Math.min(...lefts) : 12;
  const min = Math.max(1, Math.round(soonest + Math.floor(st.queue.length / Math.max(1, st.tables.length)) * 13));
  return 'About ' + min + ' min wait · ' + st.queue.length + ' in line';
}
function barTodayLine(b, st) { if (b.home && b.open === false) return 'Closed right now'; return bizToday(b, st.now) || ''; }

// ---------- render ----------
function renderPlayerApp(st) {
  const P = playerProfile(), root = $('#v-player');
  $$('[data-ico]', root).forEach(i => { if (!i.innerHTML) i.innerHTML = APP_ICONS[i.dataset.ico]; });
  if (P && (!S.draft.name || S.draft.name === 'Alex' || S.draft.name !== P.name)) { S.draft.name = P.name; S.draft.email = P.email || ''; }
  const tab = P ? PAPP.tab : 'welcome';
  $('.papp-tabs', root).hidden = !P;
  $$('[data-act="ptab"]', root).forEach(b => b.setAttribute('aria-current', b.dataset.v === tab ? 'page' : 'false'));
  $$('[data-pt]', root).forEach(el => { el.hidden = el.dataset.pt !== tab; });
  const el = $('[data-pt="' + tab + '"]', root);
  if (tab === 'welcome') renderWelcome(el, st);
  else if (tab === 'home') renderHome(el, st);
  else if (tab === 'bars') renderBarsTab(el, st);
  else if (tab === 'ranks') renderRanksTab(el, st);
  else if (tab === 'me') renderMeTab(el, st);
}

// Step 1: your details (or log in)
function renderWelcome(el, st) {
  const sig = 'w' + PAPP.login; if (PAPP.sig.welcome === sig) return; PAPP.sig.welcome = sig;
  el.innerHTML = `<div class="ph">
    ${backBtn('p-tostart', 'Back')}
    <div style="display:flex;flex-direction:column;gap:8px"><h1 class="h1">${PAPP.login ? 'Welcome back' : 'Your details'}</h1>
      <p class="lede">${PAPP.login ? 'Log in with the email and password you play with.' : 'Your name goes on the queue board and leaderboard. We email you when your table is ready.'}</p></div>
    <form class="mform" id="welForm" novalidate>
      ${PAPP.login ? '' : '<div class="field"><label for="wName">Name</label><input id="wName" type="text" maxlength="24" placeholder="First name or nickname" autocomplete="nickname" required></div>'}
      <div class="field"><label for="wEmail">Email</label><input id="wEmail" type="email" placeholder="you@example.com" autocomplete="email" inputmode="email" required></div>
      ${PAPP.login ? '<div class="field"><label for="wPw">Password</label><input id="wPw" type="password" autocomplete="current-password" required></div>' : ''}
      <p class="formerr" role="alert" data-err></p>
      <button class="cta" type="submit">${PAPP.login ? 'Log in' : 'Continue'}</button>
    </form>
    <button class="linkbtn" data-act="p-loginswap">${PAPP.login ? 'New here? Enter your details instead' : 'Already have an account? Log in'}</button>
  </div>`;
  $('#welForm', el).addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('[data-err]', el), email = $('#wEmail', el).value.trim();
    if (!validEmail(email)) { err.textContent = 'Enter a valid email so we can tell you when your table is ready.'; return; }
    if (PAPP.login) {
      const pw = $('#wPw', el).value; if (pw.length < 6) { err.textContent = 'Passwords have at least 6 characters.'; return; }
      const hash = await hashPassword(email, pw), r = await act('account_login', { email, hash }, true);
      if (!r || !r.ok) { err.textContent = (r && r.error) || 'Couldn’t log in right now.'; return; }
      savePlayerProfile({ name: r.account.name, email: r.account.email, hash, account: true });
    } else {
      const name = $('#wName', el).value.trim().slice(0, 24);
      if (!name) { err.textContent = 'Add your name.'; return; }
      savePlayerProfile({ name, email });
    }
    PAPP.sig = {}; S.sigs.clear(); toast('Hi ' + playerProfile().name + '!'); render(); window.scrollTo(0, 0);
  });
}

// Home: the game you're in, or the best bar right now, scan a QR code, your stats
function renderHome(el, st) {
  const me = st.me, scr = phoneScreen(st);
  const active = !!me && me.status !== 'left' && scr !== 'landing' && scr !== 'join';
  const home = $('[data-home]', el), phone = $('[data-phone]', el), watch = $('[data-watch]', el);
  const showInv = PAPP.invite && !active;
  $('[data-invite]', el).innerHTML = showInv ? `<div class="invite"><b>${esc(PAPP.invite)} invited you to play</b><span>Join the queue at ${esc(st.venue.name)} and look for them at the table.</span><button class="quiet" data-act="p-invclose" aria-label="Dismiss">×</button></div>` : '';
  if (PAPP.acct) { phone.hidden = true; watch.hidden = true; renderAccountSheet(home, st); return; }
  if (active) {
    home.innerHTML = ''; PAPP.sig.home = null;
    phone.hidden = false; renderPhone(phone, st, 'player');
    const w = ['queue', 'seated', 'called'].includes(scr);
    watch.hidden = !w; if (w) renderTV($('[data-tv]', watch), st, 'pwatch');
    return;
  }
  phone.hidden = true; watch.hidden = true;
  askLocation();
  const P = playerProfile(), my = st.my;
  const sig = JSON.stringify([P, my, st.venue, st.directory && st.directory.length, waitText(st), PAPP.geo, needsAccount(st)]);
  if (PAPP.sig.home === sig) return; PAPP.sig.home = sig;
  const live = bars(st).filter(b => b.home && b.open !== false);
  const best = live.sort((a, b) => (distKm(a) || 0) - (distKm(b) || 0))[0];
  const others = bars(st).length - (best ? 1 : 0);
  const games = my && my.games.length ? my.games.map(g => `<div><span><b>${g.won ? 'Won' : 'Lost'}</b> vs ${esc(g.opponent)}</span><small>${esc(g.table)}${g.rated ? ' · ' + (g.won ? '+' : '−') + Math.abs(g.delta) : ''} · ${fmtTime(g.at)}</small></div>`).join('') : '';
  home.innerHTML = `<div class="ph">
    ${topBar(`<span class="dim" style="font-size:14px">Hi ${esc(P.name)}</span>`)}
    ${needsAccount(st) ? `<div class="notice"><b>Make your account to keep playing</b><span>You’ve played your first game. Add a password so your rating stays yours.</span><button class="b go" data-act="p-acct">Create account</button></div>` : ''}
    ${best ? `<section class="bestbar"><span class="label">Best table near you</span>
        <h1 class="h1">${esc(best.name)}</h1>
        <p class="lede">${esc([distText(best), waitText(st)].filter(Boolean).join(' · '))}</p>
        <div class="two"><button class="cta" data-act="p-join" data-id="home">Join the queue</button><button class="cta line" data-act="p-bar" data-id="home" data-from="home">See the bar</button></div>
      </section>` : `<section class="bestbar"><span class="label">Right now</span><h1 class="h1">No bars are<br>open nearby</h1><p class="lede">Check the bars list for opening hours and events.</p></section>`}
    <div class="two"><button class="quiet" data-act="p-scan">${APP_ICONS.qr}Scan a QR code</button><button class="quiet" data-act="ptab" data-v="bars">See ${others > 0 ? others + ' other' : 'all'} bars</button></div>
    <section class="barsec"><span class="label">Your stats</span>
      ${my ? `<div class="stats three"><div class="stat"><b>${my.rating}</b><span>Elo rating</span></div><div class="stat"><b>#${my.rank}</b><span>of ${my.of} players</span></div><div class="stat"><b>${my.w}–${my.l}</b><span>won–lost</span></div></div>` : '<p class="lede" style="font-size:14px">Everyone starts at 1200. Play a rated game on a camera table to get your rating.</p>'}
    </section>
    <section class="barsec"><span class="label">Your games</span>${games ? `<div class="results">${games}</div>` : '<p class="lede" style="font-size:14px">No games yet. Join a queue to play your first.</p>'}</section>
  </div>`;
}

// The account sheet: after the first game (or from Me)
function renderAccountSheet(el, st) {
  const P = playerProfile(), sig = 'a' + PAPP.login + JSON.stringify(PAPP.acct);
  if (PAPP.sig.home === sig) return; PAPP.sig.home = sig;
  el.innerHTML = `<div class="ph">
    ${backBtn('p-acctback', 'Back')}
    <div style="display:flex;flex-direction:column;gap:8px"><h1 class="h1">${PAPP.login ? 'Log in' : 'Create your<br>account'}</h1>
      <p class="lede">${PAPP.login ? 'There’s already an account for ' + esc(P.email) + '.' : 'You’ve played a game, so your rating is on the board. Add a password so it stays yours and you can keep playing.'}</p></div>
    <form class="mform" id="acctForm" novalidate>
      ${PAPP.login ? '' : `<div class="field"><label for="aName">Name</label><input id="aName" type="text" maxlength="24" value="${esc(P.name)}" required></div>`}
      <div class="field"><label for="aEmail">Email</label><input id="aEmail" type="email" value="${esc(P.email)}" required></div>
      <div class="field"><label for="aPw">Password</label><input id="aPw" type="password" autocomplete="${PAPP.login ? 'current-password' : 'new-password'}" required><small>At least 6 characters.</small></div>
      <p class="formerr" role="alert" data-err></p>
      <button class="cta" type="submit">${PAPP.login ? 'Log in' : 'Create account'}${PAPP.acct && PAPP.acct.then === 'join' ? ' and join' : ''}</button>
    </form></div>`;
  $('#acctForm', el).addEventListener('submit', async e => {
    e.preventDefault();
    const err = $('[data-err]', el), email = $('#aEmail', el).value.trim(), pw = $('#aPw', el).value;
    const name = PAPP.login ? P.name : $('#aName', el).value.trim().slice(0, 24);
    if (!name) { err.textContent = 'Add your name.'; return; }
    if (!validEmail(email)) { err.textContent = 'Enter a valid email.'; return; }
    if (pw.length < 6) { err.textContent = 'Use at least 6 characters.'; return; }
    const hash = await hashPassword(email, pw);
    const r = await act(PAPP.login ? 'account_login' : 'account_create', { name, email, hash }, true);
    if (!r || !r.ok) { if (r && r.code === 409) { PAPP.login = true; PAPP.sig = {}; render(); return; } err.textContent = (r && r.error) || 'Couldn’t save that right now.'; return; }
    savePlayerProfile({ name: r.account.name, email: r.account.email, hash, account: true });
    const then = PAPP.acct && PAPP.acct.then; PAPP.acct = null; PAPP.login = false; PAPP.sig = {};
    toast(r.account && !PAPP.login ? 'Your account is ready.' : 'Logged in.');
    if (then === 'join') await doJoin(PAPP.acctJoin || {}); else render();
  });
}

// ---------- joining a queue (from Home, a bar's page or "play again") ----------
async function doJoin(o) {
  const st = S.state, P = playerProfile();
  if (!P) return;
  if (needsAccount(st)) { PAPP.acct = { then: 'join' }; PAPP.acctJoin = o; PAPP.login = false; PAPP.tab = 'home'; PAPP.sig = {}; render(); window.scrollTo(0, 0); return; }
  S.ticket = null;
  const r = await act('join', { name: P.name, email: P.email, hash: P.hash || undefined, gameType: o.gameType || '8-ball', refOnly: !!o.refOnly && (o.gameType || '8-ball') === '8-ball' }, true);
  if (!r || !r.ok) {
    if (r && r.code === 401) { PAPP.acct = { then: 'join' }; PAPP.acctJoin = o; PAPP.login = true; PAPP.tab = 'home'; PAPP.sig = {}; render(); return; }
    toast((r && r.error) || 'Couldn’t join right now. Try again.'); return;
  }
  PAPP.tab = 'home'; PAPP.bar = null; PAPP.joinFor = null; PAPP.invite = null; PAPP.sig = {}; S.sigs.clear();
  toast(r.me && r.me.position ? 'You’re #' + r.me.position + ' in line.' : 'You’re on the board.');
  render(); window.scrollTo(0, 0);
}
function playerRejoin() { const me = S.state && S.state.me; doJoin({ gameType: (me && me.gameType) || '8-ball', refOnly: !!(me && me.refOnly) }); }

// ---------- Bars: favourites, every bar's page, live tables, joining, events ----------
function renderBarsTab(el, st) {
  const sig = JSON.stringify([PAPP.bar, PAPP.ev, PAPP.joinFor, PAPP.joinPick, favs(), PAPP.geo, st.venue, st.events, st.directory, st.tables.map(t => [t.status, t.champ && t.champ.name, t.challenger && t.challenger.name, t.game && t.game.minutes]), st.queue.length, st.me && st.me.name]);
  if (PAPP.sig.bars === sig) return; PAPP.sig.bars = sig;
  const all = bars(st);
  if (PAPP.ev) { el.innerHTML = '<div class="ph">' + playerEventHTML(st) + '</div>'; return; }
  const b = PAPP.bar && all.find(x => x.id === PAPP.bar);
  if (b) { el.innerHTML = '<div class="ph">' + barPageHTML(b, st) + '</div>'; return; }
  if (PAPP.bar) { PAPP.bar = null; }
  const F = favs(), row = x => {
    const fav = F.includes(x.id);
    const live = x.home ? (x.open === false ? 'Closed right now' : waitText(st)) : (x.events && x.events.length ? x.events.length + ' event' + (x.events.length > 1 ? 's' : '') + ' coming up' : '');
    return `<div class="barrow"><button class="barrow-main" data-act="p-bar" data-id="${esc(x.id)}" data-from="list"><b>${esc(x.name)}</b><small>${esc([distText(x), barTodayLine(x, st)].filter(Boolean).join(' · '))}</small><small>${esc(x.address || '')}</small>${live ? `<small class="live">${esc(live)}</small>` : ''}</button>
      <button class="starbtn${fav ? ' on' : ''}" data-act="p-fav" data-id="${esc(x.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Remove ' + esc(x.name) + ' from favourites' : 'Add ' + esc(x.name) + ' to favourites'}">${APP_ICONS.star}</button></div>`;
  };
  const byDist = (a, b) => (distKm(a) == null ? 1e9 : distKm(a)) - (distKm(b) == null ? 1e9 : distKm(b));
  const favList = all.filter(x => F.includes(x.id)).sort(byDist), rest = all.filter(x => !F.includes(x.id)).sort(byDist);
  el.innerHTML = `<div class="ph">
    ${backBtn('ptab" data-v="home', 'Home')}
    <h1 class="h1">Bars</h1>
    <p class="lede">${PAPP.geo ? 'Closest first. ' : ''}Star the bars you go to most. Tap a bar for its tables, events and hours.</p>
    ${favList.length ? `<section class="barlist"><span class="label">Your favourites</span>${favList.map(row).join('')}</section>` : ''}
    <section class="barlist"><span class="label">${favList.length ? 'More bars' : 'Bars on Loopool'}</span>${rest.map(row).join('') || '<p class="lede">No bars yet.</p>'}</section>
  </div>`;
}
function barPageHTML(b, st) {
  const fav = favs().includes(b.id), open = b.home && b.open !== false;
  const facts = [b.tableCount ? [b.tableCount, (b.tableBrand ? b.tableBrand + ' ' : '') + 'tables' + (b.tableSize ? ', ' + b.tableSize : '')] : null, b.cues ? [b.cues, 'house cues'] : null].filter(Boolean);
  const todayKey = BIZ_DAYS[(new Date(st.now).getDay() + 6) % 7][0];
  const hours = b.hours ? BIZ_DAYS.map(([d, name]) => { const h = b.hours[d] || {}; return `<div class="${d === todayKey ? 'today' : ''}"><span>${name}</span><span>${h.closed ? 'Closed' : bizTime(h.open) + ' – ' + bizTime(h.close)}</span></div>`; }).join('') : '';
  const evs = (b.events || []).map(e => `<button class="biz-prow" data-act="p-ev" data-id="${esc(e.id)}"><span class="when"><b>${esc(bizDay(e.date).split(' ')[0])}</b><small>${esc(bizDay(e.date).split(' ').slice(1).join(' '))}</small></span><span style="min-width:0;text-align:left"><b>${esc(e.title)}${e.live ? ' <span class="badge">On now</span>' : ''}</b><small>${esc(bizTime(e.time))} · ${esc(e.fee || BIZ_KINDS[e.kind] || '')} · ${e.count}${e.cap ? '/' + e.cap : ''} going</small></span><span class="go">${b.home ? 'Sign up' : 'Details'}</span></button>`).join('');
  const pick = PAPP.joinPick || { gameType: '8-ball', refOnly: false }, nine = pick.gameType !== '8-ball';
  const joinBox = !b.home ? `<p class="lede" style="font-size:14px">This bar’s live queue isn’t connected in this demo. Scan the QR code on its TV when you get there.</p>`
    : !open ? '<p class="lede">Closed right now. The queue opens when the bar starts its night.</p>'
    : PAPP.joinFor === b.id ? `<section class="joinbox"><span class="label">Join the queue as ${esc(playerProfile().name)}</span>
        <div class="seg"><button type="button" data-act="p-pick" data-v="8-ball" aria-pressed="${!nine}">8-BALL</button><button type="button" data-act="p-pick" data-v="9-ball" aria-pressed="${nine}">9-BALL</button></div>
        <label class="switch" for="jRef2"><span><b>Camera table only</b><small>${nine ? 'The camera referee supports 8-ball for now.' : 'Rated game on Table 1, fouls called by the camera. The wait can be longer.'}</small></span><span class="knob"><input id="jRef2" type="checkbox" ${pick.refOnly && !nine ? 'checked' : ''} ${nine ? 'disabled' : ''} data-act="p-pickref"><i></i></span></label>
        <button class="cta" data-act="p-joinnow">Join the queue</button><button class="quiet" data-act="p-joincancel">Not now</button></section>`
    : `<button class="cta" data-act="p-join" data-id="${esc(b.id)}">Join the queue</button>`;
  const live = b.home && open ? `<section class="barsec"><span class="label">Tables right now · ${esc(waitText(st))}</span><div class="rows">${st.tables.map((t, i) => `<div class="row"><span class="n${t.ref ? ' ref' : ''}">${i + 1}</span><div style="min-width:0"><b>${t.game || t.status === 'checkin' ? esc(t.champ.name) + ' vs ' + esc(t.challenger ? t.challenger.name : '…') : t.champ ? esc(t.champ.name) + ' needs a challenger' : 'Free'}</b><small>${t.gameType}${t.ref ? ' · camera referee · rated' : ''}</small></div><span class="t">${t.game ? t.game.minutes + ' min' : ''}</span></div>`).join('')}</div></section>` : '';
  return `<div class="ph-top" style="justify-content:space-between">${backBtn('p-back', PAPP.from === 'home' ? 'Home' : 'All bars')}
      <button class="starbtn${fav ? ' on' : ''}" data-act="p-fav" data-id="${esc(b.id)}" aria-pressed="${fav}" aria-label="${fav ? 'Remove from favourites' : 'Add to favourites'}">${APP_ICONS.star}</button></div>
    <div style="display:flex;flex-direction:column;gap:8px"><h1 class="h1">${esc(b.name)}</h1>
      <p class="lede">${esc([distText(b), barTodayLine(b, st)].filter(Boolean).join(' · '))}</p>
      ${b.address ? `<p class="lede" style="font-size:14px">${esc(b.address)}</p>` : ''}
      <p style="display:flex;gap:16px;flex-wrap:wrap"><a href="${esc(mapsLink(b))}" target="_blank" rel="noopener">Directions</a>${b.phone ? `<a href="tel:${esc(b.phone.replace(/[^+\d]/g, ''))}">Call</a>` : ''}${b.website ? `<a href="${esc(b.website)}" target="_blank" rel="noopener">Website</a>` : ''}</p></div>
    ${joinBox}
    ${b.about ? `<p style="font-size:15px">${esc(b.about)}</p>` : ''}
    ${facts.length ? `<div class="stats">${facts.map(f => `<div class="stat"><b>${esc(f[0])}</b><span>${esc(f[1])}</span></div>`).join('')}</div>` : ''}
    ${live}
    <section class="barsec"><span class="label">Events</span>${evs || '<p class="lede" style="font-size:14px">No events posted yet.</p>'}</section>
    ${hours ? `<section class="barsec"><span class="label">Opening hours</span><div class="hours">${hours}</div></section>` : ''}`;
}
function playerEventHTML(st) {
  const [barId, evId] = PAPP.ev, b = bars(st).find(x => x.id === barId), e = b && (b.events || []).find(x => x.id === evId);
  const back = backBtn('p-evback', b ? b.name : 'Bars');
  if (!e) return back + '<h1 class="h1">This event<br>was cancelled</h1>';
  const P = playerProfile(), name = P ? P.name : '';
  const names = e.names || [], signed = name && names.some(n => n.toLowerCase() === name.toLowerCase()), full = e.cap && e.count >= e.cap;
  return `${back}
    <div style="display:flex;flex-direction:column;gap:8px"><span class="label">${esc(BIZ_KINDS[e.kind] || e.kind)} · ${esc(e.gameType)}${e.live ? ' · on now' : ''}</span><h1 class="h1">${esc(e.title)}</h1>
      <p class="lede">${esc(bizDay(e.date))}, ${esc(bizTime(e.time))}${e.fee ? ' · ' + esc(e.fee) : ''}${e.prize ? ' · ' + esc(e.prize) : ''}</p></div>
    ${e.about ? `<p style="font-size:15px">${esc(e.about)}</p>` : ''}
    <div class="stats"><div class="stat"><b>${e.count}${e.cap ? '/' + e.cap : ''}</b><span>signed up</span></div><div class="stat"><b>${full ? 'Full' : e.cap ? e.cap - e.count + ' left' : 'Open'}</b><span>spots</span></div></div>
    ${names.length ? `<p class="chalk" style="font-size:20px;line-height:1.3">${esc(names.join(', '))}</p>` : ''}
    ${b.home ? `<div class="push">${signed ? '<button class="cta line" data-act="p-evleave">I can’t make it</button>' : `<button class="cta" data-act="p-evjoin"${full ? ' disabled' : ''}>${full ? 'This event is full' : 'Count me in as ' + esc(name)}</button>`}</div>`
    : '<p class="lede" style="font-size:14px">Sign up at the bar, or call them.</p>'}`;
}

// ---------- Ranks: your rating and where you are on the board ----------
function renderRanksTab(el, st) {
  const P = playerProfile();
  const sig = JSON.stringify([st.leaderboard, st.my, st.venue.name, P && P.account]);
  if (PAPP.sig.ranks === sig) return; PAPP.sig.ranks = sig;
  const my = st.my, L = st.leaderboard;
  const row = (p, i, me) => `<div class="${me ? 'me' : ''}"${me ? ' aria-current="true"' : ''}><span>${i}</span><span>${esc(p.name)}${me ? ' <span class="youtag">You</span>' : ''}</span><span>${p.rating}</span></div>`;
  let rows = L.map((p, i) => row(p, i + 1, my && p.pid === my.pid)).join('');
  if (my && my.rank > L.length) rows += '<div><span>…</span><span></span><span></span></div>' + row(my, my.rank, true);
  el.innerHTML = `<div class="ph">${backBtn('ptab" data-v="home', 'Home')}<h1 class="h1">Ranks</h1><span class="label">${esc(st.venue.name)} · Elo ratings</span>
    ${my ? `<div class="mycard"><div><span class="label">Your rating</span><b>${my.rating}</b></div><div><span class="label">Your place</span><b>#${my.rank}</b><small>of ${my.of}</small></div><div><span class="label">Record</span><b>${my.w}–${my.l}</b></div></div>` : '<p class="lede">Join a queue and play a rated game on a camera table to get your rating. Everyone starts at 1200.</p>'}
    <div class="lb ranks">${rows}</div>
    <p class="lede" style="font-size:13px">Beating a higher-rated player moves you up more. Only games on a camera table are rated.</p>
    ${P && !P.account ? '<div class="notice"><b>Set up your profile</b><span>Add a password so your rating and games stay yours, on any phone.</span><button class="b go" data-act="p-setup">Set up my profile</button></div>' : ''}</div>`;
  const meRow = $('.lb.ranks .me', el); if (meRow && meRow.scrollIntoView && PAPP.tab === 'ranks') meRow.scrollIntoView({ block: 'nearest' });
}

// ---------- Me: profile, account, invite, switch to the bar app, log out ----------
function renderMeTab(el, st) {
  const P = playerProfile();
  const sig = JSON.stringify([P, favs().length, st.my && st.my.rating]);
  if (PAPP.sig.me === sig || el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return; PAPP.sig.me = sig;
  const initials = P.name.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  el.innerHTML = `<div class="ph">${backBtn('ptab" data-v="home', 'Home')}
    <div class="mecard"><span class="avatar">${esc(initials)}</span><div><b>${esc(P.name)}</b><small>${esc(P.email)}</small><small>${P.account ? 'Account with password' : 'No password yet'} · ${favs().length} favourite bar${favs().length === 1 ? '' : 's'}</small></div></div>
    ${P.account ? '' : '<div class="notice"><b>Set up your profile</b><span>You haven\u2019t set a password yet. Add one so your rating and games stay yours.</span><button class="b go" data-act="p-acct">Add a password</button></div>'}
    <form class="mform" id="meForm" novalidate>
      <div class="field"><label for="meName">Name</label><input id="meName" type="text" maxlength="24" value="${esc(P.name)}" required><small>Shown on the queue board and leaderboard.</small></div>
      <div class="field"><label for="meEmail">Email</label><input id="meEmail" type="email" value="${esc(P.email)}" required><small>We email you when your table is ready.</small></div>
      <p class="formerr" role="alert" data-err></p>
      <button class="cta" type="submit">Save changes</button>
    </form>
    <button class="quiet" data-act="p-invite">Invite a friend to play</button>
    <div class="push">
      <button class="quiet" data-act="p-tobar">Switch to the bar app</button>
      <button class="quiet" data-act="p-logout">Log out of this phone</button>
      <button class="quiet dangerq" data-act="p-delete">Delete my profile</button>
    </div></div>`;
  $('#meForm', el).addEventListener('submit', e => {
    e.preventDefault();
    const err = $('[data-err]', el), name = $('#meName', el).value.trim().slice(0, 24), email = $('#meEmail', el).value.trim();
    if (!name) { err.textContent = 'Add your name.'; return; }
    if (!validEmail(email)) { err.textContent = 'Enter a valid email.'; return; }
    savePlayerProfile(Object.assign({}, P, { name, email }, email.toLowerCase() !== P.email.toLowerCase() ? { account: false, hash: undefined } : {}));
    PAPP.sig = {}; toast(st.me && ['waiting', 'called', 'playing'].includes(st.me.status) ? 'Saved. Your new name shows next time you join a queue.' : 'Saved.'); render();
  });
}
async function invitePlayer() {
  const P = playerProfile(), v = (S.state && S.state.venue) || {};
  const url = location.href.split('#')[0] + '#mobile&invite=' + encodeURIComponent(P ? P.name : 'A friend');
  const text = (P ? P.name : 'A friend') + ' wants to play pool with you at ' + (v.name || 'the bar') + '. Join the queue here:';
  try { if (navigator.share) { await navigator.share({ title: 'Play pool with me', text, url }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(text + ' ' + url); toast('Invite link copied. Paste it in a message to your friend.'); }
  catch (e) { window.prompt('Copy this invite link:', url); }
}
function forgetPlayer() {
  store.set('player', null); store.set('favs', null); PAPP.mem = null; PAPP.favMem = [];
  S.ticket = null; S.draft.name = ''; S.draft.email = ''; if (S.mode === 'live') saveTicket(null);
  PAPP.tab = 'home'; PAPP.bar = null; PAPP.acct = null; PAPP.sig = {}; S.sigs.clear();
}

// ---------- QR scanner: the bar's TV shows a code that opens the bar's page here ----------
async function openScanner() {
  const box = $('[data-scanner]'), video = $('video', box), msg = $('[data-scanmsg]', box);
  box.hidden = false; msg.textContent = 'Point your camera at the QR code on the bar’s TV.';
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); }
  catch (e) { msg.textContent = 'The camera isn’t available. Open your phone’s camera app and point it at the code instead.'; return; }
  video.srcObject = stream; await video.play().catch(() => {});
  let detect = null;
  if ('BarcodeDetector' in window) { try { const d = new BarcodeDetector({ formats: ['qr_code'] }); detect = async () => { const r = await d.detect(video); return r[0] && r[0].rawValue; }; } catch (e) { detect = null; } }
  if (!detect) {
    if (!window.jsQR) await new Promise(res => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js'; s.onload = res; s.onerror = res; document.head.appendChild(s); });
    const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
    detect = async () => { if (!window.jsQR || !video.videoWidth) return null; c.width = 480; c.height = Math.round(480 * video.videoHeight / video.videoWidth); g.drawImage(video, 0, 0, c.width, c.height); const r = window.jsQR(g.getImageData(0, 0, c.width, c.height).data, c.width, c.height); return r && r.data; };
  }
  PAPP.scan = { stream, on: true };
  const tick = async () => {
    if (!PAPP.scan || !PAPP.scan.on) return;
    let text = null; try { text = await detect(); } catch (e) { text = null; }
    if (text) { closeScanner(); handleScan(text); return; }
    setTimeout(tick, 250);
  };
  tick();
}
function closeScanner() { const box = $('[data-scanner]'); box.hidden = true; if (PAPP.scan) { PAPP.scan.on = false; PAPP.scan.stream.getTracks().forEach(t => t.stop()); PAPP.scan = null; } }
function handleScan(text) {
  let u; try { u = new URL(text, location.href); } catch (e) { toast('That isn’t a Loopool code.'); return; }
  if (u.origin + u.pathname === location.origin + location.pathname && /bar=|mobile|play/.test(u.hash)) { location.hash = u.hash; return; }
  if (/^https?:$/.test(u.protocol) && /pool-app|mobile|bar=/.test(u.href)) { location.href = u.href; return; }   // another bar's Loopool page
  toast('That isn’t a Loopool code.');
}

// ---------- buttons ----------
document.addEventListener('click', async e => {
  const a = e.target.closest('[data-act]'); if (!a || a.disabled) return;
  const x = a.dataset.act;
  if (x === 'role') goRole(a.dataset.v);
  else if (x === 'ptab') { closeScanner(); PAPP.tab = a.dataset.v; PAPP.sig = {}; PAPP.acct = null; if (PAPP.tab === 'bars') { PAPP.bar = null; PAPP.ev = null; PAPP.joinFor = null; } render(); window.scrollTo(0, 0); }
  else if (x === 'p-tostart') { store.set('role', null); PAPP.sig = {}; if (location.hash) location.hash = ''; else route(); }
  else if (x === 'p-loginswap') { PAPP.login = !PAPP.login; PAPP.sig = {}; render(); }
  else if (x === 'p-bar') { PAPP.tab = 'bars'; PAPP.bar = a.dataset.id; PAPP.from = a.dataset.from || 'list'; PAPP.joinFor = null; PAPP.sig = {}; render(); window.scrollTo(0, 0); }
  else if (x === 'p-back') { const from = PAPP.from; PAPP.bar = null; PAPP.joinFor = null; PAPP.sig = {}; if (from === 'home') PAPP.tab = 'home'; render(); window.scrollTo(0, 0); }
  else if (x === 'p-join') { PAPP.tab = 'bars'; if (PAPP.bar !== a.dataset.id) PAPP.from = PAPP.bar ? PAPP.from : 'home'; PAPP.bar = a.dataset.id; PAPP.joinFor = a.dataset.id; PAPP.joinPick = PAPP.joinPick || { gameType: '8-ball', refOnly: false }; PAPP.sig = {}; render(); }
  else if (x === 'p-pick') { PAPP.joinPick = Object.assign({}, PAPP.joinPick, { gameType: a.dataset.v }); PAPP.sig = {}; render(); }
  else if (x === 'p-pickref') { PAPP.joinPick = Object.assign({}, PAPP.joinPick, { refOnly: a.checked }); }
  else if (x === 'p-joincancel') { PAPP.joinFor = null; PAPP.sig = {}; render(); }
  else if (x === 'p-joinnow') { a.disabled = true; await doJoin(PAPP.joinPick || {}); a.disabled = false; }
  else if (x === 'p-ev') { PAPP.ev = [PAPP.bar, a.dataset.id]; PAPP.sig = {}; render(); window.scrollTo(0, 0); }
  else if (x === 'p-evback') { PAPP.ev = null; PAPP.sig = {}; render(); }
  else if (x === 'p-fav') { const id = a.dataset.id, F = favs(); setFavs(F.includes(id) ? F.filter(f => f !== id) : F.concat(id)); PAPP.sig = {}; render(); toast(F.includes(id) ? 'Removed from favourites.' : 'Added to your favourites.'); }
  else if (x === 'p-scan') openScanner();
  else if (x === 'p-scanclose') closeScanner();
  else if (x === 'p-invclose') { PAPP.invite = null; PAPP.sig = {}; render(); }
  else if (x === 'p-invite') invitePlayer();
  else if (x === 'p-acct') { PAPP.acct = { then: null }; PAPP.login = false; PAPP.tab = 'home'; PAPP.sig = {}; render(); window.scrollTo(0, 0); }
  else if (x === 'p-setup') { PAPP.tab = 'me'; PAPP.sig = {}; render(); window.scrollTo(0, 0); }
  else if (x === 'p-acctback') { PAPP.acct = null; PAPP.login = false; PAPP.sig = {}; render(); }
  else if (x === 'p-tobar') goRole('biz');
  else if (x === 'stopplay') { const r = await act('leave'); if (r && r.ok) { S.ticket = null; if (S.mode === 'live') saveTicket(null); PAPP.sig = {}; S.sigs.clear(); toast('You gave up the table. Thanks for playing!'); render(); } }
  else if (x === 'p-evjoin' || x === 'p-evleave') {
    const P = playerProfile();
    const r = await act(x === 'p-evjoin' ? 'event_join' : 'event_leave', { id: PAPP.ev[1], name: P.name });
    if (r && r.ok) { PAPP.sig = {}; render(); toast(x === 'p-evjoin' ? 'You’re signed up. See you there!' : 'You’re off the list.'); }
  }
  else if (x === 'p-logout' || x === 'p-delete') {
    const del = x === 'p-delete', me = S.state && S.state.me;
    if (!await askConfirm({ title: del ? 'Delete your profile?' : 'Log out of this phone?', text: (del ? 'Your name, email and favourite bars are removed from this phone' : 'Your details are removed from this phone. Log in again with your email and password') + (me && ['waiting', 'called'].includes(me.status) ? ', and you leave the queue' : '') + '. Your results stay on the leaderboard.', yes: del ? 'Delete my profile' : 'Log out', no: 'Cancel' })) return;
    if (me && ['waiting', 'called'].includes(me.status)) await act('leave');
    forgetPlayer(); store.set('role', null); toast(del ? 'Profile deleted.' : 'Logged out.');
    if (location.hash) location.hash = ''; else route();
  }
});
