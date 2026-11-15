// ===== The bar app (#bar) =====
// Flow: register the bar once (auto-filled from its website or Google Maps link, read by n8n) -> the bar's home page
// (its name and key facts, events, Start a game) -> start a game by hand, or with the camera -> camera set-up ->
// the bar TV view (stays on until staff press Exit) -> back to the home page. The profile menu edits the bar
// (with everything already filled in), switches to the player app, or deletes the bar.
// The profile, sessions and events are saved by the same Referee engine as the queue (venue_save, venue_open,
// venue_delete, event_*), so in live mode n8n stores them and every screen sees them.
// This file only uses the page helpers ($, esc, act, toast, S) inside functions, so it can load before app.js.
var BIZ = { dirty: false, editId: null, sig: {} };
var BAPP = { screen: 'home', camFrom: 'start', editing: false, cam: null, lastOpen: null, formOpen: false, sig: {} };
var BIZ_DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
var BIZ_KINDS = { tournament: 'Tournament', league: 'League night', social: 'Social night', lesson: 'Lesson or coaching' };

function bizTime(t) {                                        // "19:30" -> "7:30 PM"
  const m = /^(\d\d):(\d\d)$/.exec(t || ''); if (!m) return '';
  const h = Number(m[1]), ap = h < 12 ? 'AM' : 'PM', h12 = h % 12 || 12;
  return h12 + (m[2] === '00' ? '' : ':' + m[2]) + ' ' + ap;
}
function bizDay(iso) {                                       // "2026-11-17" -> "Tue 17 Nov"
  const d = new Date(iso + 'T12:00:00'); if (isNaN(d)) return iso;
  return d.toLocaleDateString('en-CA', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '').replace(',', '');
}
function bizToday(v, now) {                                  // "Open today 4 PM – 2 AM" from the weekly hours
  if (!v || !v.hours) return '';
  const h = v.hours[BIZ_DAYS[(new Date(now).getDay() + 6) % 7][0]];
  if (!h) return '';
  return h.closed ? 'Closed today' : 'Open today ' + bizTime(h.open) + ' – ' + bizTime(h.close);
}
function bizSig(st) { return JSON.stringify([st.venue, st.events]); }

// ---------- set up (first time) or edit the profile ----------
function renderSetup(el, st) {
  const mode = st.venue.setup ? 'edit' : 'new';
  if (el.dataset.mode !== mode) { el.dataset.mode = mode; el.innerHTML = setupHTML(mode); bindSetup(el); BIZ.dirty = false; BIZ.sig.profile = null; }
  const prof = JSON.stringify(st.venue);
  if (!BIZ.dirty && BIZ.sig.profile !== prof) { BIZ.sig.profile = prof; bizFillProfile(el, mode === 'new' ? Object.assign({}, st.venue, { name: '' }) : st.venue, st); }
}
function setupHTML(mode) {
  const hours = BIZ_DAYS.map(([d, name]) => `<div class="biz-hr"><span>${name}</span>
      <input type="time" name="h-${d}-open" aria-label="${name} opens"><span class="dim">to</span><input type="time" name="h-${d}-close" aria-label="${name} closes">
      <label class="biz-chk"><input type="checkbox" name="h-${d}-closed"> Closed</label></div>`).join('');
  return `<div class="bsetup biz">
    ${backBtn(mode === 'new' ? 'biz-tostart' : 'biz-editcancel', mode === 'new' ? 'Back' : 'Back to ' + ((S.state && S.state.venue.name) || 'your bar'))}
    <div style="display:flex;flex-direction:column;gap:8px"><h1 class="h1">${mode === 'new' ? 'Register your bar' : 'Edit your bar profile'}</h1>
      <p class="lede">${mode === 'new' ? 'You do this once. Players see it when they look your bar up.' : 'Changes show on players’ phones right away.'}</p></div>
    <section class="biz-card autofill">
      <div class="biz-hd"><span class="sign">Fill it in for me</span></div>
      <p class="dim" style="font-size:14px">Paste your bar’s Google Maps link or website. We read the page and fill in what we find: name, address, phone, hours, tables. Check it before you save.</p>
      <div class="biz-row"><input id="afUrl" type="url" placeholder="https://maps.app.goo.gl/… or https://yourbar.com" aria-label="Google Maps or website link" style="flex:1;min-width:220px"><button class="b go" type="button" data-act="biz-autofill" id="afBtn">Fill in for me</button></div>
      <p class="dim" id="afStatus" role="status" style="font-size:13.5px">In Google Maps: find your bar, tap Share, copy the link.</p>
    </section>
    <form class="biz-card biz-form" id="bizProfile" autocomplete="off">
      <input type="hidden" name="lat"><input type="hidden" name="lng">
      <div class="biz-f wide"><label for="bpName">Bar name</label><input id="bpName" name="name" maxlength="40" required></div>
      <div class="biz-f wide"><label for="bpAbout">About <span class="dim">(optional)</span></label><textarea id="bpAbout" name="about" maxlength="280" rows="2" placeholder="What makes your tables worth the trip"></textarea></div>
      <div class="biz-f wide"><label for="bpAddr">Address</label><input id="bpAddr" name="address" maxlength="120" placeholder="123 Main St, Vancouver"></div>
      <div class="biz-f wide"><label for="bpMaps">Google Maps link</label><input id="bpMaps" name="mapsUrl" type="url" maxlength="300" placeholder="https://maps.app.goo.gl/…"><small>Players tap it for directions. <a href="#" data-act="biz-testmaps">Check the link</a></small></div>
      <div class="biz-f"><label for="bpPhone">Phone <span class="dim">(optional)</span></label><input id="bpPhone" name="phone" type="tel" maxlength="30"></div>
      <div class="biz-f"><label for="bpWeb">Website <span class="dim">(optional)</span></label><input id="bpWeb" name="website" type="url" maxlength="200" placeholder="https://"></div>
      <span class="label wide" style="margin-top:6px">Tables and gear</span>
      <div class="biz-f"><label for="bpTables">Pool tables</label><input id="bpTables" name="tableCount" type="number" min="1" max="40"><small data-biz-tablenote></small></div>
      <div class="biz-f"><label for="bpBrand">Table brand</label><input id="bpBrand" name="tableBrand" maxlength="40" list="bizBrands" placeholder="Diamond"><datalist id="bizBrands"><option>Diamond</option><option>Brunswick</option><option>Olhausen</option><option>Valley</option><option>Predator</option><option>Rasson</option></datalist></div>
      <div class="biz-f"><label for="bpSize">Table size</label><select id="bpSize" name="tableSize"><option value="">Not set</option><option>7 ft</option><option>8 ft</option><option>9 ft</option></select></div>
      <div class="biz-f"><label for="bpCues">House cues</label><input id="bpCues" name="cues" type="number" min="0" max="200"></div>
      <span class="label wide" style="margin-top:6px">Opening hours</span>
      <div class="biz-hours wide">${hours}</div>
      <div class="biz-row wide"><button class="b go big" type="submit">${mode === 'new' ? 'Save and continue' : 'Save changes'}</button>${mode === 'edit' ? '<button class="b big" type="button" data-act="biz-editcancel">Cancel</button>' : ''}<span class="dim" data-biz-saved role="status"></span></div>
    </form>
  </div>`;
}
function bizFillProfile(el, v, st) {
  const f = $('#bizProfile', el); if (!f) return;
  ['name', 'about', 'address', 'mapsUrl', 'phone', 'website', 'tableCount', 'tableBrand', 'tableSize', 'cues', 'lat', 'lng'].forEach(k => { if (f.elements[k]) f.elements[k].value = v[k] == null || (k === 'cues' && !v[k]) ? '' : v[k]; });
  BIZ_DAYS.forEach(([d]) => { const h = (v.hours || {})[d] || {}; f.elements['h-' + d + '-open'].value = h.open || ''; f.elements['h-' + d + '-close'].value = h.close || ''; f.elements['h-' + d + '-closed'].checked = !!h.closed; });
  const note = $('[data-biz-tablenote]', el); if (note) note.textContent = 'The queue runs ' + st.tables.length + ' tables right now.';
}
function bizReadProfile(f) {
  const v = {};
  ['name', 'about', 'address', 'mapsUrl', 'phone', 'website', 'tableBrand', 'tableSize'].forEach(k => { v[k] = f.elements[k].value.trim(); });
  v.tableCount = Number(f.elements.tableCount.value) || 0; v.cues = Number(f.elements.cues.value) || 0;
  const g = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(v.mapsUrl) || /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(v.mapsUrl);   // map pin, for distances
  if (g) { v.lat = Number(g[1]); v.lng = Number(g[2]); } else if (f.elements.lat.value) { v.lat = Number(f.elements.lat.value); v.lng = Number(f.elements.lng.value); }
  v.hours = {}; BIZ_DAYS.forEach(([d]) => { v.hours[d] = { open: f.elements['h-' + d + '-open'].value, close: f.elements['h-' + d + '-close'].value, closed: f.elements['h-' + d + '-closed'].checked }; });
  return v;
}
function bindSetup(el) {
  const pf = $('#bizProfile', el);
  pf.addEventListener('input', () => { BIZ.dirty = true; $('[data-biz-saved]', el).textContent = 'Unsaved changes'; });
  pf.addEventListener('submit', async e => {
    e.preventDefault();
    const v = bizReadProfile(pf), first = !(S.state && S.state.venue.setup);
    if (!v.name) return toast('Give the bar a name.');
    if (v.mapsUrl && !/^https:\/\//.test(v.mapsUrl)) return toast('The Google Maps link should start with https://');
    if (v.website && !/^https:\/\//.test(v.website)) return toast('The website link should start with https://');
    const r = await act('venue_save', { profile: v });
    if (r && r.ok) { BIZ.dirty = false; BAPP.editing = false; BAPP.screen = 'home'; BAPP.sig = {}; toast(first ? 'Your bar is registered. Start a game when you open.' : 'Profile saved.'); render(); window.scrollTo(0, 0); }
  });
}
// Auto-fill: n8n opens the link and reads the page (see "Bar profile auto-fill" in the workflow). The demo page has
// no n8n behind it, so it fills in an example to show the idea.
async function bizAutofill() {
  const url = $('#afUrl').value.trim(), st = $('#afStatus'), btn = $('#afBtn');
  if (!url) return toast('Paste your Google Maps or website link first.');
  btn.disabled = true; st.textContent = 'Reading your page… this takes about 10 seconds.';
  let res;
  try {
    if (S.mode === 'live') { const r = await fetch(S.base.replace(/\/+$/, '') + '/pool-lookup?url=' + encodeURIComponent(url), { cache: 'no-store' }); res = await r.json(); }
    else {
      await new Promise(r => setTimeout(r, 900));
      const H = {}; BIZ_DAYS.forEach(([d]) => { H[d] = { open: d === 'sat' || d === 'sun' ? '12:00' : '16:00', close: d === 'fri' || d === 'sat' ? '02:00' : '00:00', closed: d === 'mon' }; });
      res = { ok: true, demo: true, profile: Object.assign({ name: 'The Corner Pocket', about: 'Six tables, cheap pints and a camera referee on Table 1.', address: '12 Water St, Vancouver, BC', phone: '+1 604-555-0199', tableCount: 6, tableBrand: 'Diamond', tableSize: '8 ft', cues: 20, hours: H, lat: 49.2843, lng: -123.1086 }, /maps|goo\.gl/.test(url) ? { mapsUrl: url } : { website: /^https:\/\//.test(url) ? url : '' }) };
    }
  } catch (e) { res = { ok: false, error: 'Couldn’t reach n8n to read the page. Fill the profile in yourself.' }; }
  btn.disabled = false;
  if (!res || !res.ok) { st.textContent = (res && res.error) || 'We couldn’t read that page. Fill the profile in yourself.'; return; }
  const f = $('#bizProfile'), p = res.profile || {}; let n = 0;
  ['name', 'about', 'address', 'mapsUrl', 'phone', 'website', 'tableCount', 'tableBrand', 'tableSize', 'cues'].forEach(k => { if (p[k] != null && p[k] !== '' && f.elements[k]) { f.elements[k].value = p[k]; f.elements[k].classList.add('filled'); n++; } });
  if (p.lat != null && p.lng != null) { f.elements.lat.value = p.lat; f.elements.lng.value = p.lng; }
  if (p.hours) { BIZ_DAYS.forEach(([d]) => { const h = p.hours[d]; if (!h) return; f.elements['h-' + d + '-open'].value = h.open || ''; f.elements['h-' + d + '-close'].value = h.close || ''; f.elements['h-' + d + '-closed'].checked = !!h.closed; }); n++; }
  BIZ.dirty = true;
  st.textContent = (res.demo ? 'Demo: filled in with an example bar. Connected to n8n, it reads your real page. ' : '') + 'Filled in ' + n + ' field' + (n === 1 ? '' : 's') + '. Check them, add anything missing, then save.';
}


// ---------- the bar app ----------
function renderBizApp(st) {
  const v = st.venue || {}, root = $('#v-biz');
  $$('[data-ico]', root).forEach(i => { if (!i.innerHTML) i.innerHTML = APP_ICONS[i.dataset.ico]; });
  // a session ended on another device: the camera on this device stops too
  if (BAPP.lastOpen && !v.open && BAPP.cam && BAPP.cam.running().length) { BAPP.cam.stopAll(); toast('The night was ended, so the camera on this device stopped.'); }
  BAPP.lastOpen = !!v.open;
  const screen = !v.setup ? 'setup' : BAPP.editing ? 'setup' : BAPP.screen;
  const tv = screen === 'tv';
  document.body.classList.toggle('kiosk', tv); document.body.classList.toggle('tvmode', tv); if (!tv) document.body.classList.remove('tvfull');
  $('.bapp-top', root).hidden = screen !== 'home';
  $('[data-bname]', root).textContent = v.name || 'Loopool';
  $('[data-bchip]', root).innerHTML = `<span class="biz-pill${v.open ? ' on' : ''}">${v.open ? 'Open tonight' : 'Closed'}</span>`;
  $$('[data-bs]', root).forEach(el => {
    const on = el.dataset.bs === screen;
    if (el.dataset.bs === 'camera' && BAPP.cam) { el.hidden = false; el.classList.toggle('offstage', !on); }   // a running camera keeps going off screen
    else el.hidden = !on;
  });
  if (screen === 'setup') renderSetup($('[data-bs="setup"]', root), st);
  else if (screen === 'home') renderBizHome(root, st);
  else if (screen === 'start') renderStartGame($('[data-bs="start"]', root), st);
  else if (screen === 'camera') renderCameraStep(root, st);
  else if (tv) renderTV($('[data-bs="tv"] [data-tv]', root), st, 'biztv');
}

// The home page: the bar's name and key facts, what's happening, Start a game, events
function renderBizHome(root, st) {
  const v = st.venue, cams = BAPP.cam ? BAPP.cam.running() : [], ev = v.eventId && (st.events || []).find(e => e.id === v.eventId);
  const playing = st.tables.filter(t => t.game).length;
  const sig = JSON.stringify([v, cams, ev && ev.title, playing, st.queue.length, st.tables.map(t => t.camLive)]);
  if (BAPP.sig.home !== sig) {
    BAPP.sig.home = sig;
    const today = bizToday(v, st.now);
    const facts = [v.tableCount ? v.tableCount + ' ' + (v.tableBrand ? v.tableBrand + ' ' : '') + 'tables' + (v.tableSize ? ' (' + v.tableSize + ')' : '') : '', v.cues ? v.cues + ' house cues' : ''].filter(Boolean).join(' · ');
    $('[data-bhome]', root).innerHTML = `<section class="bhome">
      <div class="bhome-info"><p class="lede">${esc([today, v.address].filter(Boolean).join(' · '))}</p>${facts ? `<p class="lede" style="font-size:14px">${esc(facts)}</p>` : ''}${v.about ? `<p style="font-size:15px;max-width:640px">${esc(v.about)}</p>` : ''}</div>
      <div class="bhome-now">
        <div class="stats three"><div class="stat"><b>${playing}/${st.tables.length}</b><span>tables in play</span></div><div class="stat"><b>${st.queue.length}</b><span>in the queue</span></div><div class="stat"><b>${cams.length || st.tables.filter(t => t.camLive).length}</b><span>camera${(cams.length || st.tables.filter(t => t.camLive).length) === 1 ? '' : 's'} on</span></div></div>
        ${ev ? `<p class="lede">Tonight: <b style="color:var(--chalk)">${esc(ev.title)}</b></p>` : ''}
        <div class="biz-row"><button class="b go big" data-act="biz-start">Start a game</button>
          <button class="b big" data-act="biz-totv">${cams.length ? 'Back to the bar TV' : 'Open the bar TV'}</button>
          ${cams.length ? '<button class="b big" data-act="biz-stopcam">Stop the camera</button>' : ''}
          ${v.open ? '<button class="b big danger" data-act="biz-end">End the night</button>' : ''}</div>
      </div></section>`;
  }
  renderVenue($('[data-bs="home"] [data-venue]', root), st);   // every table in the session, the queue board, results
  renderStaff(st);
  renderBizEvents($('[data-bevents]', root), st);
}

// Start a game: with the camera referee, by hand, or call the next names from the queue
function renderStartGame(el, st) {
  const ev = BAPP.event && (st.events || []).find(e => e.id === BAPP.event);
  const sig = JSON.stringify([BAPP.event, ev && ev.title, st.tables.map(t => [t.id, t.name, !!t.game, t.champ && t.champ.name, t.challenger && t.challenger.name]), st.queue.length]);
  if (BAPP.sig.start === sig) return; BAPP.sig.start = sig;
  const tableOpts = st.tables.map(t => `<option value="${t.id}">${esc(t.name)}${t.ref ? ' (camera, rated)' : ''}${t.game ? ' · in play' : ''}</option>`).join('');
  el.innerHTML = `<div class="bstart biz">
    ${backBtn('biz-home', 'Back')}
    <div style="display:flex;flex-direction:column;gap:8px"><h1 class="h1">${ev ? 'Start ' + esc(ev.title) : 'Start a game'}</h1><p class="lede">Pick how this game is run.</p></div>
    <section class="biz-card pick">
      <div class="biz-hd"><span class="sign">With the camera referee</span></div>
      <p class="dim">Set up the camera over the table. It scores every shot, calls fouls and shows the game on the bar TV. Games on Table 1 are rated.</p>
      <div class="biz-row"><button class="b go big" data-act="biz-tocam">Set up the camera</button></div>
    </section>
    <section class="biz-card pick">
      <div class="biz-hd"><span class="sign">Enter the players by hand</span></div>
      <form class="biz-form" id="handForm" autocomplete="off">
        <div class="biz-f"><label for="hTable">Table</label><select id="hTable">${tableOpts}</select></div>
        <div class="biz-f"><label for="hGame">Game</label><select id="hGame"><option value="8">8-ball</option><option value="9">9-ball</option><option value="10">10-ball</option></select></div>
        <div class="biz-f"><label for="hP1">Player who breaks</label><input id="hP1" maxlength="24" placeholder="Name"></div>
        <div class="biz-f"><label for="hP2">Opponent</label><input id="hP2" maxlength="24" placeholder="Name"></div>
        <div class="biz-row wide"><button class="b go big" type="submit">Start the game</button></div>
      </form>
    </section>
    <section class="biz-card pick">
      <div class="biz-hd"><span class="sign">Next names in the queue</span><span class="dim">${st.queue.length} waiting</span></div>
      <div class="biz-row"><select id="qTable" aria-label="Table">${tableOpts}</select><button class="b big" data-act="biz-callnext"${st.queue.length ? '' : ' disabled'}>Call them to the table</button></div>
    </section>
  </div>`;
  $('#handForm', el).addEventListener('submit', async e => {
    e.preventDefault();
    const table = $('#hTable').value, p1 = $('#hP1').value.trim(), p2 = $('#hP2').value.trim();
    if (!p1 || !p2) return toast('Type both player names.');
    const t = st.tables.find(x => x.id === table), params = { table, players: p1 + ',' + p2, gameType: $('#hGame').value };
    if (t && t.game) { if (!await askConfirm({ title: 'Replace the game on ' + t.name + '?', text: 'A game is being played there. Starting ' + p1 + ' vs ' + p2 + ' ends it with no winner.', yes: 'Start the new game', no: 'Keep it' })) return; params.force = '1'; }
    const r = await act('start_match', params); if (!r || !r.ok) return;
    await openNight(); BAPP.screen = 'home'; BAPP.event = null; BAPP.sig = {}; toast(p1 + ' vs ' + p2 + ' started on ' + (t ? t.name : table) + '.'); render(); window.scrollTo(0, 0);
  });
}
async function openNight() { const v = S.state && S.state.venue; if (v && !v.open) await act('venue_open', { open: '1', event: BAPP.event || undefined }, true); }

// The camera step: set it up, then the bar TV
function renderCameraStep(root, st) {
  const el = $('[data-camera]', root);
  if (!BAPP.cam && window.CameraView) BAPP.cam = window.CameraView.mount(el, { base: S.mode === 'live' ? S.base : '', table: 'T1', tables: () => ((S.state && S.state.tables) || []).map(t => ({ id: t.id, name: t.name, ref: t.ref })) });
  const sig = JSON.stringify([BAPP.camFrom]);
  if (BAPP.sig.camhd === sig) return; BAPP.sig.camhd = sig;
  $('[data-camhd]', root).innerHTML = `${backBtn('biz-camback', 'Back')}
    <div><h1 class="h1">Set up the camera</h1>
      <p class="lede">Mount this phone or webcam above the table, looking straight down, then press <b>Start</b> under the picture and keep the table still for 3 seconds.</p></div>
    <div class="biz-row"><button class="b go big" data-act="biz-camdone">The camera is on: show the bar TV</button></div>`;
}

// ---------- buttons ----------
document.addEventListener('click', async e => {
  const menu = $('[data-bmenu]');
  if (menu && !menu.hidden && !e.target.closest('.bapp-menu')) { menu.hidden = true; $('[data-act="bmenu"]').setAttribute('aria-expanded', 'false'); }
  const a = e.target.closest('[data-act]'); if (!a || a.disabled) return;
  const x = a.dataset.act;
  const go = screen => { BAPP.screen = screen; BAPP.sig = {}; S.sigs.clear(); render(); window.scrollTo(0, 0); };
  if (x === 'bmenu') { menu.hidden = !menu.hidden; a.setAttribute('aria-expanded', String(!menu.hidden)); return; }
  if (x.startsWith('bm-')) {
    menu.hidden = true;
    if (x === 'bm-edit') { BAPP.editing = true; BIZ.dirty = false; const el = $('[data-bs="setup"]'); el.dataset.mode = ''; render(); window.scrollTo(0, 0); }
    else if (x === 'bm-player') goRole('player');
    else if (x === 'bm-delete') {
      const v = S.state.venue;
      if (!await askConfirm({ title: 'Delete ' + v.name + '?', text: 'Your bar profile and all your events are deleted and players can no longer find you. The leaderboard and past games stay. This can’t be undone.', yes: 'Delete business', no: 'Keep it' })) return;
      if (BAPP.cam) BAPP.cam.stopAll();
      const r = await act('venue_delete'); if (r && r.ok) { BAPP.editing = false; BAPP.screen = 'home'; $('[data-bs="setup"]').dataset.mode = ''; toast('Business deleted.'); render(); }
    }
    return;
  }
  if (!x.startsWith('biz-')) return;
  const y = x.slice(4);
  if (y === 'autofill') bizAutofill();
  else if (y === 'tostart') { store.set('role', null); if (location.hash) location.hash = ''; else route(); }
  else if (y === 'editcancel') { BAPP.editing = false; BIZ.dirty = false; go('home'); }
  else if (y === 'testmaps') { e.preventDefault(); const u = $('#bpMaps').value.trim(); if (/^https:\/\//.test(u)) window.open(u, '_blank', 'noopener'); else toast('Paste a link that starts with https:// first.'); }
  else if (y === 'home') { BAPP.event = null; go('home'); }
  else if (y === 'start') { BAPP.event = null; go('start'); }
  else if (y === 'evstart') { BAPP.event = a.dataset.ev; go('start'); }
  else if (y === 'tocam') { BAPP.camFrom = 'start'; go('camera'); }
  else if (y === 'camback') go(BAPP.camFrom === 'home' ? 'home' : 'start');
  else if (y === 'camdone') {
    if (BAPP.cam && !BAPP.cam.running().length && !await askConfirm({ title: 'The camera isn’t on yet', text: 'Press Start under the camera picture first. You can still open the bar TV without a camera: it shows the queue and the leaderboard.', yes: 'Open the bar TV anyway', no: 'Go back' })) return;
    await openNight(); BAPP.event = null; go('tv');
  }
  else if (y === 'totv') go('tv');
  else if (y === 'tvexit') go('home');
  else if (y === 'stopcam') { if (BAPP.cam) BAPP.cam.stopAll(); BAPP.sig = {}; toast('Camera stopped. Games go on without the camera referee.'); render(); }
  else if (y === 'callnext') { const table = $('#qTable').value; const r = await act('next_match', { table }); if (r && r.ok) { toast('The next names were called to the table.'); go('home'); } }
  else if (y === 'end') {
    if (!await askConfirm({ title: 'End the night?', text: 'The camera stops and players see that you’re closed. Games in progress stay as they are.', yes: 'End the night', no: 'Keep going' })) return;
    if (BAPP.cam) BAPP.cam.stopAll(); BAPP.lastOpen = false;
    const r = await act('venue_open', { open: '0' }); if (r && r.ok) { BAPP.sig = {}; toast('Closed for the night. See you next time.'); render(); }
  }
  else if (y === 'printqr') bizPrintQR();
  else if (y === 'evadd') { bizResetEventForm($('#bizEvForm')); $('[data-evform]').hidden = false; $('#evTitle').focus(); }
  else if (y === 'evnew') bizResetEventForm($('#bizEvForm'));
  else if (y === 'evedit') {
    const ev = ((S.state && S.state.events) || []).find(v => v.id === a.dataset.id), f = $('#bizEvForm'); if (!ev || !f) return;
    $('[data-evform]').hidden = false;
    ['title', 'kind', 'gameType', 'date', 'time', 'cap', 'fee', 'prize', 'about'].forEach(k => { f.elements[k].value = k === 'cap' && !ev.cap ? '' : ev[k]; });
    BIZ.editId = ev.id; $('#bizEvTitle').textContent = 'Edit event'; $('#bizEvSave').textContent = 'Save changes';
    f.elements.title.focus();
  }
  else if (y === 'evdel') {
    const ev = ((S.state && S.state.events) || []).find(v => v.id === a.dataset.id); if (!ev) return;
    if (!await askConfirm({ title: 'Cancel ' + ev.title + '?', text: ev.count ? ev.count + ' player' + (ev.count > 1 ? 's are' : ' is') + ' signed up. The event disappears from their phones.' : 'The event disappears from players’ phones.', yes: 'Cancel event', no: 'Keep it' })) return;
    const r = await act('event_remove', { id: ev.id }); if (r && r.ok) { toast('Event cancelled.'); if (BIZ.editId === ev.id) bizResetEventForm($('#bizEvForm')); }
  }
});

function renderBizEvents(el, st) {
  if (!el.dataset.mounted) {
    el.dataset.mounted = '1';
    el.innerHTML = `<div class="biz-grid biz"><section class="biz-card"><div class="biz-hd"><span class="sign">Events</span><span class="dim">Players see these on your bar’s page and sign up</span><button class="b go" style="margin-left:auto" data-act="biz-evadd">Add an event</button></div><div data-biz-events></div></section>
      <section class="biz-card" data-evform hidden><form class="biz-form" id="bizEvForm" autocomplete="off">
        <span class="label wide" id="bizEvTitle">New event</span>
        <div class="biz-f wide"><label for="evTitle">Name</label><input id="evTitle" name="title" maxlength="60" placeholder="Tuesday 8-ball tournament" required></div>
        <div class="biz-f"><label for="evKind">Type</label><select id="evKind" name="kind">${Object.entries(BIZ_KINDS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
        <div class="biz-f"><label for="evGame">Game</label><select id="evGame" name="gameType"><option>8-ball</option><option>9-ball</option><option>10-ball</option></select></div>
        <div class="biz-f"><label for="evDate">Date</label><input id="evDate" name="date" type="date" required></div>
        <div class="biz-f"><label for="evTime">Starts</label><input id="evTime" name="time" type="time" value="19:00"></div>
        <div class="biz-f"><label for="evCap">Spots</label><input id="evCap" name="cap" type="number" min="0" max="256" placeholder="No limit"></div>
        <div class="biz-f"><label for="evFee">Entry</label><input id="evFee" name="fee" maxlength="30" placeholder="Free or $10"></div>
        <div class="biz-f wide"><label for="evPrize">Prize <span class="dim">(optional)</span></label><input id="evPrize" name="prize" maxlength="60" placeholder="Bar tab for the winner"></div>
        <div class="biz-f wide"><label for="evAbout">Details</label><textarea id="evAbout" name="about" maxlength="280" rows="2" placeholder="Format, skill level, what to bring"></textarea></div>
        <div class="biz-row wide"><button class="b go" type="submit" id="bizEvSave">Add event</button><button class="b" type="button" data-act="biz-evnew" id="bizEvCancel">Cancel</button></div>
      </form></section></div>`;
    const ef = $('#bizEvForm', el);
    ef.addEventListener('submit', async e => {
      e.preventDefault();
      const ev = {}; ['title', 'kind', 'gameType', 'date', 'time', 'cap', 'fee', 'prize', 'about'].forEach(k => { ev[k] = ef.elements[k].value.trim(); });
      if (!ev.title) return toast('Give the event a name.');
      if (!ev.date) return toast('Pick a date for the event.');
      if (BIZ.editId) ev.id = BIZ.editId;
      const r = await act('event_save', { event: ev });
      if (r && r.ok) { toast(BIZ.editId ? 'Event updated.' : 'Event added. Players can sign up on their phones.'); bizResetEventForm(ef); }
    });
  }
  const sig = JSON.stringify([st.events, st.venue.open]);
  if (BIZ.sig.events !== sig) { BIZ.sig.events = sig; $('[data-biz-events]', el).innerHTML = bizEventsHTML(st); }
}
function bizEventsHTML(st) {
  const evs = st.events || [];
  if (!evs.length) return '<p class="dim" style="font-size:14px">No events coming up. Add one with the form.</p>';
  return '<div class="biz-evlist">' + evs.map(e => `<div class="biz-ev">
      <div class="when"><b>${esc(bizDay(e.date))}</b><small>${esc(bizTime(e.time))}</small></div>
      <div style="min-width:0"><b>${esc(e.title)}${e.live ? ' <span class="badge">On now</span>' : ''}</b><small>${esc([BIZ_KINDS[e.kind] || e.kind, e.gameType, e.fee, e.prize].filter(Boolean).join(' · '))}</small>
        <small class="chalk biz-names">${e.count ? esc(e.names.join(', ')) : 'Nobody signed up yet'}</small></div>
      <div class="biz-evr"><span class="num">${e.count}${e.cap ? '/' + e.cap : ''}</span>${e.live ? '' : `<button class="b go" type="button" data-act="biz-evstart" data-ev="${e.id}">Start</button>`}<button class="b" type="button" data-act="biz-evedit" data-id="${e.id}">Edit</button><button class="b danger" type="button" data-act="biz-evdel" data-id="${e.id}">Cancel</button></div>
    </div>`).join('') + '</div>';
}
function bizResetEventForm(f) {
  f.reset(); BIZ.editId = null; f.elements.time.value = '19:00';
  $('#bizEvTitle').textContent = 'New event'; $('#bizEvSave').textContent = 'Add event';
  $('[data-evform]').hidden = true;
}
function bizPrintQR() {
  const v = (S.state && S.state.venue) || {};
  const w = window.open('', '_blank');
  if (!w || !S.qr) return toast('Couldn’t open a print window. Take a photo of the QR code on the counter screen instead.');
  w.document.write(`<!doctype html><title>Join the queue</title><body style="font-family:sans-serif;text-align:center;padding:40px"><h1 style="font-size:44px;margin:0 0 8px">${esc(v.name || 'Pool')}</h1><p style="font-size:24px;margin:0 0 24px">Scan to put your name on the board</p><img src="${S.qr}" style="width:70%;max-width:420px"><script>setTimeout(()=>print(),300)<\/script></body>`);
  w.document.close();
}