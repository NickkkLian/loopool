// ===== Page logic =====
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('loopool.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('loopool.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
};
// n8n can serve the page in a sandbox (n8n Cloud always does), where localStorage is blocked.
// Then the ticket rides in the link instead (#phone&t=A102), so a reload keeps your place in the queue.
const canStore = (() => { try { localStorage.setItem('loopool.t', '1'); localStorage.removeItem('loopool.t'); return true; } catch (e) { return false; } })();
const hashParts = () => { const [view, t] = location.hash.replace(/^#/, '').split('&t='); return { view, ticket: t ? decodeURIComponent(t) : null }; };
function loadTicket() { return canStore ? store.get('ticket', null) : hashParts().ticket; }
function saveTicket(t) {
  if (canStore) { store.set('ticket', t); return; }
  const h = '#' + (hashParts().view || S.view) + (t ? '&t=' + encodeURIComponent(t) : '');
  if (location.hash !== h) { try { history.replaceState(null, '', h); } catch (e) { /* link stays as it is */ } }
}
const SVGNS = 'http://www.w3.org/2000/svg';
const BALL_COLORS = { 1: '#f2c10f', 2: '#1f4fd0', 3: '#d42a2a', 4: '#6a2f9e', 5: '#ee7712', 6: '#14804b', 7: '#7d1f24', 8: '#151515' };
const ballColor = b => BALL_COLORS[b > 8 ? b - 8 : b];
const SCRIPT = buildScript();
const servedByN8n = /\/pool-app\/?$/.test(location.pathname);
const VIEWS = ['presenter', 'phone', 'venue', 'live', 'camera'];
const S = {
  mode: servedByN8n ? 'live' : store.get('mode', 'demo'),
  base: servedByN8n ? location.origin + location.pathname.replace(/\/pool-app\/?$/, '') : store.get('base', ''),
  ticket: null, state: null, local: null, err: null, busy: false, receivedAt: 0,
  view: 'presenter', ack: {}, auto: false, lastEv: null, joinOpen: false,
  draft: { name: 'Alex', email: '', gameType: '8-ball', refOnly: true },
  sigs: new Map(), tviews: new Map(), qr: '',
};
if (S.mode === 'live' && !S.base) S.mode = 'demo';
if (S.mode === 'live') { S.ticket = loadTicket(); S.draft.name = ''; }

// ---------- data: local engine (demo) or n8n webhooks (live) ----------
async function api(action, params) {
  params = Object.assign({}, params || {});
  if (S.ticket && params.ticket == null && action !== 'join') params.ticket = S.ticket;
  if (S.mode === 'live') {
    try {
      const u = new URL(S.base.replace(/\/+$/, '') + '/pool');
      u.searchParams.set('action', action);
      Object.entries(params).forEach(([k, v]) => { if (v != null) u.searchParams.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v)); });
      const r = await fetch(u, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!j || !j.tables) throw new Error('unexpected reply, is this the Pool Referee workflow?');
      S.err = null; return j;
    } catch (e) { S.err = e.message || String(e); renderMode(); return null; }
  }
  if (!S.local || action === 'reset') S.local = seedState(Date.now());
  const o = handle(S.local, action, params, Date.now());
  S.local = o.S;
  return JSON.parse(JSON.stringify(o.response));
}
function apply(res, quiet) {
  if (!res) return;
  S.state = res; S.receivedAt = Date.now();
  if (res.me && res.me.ticket) S.ticket = res.me.ticket;
  else if (S.ticket && !res.me) S.ticket = null;
  if (S.mode === 'live') saveTicket(S.ticket);
  if (!res.ok && !quiet) toast(res.error);
  render();
}
async function act(action, params, quiet) { S.busy = true; const r = await api(action, params); S.busy = false; lastChange = Date.now(); apply(r, quiet); return r; }

// ---------- small pieces ----------
const fmtTime = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const mmss = s => Math.floor(Math.max(0, s) / 60) + ':' + String(Math.max(0, s) % 60).padStart(2, '0');
const liveLeft = sec => sec == null ? null : Math.max(0, Math.round(sec - (Date.now() - S.receivedAt) / 1000));
let toastT;
function toast(msg) { if (!msg) return; const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2800); }
const ICON = {
  mark: '<svg width="26" height="24" viewBox="0 0 26 24" aria-hidden="true"><path d="M13 2.5 24 21.5H2Z" fill="none" stroke="#e5ad3e" stroke-width="2.2" stroke-linejoin="round"/><circle cx="13" cy="15" r="3.4" fill="#ecefe9"/></svg>',
  live: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="2.4" fill="#ff7a6b"/><path d="M3.8 3.8a6 6 0 0 0 0 8.4M12.2 3.8a6 6 0 0 1 0 8.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4 6.5 10l6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  flag: '<svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true"><path d="M2 17V1.5M2 2h10l-2.5 3.5L12 9H2" fill="none" stroke="#ff7a6b" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  tallyRule: '<svg width="18" height="14" viewBox="0 0 18 14" aria-hidden="true"><path d="M2 1v12M6 1v12M10 1v12M14 1v12M.5 11 17.5 3" stroke="#e5ad3e" stroke-width="1.6" stroke-linecap="round"/></svg>',
  clock: '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="7" fill="none" stroke="#e5ad3e" stroke-width="1.6"/><path d="M9 5v4l3 2" fill="none" stroke="#e5ad3e" stroke-width="1.6" stroke-linecap="round"/></svg>',
  cam: '<svg width="18" height="16" viewBox="0 0 18 16" aria-hidden="true"><rect x="1" y="4" width="12" height="9" rx="2" fill="none" stroke="#e5ad3e" stroke-width="1.6"/><path d="M13 7.5 17 5v7l-4-2.5" fill="none" stroke="#e5ad3e" stroke-width="1.6" stroke-linejoin="round"/></svg>',
};
function tally(n, max) {
  max = max || 3; n = Math.min(n || 0, max);
  const marks = Array.from({ length: max }, (_, i) => `<path d="M${4 + i * 8} 2v14" stroke="${i < n ? '#e5ad3e' : '#4a5852'}" stroke-width="2.4" stroke-linecap="round"/>`).join('');
  return `<span class="tally"><svg width="${max * 8 + 2}" height="18" viewBox="0 0 ${max * 8 + 2} 18" aria-hidden="true">${marks}</svg>${n} of ${max} wins</span>`;
}
function ballChip(b) {
  const c = ballColor(b);
  const bg = b > 8 ? `linear-gradient(#f2f2ec 0 26%, ${c} 26% 74%, #f2f2ec 74%)` : c;
  return `<span class="ball" style="background:${bg}" title="${b} ball"><i>${b}</i></span>`;
}
const groupBalls = g => g === 'solids' ? [1, 2, 3, 4, 5, 6, 7] : g === 'stripes' ? [9, 10, 11, 12, 13, 14, 15] : [];
const groupOfBall = b => b === 8 ? 'eight' : b < 8 ? 'solids' : 'stripes';
function myTable(st) { const me = st && st.me; return me && me.table ? st.tables.find(t => t.id === me.table) : null; }
function refTable(st) { return st.tables.find(t => t.ref); }
function cameraTable(st) { const mine = myTable(st); if (mine && mine.game && mine.game.mode === 'camera') return mine; return st.tables.find(t => t.game && t.game.mode === 'camera') || null; }
const isMe = (st, seat) => !!(st.me && seat && seat.ticket === st.me.ticket);
const who = (st, t, side) => isMe(st, t[side]) ? 'You' : (t[side] ? t[side].name : '?');
function pottedText(p) { return p.length ? 'potted the ' + p.join(' and ') : 'missed'; }
const BADGE_NAMES = { sharpshooter: 'sharpshooter', fair_play: 'fair play', best_shot: 'best shot' };
const scoreColor = v => v >= 85 ? 'var(--good)' : v >= 70 ? '#a3e635' : v >= 50 ? 'var(--brass)' : 'var(--foul)';
const scoreChip = s => s && s.score != null ? `<span class="scorechip" style="color:${scoreColor(s.score)}"><b>${s.score}</b><span>${esc(s.grade || '')}</span></span>` : '';
// The camera referee sends photos, not ball positions: show the real after-shot photo when there is one.
const photoURL = t => t && t.frameAt && S.mode === 'live' ? S.base.replace(/\/+$/, '') + '/pool-frame?table=' + encodeURIComponent(t.id) + '&at=' + t.frameAt : null;
const photoHTML = (t, cap) => { const u = photoURL(t); return u ? `<div class="shotphoto"><img src="${u}" alt="Photo of ${esc(t.name)} after the last shot"><span class="cap">${esc(cap || 'Camera photo after the last shot')}</span></div>` : ''; };
function shotLine(s, noScore) {
  let out = esc(s.shooter) + ' ' + pottedText(s.potted) + (s.score != null && !noScore ? ' <span class="dim">(' + s.score + ', ' + esc(s.grade || '') + ')</span>' : '');
  if (s.fouls.length) out += '. <span class="bad">' + esc(s.fouls.join('. ')) + '</span>';
  if (s.possible && s.possible.length) out += '. <span class="bad">Possible foul, under review</span>';
  if (s.cleared) out += '. Reviewed: no foul';
  if (s.note) out += '. ' + esc(s.note.replace(/^.*takes /, 'Takes '));
  return out;
}
function lbHTML(st, pid, top) {
  const L = st.leaderboard, mine = L.findIndex(p => p.pid === pid);
  const rows = L.slice(0, top).map((p, i) => [i, p]);
  if (mine >= top) rows.push(['gap'], [mine, L[mine]]);
  return `<div class="lb">${rows.map(r => r[0] === 'gap' ? '<div><span>…</span><span></span><span></span></div>' : `<div class="${r[1].pid === pid ? 'me' : ''}"><span>${r[0] + 1}</span><span>${esc(r[1].name)}${r[1].pid === pid ? ' (you)' : ''}</span><span>${r[1].rating}</span></div>`).join('')}</div>`;
}
function boardHTML(st, opts) {
  opts = opts || {};
  const me = st.me;
  let list = st.queue;
  if (opts.gameType) list = list.filter(q => q.gameType === opts.gameType);
  const called = list.filter(q => q.status === 'called'), waiting = list.filter(q => q.status === 'waiting');
  const items = called.map(q => `<li class="done"><span>${esc(q.name)}</span><small>called · ${esc((q.table || '').toLowerCase())}</small></li>`)
    .concat(waiting.slice(0, opts.max || 8).map((q, i) => {
      const mine = me && q.ticket === me.ticket;
      const right = mine ? 'you' : opts.eta ? (q.eta ? '~' + q.eta.min + ' min' : '') : (q.refOnly ? 'table 1' : 'any table');
      return `<li class="${mine ? 'me' : ''}"><span>${i + 1}. ${esc(q.name)}</span><small>${right}</small></li>`;
    }));
  return `<section class="board" aria-label="Queue board"><span class="label">${esc(opts.title || 'The board')}</span>${items.length ? `<ol>${items.join('')}</ol>` : '<span class="empty">Nobody waiting</span>'}</section>`;
}
function floorHTML(st, mode) {
  const pos = ['a', 'c', 'b2', 'd'];
  const mine = myTable(st);
  const cells = st.tables.map((t, i) => {
    let cls = 'ft ' + pos[i], lab = '';
    if (mode === 'you') {
      if (mine && t.id === mine.id) cls += ' you'; else cls += ' dimmed';
    } else {
      if (t.ref) cls += ' ref';
      if (!t.game && t.status !== 'checkin') cls += ' open';
      lab = t.game ? (t.ref ? 'ref cam' : t.game.minutes + ' min') : t.status === 'waiting' ? 'needs player' : t.status === 'checkin' ? 'checking in' : 'free';
    }
    return `<div class="${cls}"><b>${i + 1}${mode === 'you' && mine && t.id === mine.id ? ' · YOU' : ''}</b>${mode === 'you' ? '' : `<small>${lab}</small>`}</div>`;
  }).join('');
  const label = mode === 'you' ? 'Floor plan with your table highlighted' : 'Floor plan: tables 1 and 3 nearest the counter, tables 2 and 4 behind them';
  return `<div class="floor${mode === 'you' ? ' sm' : ''}" role="img" aria-label="${label}"><div class="counter">${mode === 'you' ? '' : 'COUNTER'}</div>${cells}</div>`;
}
function textsHTML(me) {
  if (!me.texts || !me.texts.length) return '';
  const x = me.texts[0];
  const via = me.emailOn ? (S.mode === 'live' ? 'Latest email to you' : 'Latest email (demo: not really sent)') : 'Latest update';
  return `<div class="sms"><small>${via} · ${fmtTime(x.at)}</small><p>${esc(x.text)}</p></div>`;
}

// ---------- table drawing ----------
let tvCount = 0;
function tableMarkup(id, R) {
  const dia = [];
  [125, 250, 375, 625, 750, 875].forEach(x => dia.push([x, -31], [x, 531]));
  [125, 250, 375].forEach(y => dia.push([-31, y], [1031, y]));
  return `<defs><clipPath id="bc${id}"><circle r="${R}"/></clipPath></defs>
    <rect x="-48" y="-48" width="1096" height="596" rx="34" style="fill:var(--rail)"/>
    <rect x="-15" y="-15" width="1030" height="530" rx="6" style="fill:var(--felt-edge)"/>
    <rect x="0" y="0" width="1000" height="500" style="fill:var(--felt)"/>
    <line x1="250" y1="0" x2="250" y2="500" stroke="#fff" stroke-opacity=".1" stroke-width="2"/>
    <circle cx="750" cy="250" r="3.5" fill="#fff" fill-opacity=".3"/><circle cx="250" cy="250" r="3.5" fill="#fff" fill-opacity=".3"/>
    ${dia.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="4" fill="#e9dcc3" fill-opacity=".7"/>`).join('')}
    ${TABLE.pockets.map(p => `<circle cx="${p[0]}" cy="${p[1]}" r="23" style="fill:var(--pocket)"/>`).join('')}
    <polyline class="trace" points="" fill="none" stroke="#f4f4ee" stroke-width="4" stroke-dasharray="12 9" stroke-opacity=".85"/>
    <circle class="ring" r="${R + 11}" cx="0" cy="0" fill="none" stroke="#ff7a6b" stroke-width="5" stroke-dasharray="9 6" style="display:none"/>
    <g class="ballz"></g>`;
}
function ballMarkup(b, R, id) {
  if (b === 'cue') return `<circle r="${R}" fill="#f4f4ee"/><circle r="${R}" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="1.2"/>`;
  b = Number(b); const c = ballColor(b);
  const body = b > 8 ? `<circle r="${R}" fill="#f4f4ee"/><rect x="${-R}" y="${-R * .56}" width="${2 * R}" height="${R * 1.12}" fill="${c}" clip-path="url(#bc${id})"/>` : `<circle r="${R}" fill="${c}"/>`;
  return `${body}<circle r="${R}" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="1.2"/><circle r="${R * .5}" fill="#f4f4ee"/><text y="${R * .26}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${R * .7}" fill="#111">${b}</text>`;
}
class TableView {
  constructor() {
    this.id = ++tvCount; this.R = TABLE.R + 1;
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '-48 -48 1096 596'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Top-down camera view of the pool table');
    svg.innerHTML = tableMarkup(this.id, this.R);
    this.svg = svg; this.layer = svg.querySelector('.ballz'); this.trace = svg.querySelector('.trace'); this.ring = svg.querySelector('.ring');
    this.els = {}; this.key = null; this.raf = 0; this.loopT = 0;
  }
  ball(b) { if (!this.els[b]) { const g = document.createElementNS(SVGNS, 'g'); g.innerHTML = ballMarkup(b, this.R, this.id); this.layer.appendChild(g); this.els[b] = g; } return this.els[b]; }
  place(b, p, op) { const g = this.ball(b); g.setAttribute('transform', 'translate(' + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ')'); g.style.opacity = op == null ? 1 : op; }
  stop() { cancelAnimationFrame(this.raf); clearTimeout(this.loopT); }
  set(pos) {
    this.stop();
    Object.keys(this.els).forEach(b => { if (!pos[b]) { this.els[b].remove(); delete this.els[b]; } });
    Object.entries(pos).forEach(([b, p]) => this.place(b, p));
    if (this.els.cue) this.layer.appendChild(this.els.cue);
  }
  animate(from, to, shot, done) {
    this.stop(); from = from || {}; to = to || {};
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pts = shot && shot.cuePath && shot.cuePath.length >= 2 ? shot.cuePath : (from.cue && to.cue ? [from.cue, to.cue] : null);
    const ids = new Set(Object.keys(from).concat(Object.keys(to)));
    Object.keys(this.els).forEach(b => { if (!ids.has(b)) { this.els[b].remove(); delete this.els[b]; } });
    const dist = (a, c) => Math.hypot(a[0] - c[0], a[1] - c[1]);
    const lerp = (a, c, x) => [a[0] + (c[0] - a[0]) * x, a[1] + (c[1] - a[1]) * x];
    const ease = x => 1 - Math.pow(1 - x, 3);
    const tc = pts && pts.length === 3 ? Math.min(0.42, Math.max(0.16, dist(pts[0], pts[1]) / (dist(pts[0], pts[1]) + dist(pts[1], pts[2]) + 1) * 0.6)) : 0;
    const D = reduce ? 1 : 1500, t0 = performance.now();
    if (to.cue || from.cue) { this.ball('cue'); this.layer.appendChild(this.els.cue); }
    const frame = now => {
      const x = Math.min(1, (now - t0) / D);
      ids.forEach(b => {
        if (b === 'cue') {
          if (!pts) { if (to.cue) this.place('cue', to.cue); else if (from.cue) this.place('cue', from.cue, 1 - x); return; }
          const p = pts.length === 3 ? (x < tc ? lerp(pts[0], pts[1], x / tc) : lerp(pts[1], pts[2], ease((x - tc) / (1 - tc)))) : lerp(pts[0], pts[1], ease(x));
          this.place('cue', p, !to.cue && x > 0.85 ? Math.max(0, 1 - (x - 0.85) / 0.15) : 1);
          return;
        }
        const a = from[b], c = to[b], y = x < tc ? 0 : ease((x - tc) / (1 - tc || 1));
        if (a && c) this.place(b, lerp(a, c, y));
        else if (a && !c) { const pk = shot && shot.pockets && shot.pockets[b] != null ? TABLE.pockets[shot.pockets[b]] : a; this.place(b, lerp(a, pk, y), y > 0.8 ? Math.max(0, 1 - (y - 0.8) / 0.2) : 1); }
        else if (!a && c) this.place(b, c, Math.min(1, x * 3));
      });
      if (x < 1) this.raf = requestAnimationFrame(frame);
      else { Object.keys(this.els).forEach(b => { if (!to[b]) { this.els[b].remove(); delete this.els[b]; } }); if (done) done(); }
    };
    this.raf = requestAnimationFrame(frame);
  }
  show(game, mark) {
    this.trace.setAttribute('points', '');
    if (!game || !game.positions) { this.ring.style.display = 'none'; this.set({}); this.key = null; return; }
    const key = game.id + ':' + (game.lastShot ? game.lastShot.no : 0);
    const ringAt = mark != null && game.positions[mark] ? game.positions[mark] : null;
    if (ringAt) { this.ring.setAttribute('cx', ringAt[0]); this.ring.setAttribute('cy', ringAt[1]); this.ring.style.display = ''; } else this.ring.style.display = 'none';
    if (key === this.key) return;
    const same = this.key && this.key.split(':')[0] === game.id;
    this.key = key;
    if (same && game.lastShot) this.animate(game.lastShot.from, game.positions, game.lastShot); else this.set(game.positions);
  }
  replay(key, rep) {
    if (this.key === key) return;
    this.key = key;
    const loop = () => {
      this.set(rep.from || {});
      const h = rep.highlight != null && rep.from ? rep.from[rep.highlight] : null;
      if (h) { this.ring.setAttribute('cx', h[0]); this.ring.setAttribute('cy', h[1]); this.ring.style.display = ''; } else this.ring.style.display = 'none';
      this.trace.setAttribute('points', (rep.cuePath || []).map(p => p.join(',')).join(' '));
      this.animate(rep.from, rep.to, rep, () => { this.loopT = setTimeout(loop, 1200); });
    };
    loop();
  }
}
function tview(key) { if (!S.tviews.has(key)) S.tviews.set(key, new TableView()); return S.tviews.get(key); }
function mount(container, key) { const slot = container.querySelector('[data-tbl="' + key.split('@')[0] + '"]'); if (!slot) return null; const v = tview(key); slot.appendChild(v.svg); return v; }

// ---------- player phone ----------
function phoneScreen(st) {
  const me = st.me;
  if (!me || me.status === 'left') return S.joinOpen ? 'join' : 'landing';
  if (me.result && (me.status === 'done' || (me.status === 'playing' && !S.ack[me.result.gameId]))) return 'result';
  if (me.status === 'waiting') return 'queue';
  if (me.status === 'called') { const ct = myTable(st), seat = ct && me.side && ct[me.side]; return seat && seat.present ? 'seated' : 'called'; }   // checked in, opponent not here yet
  if (me.status === 'missed') return 'missed';
  if (me.status === 'playing') {
    const t = myTable(st), g = t && t.game;
    if (!g) return 'seated';
    if (g.status === 'confirm') return 'confirm';
    if (g.mode === 'manual') return 'manual';
    if (g.status === 'review') return 'review';
    return 'live';
  }
  return 'landing';
}
function renderPhone(el, st, key) {
  const scr = phoneScreen(st), me = st.me, t = myTable(st), g = t && t.game;
  let data;
  if (scr === 'join') data = [S.draft.gameType, S.draft.refOnly];
  else if (scr === 'landing') data = [st.tables.map(x => [x.status, x.game && x.game.minutes, x.game && x.game.left, x.champ && x.champ.name, x.challenger && x.challenger.name]), me && me.status];
  else if (scr === 'called') data = [me, liveLeft(t && t[me.side] && t[me.side].checkinLeft), t && t[me.side === 'champ' ? 'challenger' : 'champ']];
  else data = [me, g ? [g.status, g.turn, g.shots && g.shots.length, g.review && [g.review.votes, g.review.staff], g.confirm, g.winner] : null, t && [t.status, t.streak, t.champ && t.champ.name, t.challenger && [t.challenger.name, t.challenger.present, liveLeft(t.challenger.checkinLeft)]], scr === 'queue' ? st.queue : null, scr === 'result' ? st.leaderboard.map(p => p.rating) : null];
  const sig = scr + JSON.stringify(data);
  if (S.sigs.get(el) === sig) return;
  S.sigs.set(el, sig);
  el.innerHTML = PHONE[scr](st, me, t, g) + (scr === 'join' ? '' : '<button class="quiet askbtn" data-act="ask">Ask the referee <span class="dim" style="font-weight:400">· AI</span></button>');
  if (scr === 'live') { const v = mount(el, 'phone@' + key); if (v) v.show(g); }
  if (scr === 'review') { const v = mount(el, 'review@' + key); if (v) v.replay(g.id + ':' + g.review.shotNo + ':' + g.review.source, g.review.replay); }
  if (scr === 'join') bindJoin(el);
}
const topBar = right => `<div class="ph-top"><div class="mark" style="margin:0;min-height:0">${ICON.mark}<b>LOOPOOL</b></div>${right || ''}</div>`;
const tableBar = (t, right) => `<div class="ph-top"><span class="sign">${esc(t.name)}</span>${right}</div>`;
const PHONE = {
  landing(st, me) {
    const open = st.tables.find(t => !t.game && t.status !== 'checkin');
    const h1 = open ? (open.status === 'waiting' ? esc(open.name) + '<br>needs a player' : esc(open.name) + '<br>is free') : 'All ' + st.tables.length + ' tables<br>are in play';
    const ref = refTable(st);
    let lede = 'Join the queue and we\'ll tell you when a table opens.';
    if (ref && ref.game && ref.game.left) lede += ' Table 1 is next in about ' + ref.game.left + ' minute' + (ref.game.left > 1 ? 's' : '') + '.';
    else if (ref && ref.game && ref.game.mode === 'camera') lede += ' Table 1 has a live game on camera.';
    const rows = st.tables.map((t, i) => `<div class="row"><span class="n${t.ref ? ' ref' : ''}">${i + 1}</span><div style="min-width:0"><b>${t.game || t.status === 'checkin' ? esc(t.champ.name) + ' vs ' + esc(t.challenger ? t.challenger.name : '…') : t.champ ? esc(t.champ.name) + ' needs a challenger' : 'Free'}</b><small>${t.gameType}${t.ref ? ' · camera referee · rated' : t.camera ? ' · camera referee' : ''}</small></div><span class="t">${t.game ? t.game.minutes + ' min' : t.status === 'checkin' ? 'starting' : ''}</span></div>`).join('');
    return `${topBar(`<a href="${document.body.classList.contains('kiosk') ? '#tv' : '#live'}" style="display:flex;align-items:center;gap:6px;min-height:44px;font-size:14px;font-weight:500;text-decoration:none">${ICON.live}Watch Table 1</a>`)}
      <div style="display:flex;flex-direction:column;gap:8px"><h1 class="h1">${h1}</h1><p class="lede">${lede}</p></div>
      ${me && me.status === 'left' ? '<p class="lede">You left the queue. Put your name back on any time.</p>' : ''}
      ${floorHTML(st)}
      <div class="rows">${rows}</div>
      <button class="cta" data-act="openjoin">Join the queue</button>
      <ul class="rules"><li>${ICON.tallyRule}Winner stays on, ${st.rules.maxWins} wins max while people wait</li><li>${ICON.clock}${Math.round(st.rules.checkinSec / 60)} minutes to check in when you're called</li><li>${ICON.cam}Table 1 has the camera referee. Games there are rated.</li></ul>`;
  },
  join() {
    const d = S.draft, nine = d.gameType === '9-ball';
    return `<div class="ph-top" style="justify-content:flex-start;gap:4px"><button class="quiet" data-act="closejoin" aria-label="Back to tables" style="width:44px;min-height:44px;border:0;margin-left:-12px">${ICON.back}</button><span class="dim">Loopool</span></div>
      <h1 class="h1">Put your name<br>on the board</h1>
      <form id="joinForm" style="display:flex;flex-direction:column;gap:20px">
        <div class="field"><label for="jName">Name</label><input id="jName" type="text" maxlength="24" value="${esc(d.name)}" placeholder="First name" autocomplete="given-name" required><small>This is how it's written on the queue board and leaderboard.${d.name === 'Alex' ? ' "Alex" is an example.' : ''}</small></div>
        <div class="field"><label for="jEmail">Email <span class="dim" style="font-weight:400">(optional)</span></label><input id="jEmail" type="email" value="${esc(d.email)}" placeholder="you@example.com" autocomplete="email" inputmode="email"><small>We email you when your table is ready, with a button to check in. Leave it blank to keep this page open instead.</small></div>
        <fieldset class="field"><legend>Game</legend><div class="seg"><button type="button" data-game="8-ball" aria-pressed="${!nine}">8-BALL</button><button type="button" data-game="9-ball" aria-pressed="${nine}">9-BALL</button></div></fieldset>
        <label class="switch" for="jRef"><span><b>Table 1 only (camera referee)</b><small>${nine ? 'The camera referee supports 8-ball for now.' : 'Rated game, fouls called by the camera, shown on the bar TVs. The wait can be longer.'}</small></span><span class="knob"><input id="jRef" type="checkbox" ${d.refOnly && !nine ? 'checked' : ''} ${nine ? 'disabled' : ''}><i></i></span></label>
        <button class="cta" type="submit">Join the queue</button>
      </form>`;
  },
  queue(st, me) {
    const eta = me.eta ? (me.eta.min <= 0 ? 'Any minute' : '~' + me.eta.min + ' min') : 'Waiting';
    const et = me.eta ? st.tables.find(t => t.name === me.eta.table) : null;
    const etInfo = et ? (et.game ? esc(et.champ.name) + ' vs ' + esc(et.challenger.name) + ', ' + et.game.minutes + ' min in' : 'between games') : '';
    return `${topBar('<span class="mono dim" style="font-size:13px">You\'re on the board</span>')}
      <div class="ticket"><div class="main"><span class="label">Queue ticket</span><span class="no">${esc(me.ticket)}</span><span class="who">${esc(me.name)} · ${me.gameType} · ${me.refOnly ? 'Table 1 only' : 'any table'}</span></div><div class="stub"><b>#${me.position}</b><span>IN LINE</span></div></div>
      <div class="stats"><div class="stat"><b>${eta}</b><span>estimated wait</span></div><div class="stat"><b>${me.eta ? esc(me.eta.table) : '—'}</b><span>${etInfo}</span></div></div>
      ${boardHTML(st, { gameType: me.gameType, title: 'The board · ' + me.gameType })}
      ${textsHTML(me)}
      <div class="push"><button class="quiet" data-act="leave">Leave the queue</button></div>`;
  },
  called(st, me, t) {
    const oppSide = me.side === 'champ' ? 'challenger' : 'champ', opp = t[oppSide];
    return `${topBar(`<span class="mono" style="font-size:13px;color:var(--brass)">${esc(me.ticket)}</span>`)}
      <div class="ready"><span class="label">Your table is ready</span><span class="big">${esc(t.name).toUpperCase()}</span><div class="count"><b>${mmss(liveLeft(t[me.side].checkinLeft))}</b><span>left to check in</span></div></div>
      ${floorHTML(st, 'you')}
      ${opp ? `<div class="versus"><div class="p"><span class="chalk">${esc(me.name)}</span><small>rating ${me.rating}</small><small>${me.side === 'champ' ? 'holds the table' : 'challenger'}</small></div><span class="x">VS</span><div class="p r"><span class="chalk">${esc(opp.name)}</span><small>rating ${opp.rating}</small><small>${oppSide === 'champ' ? 'holds the table' : 'challenger'}</small>${oppSide === 'champ' && t.streak ? tally(t.streak, st.rules.maxWins) : ''}</div></div>` : ''}
      <p class="lede" style="font-size:14px">Winner stays on.${opp && oppSide === 'champ' ? ' Beat ' + esc(opp.name) + ' to take over ' + esc(t.name) + '.' : ''} If you don't check in, the next name on the board is called.</p>
      <div class="push"><button class="cta" data-act="checkin">I'm at the table</button></div>`;
  },
  seated(st, me, t) {
    const other = t[me.side === 'champ' ? 'challenger' : 'champ'];
    return `${tableBar(t, `<span class="mono dim" style="font-size:13px">${me.side === 'champ' ? 'YOU HOLD THE TABLE' : 'CHECKED IN'}</span>`)}
      <h1 class="h1">${other ? (other.present ? 'Racking up' : esc(other.name) + '<br>is on the way') : 'Waiting for<br>a challenger'}</h1>
      <p class="lede">${other ? (other.present ? 'Both players are here. The camera starts scoring from the break.' : esc(other.name) + ' has ' + mmss(liveLeft(other.checkinLeft)) + ' to check in.') : 'The next name on the board for ' + esc(t.gameType) + ' is called as soon as they join.'}</p>
      ${me.side === 'champ' && t.streak ? `<div class="hold"><div class="hd"><b>Your run on ${esc(t.name)}</b>${tally(t.streak, st.rules.maxWins)}</div></div>` : ''}
      ${boardHTML(st, { gameType: t.gameType, title: 'The board · ' + t.gameType })}
      ${me.side === 'champ' && !other ? '<div class="push"><button class="quiet" data-act="leave">Give up the table</button></div>' : ''}`;
  },
  live(st, me, t, g) {
    const sides = [me.side, me.side === 'champ' ? 'challenger' : 'champ'];
    const last = g.shots[g.shots.length - 1];
    return `${tableBar(t, `<span class="live-tag">Live${g.shots.length ? ' · shot ' + g.shots.length : ''}${g.rated ? ' · rated' : ''}</span>`)}
      <div style="display:flex;flex-direction:column;gap:10px">${sides.map(s => playerPanel(st, t, g, s)).join('')}</div>
      ${photoURL(t) ? photoHTML(t) : '<div class="tbl" data-tbl="phone"></div>'}
      <p class="lastshot">${last ? '<span class="dim">Last shot:</span>' + shotLine(last) + '.' : '<span class="dim">Break when you\'re ready.</span> The camera scores from the first shot.'}</p>
      ${last && last.ai ? `<p class="ailine"><b>AI</b><span>${esc(last.ai)}</span></p>` : ''}
      ${last && last.tip ? `<div style="display:flex;gap:10px;align-items:center">${scoreChip(last)}<p class="tipline" style="flex:1">Tip: ${esc(last.tip)}</p></div>` : ''}
      <button class="quiet" data-act="flag" ${!last || last.flagged || last.cleared ? 'disabled' : ''}>${ICON.flag}Flag the last shot as a foul</button>
      ${g.shots.length > 1 ? `<ol class="log" reversed>${g.shots.slice(-4, -1).reverse().map(s => `<li><span class="n">#${s.no}</span><span>${shotLine(s)}</span></li>`).join('')}</ol>` : ''}`;
  },
  review(st, me, t, g) {
    const r = g.review, mine = r.votes[me.side];
    const shooter = t[r.side], shooterIsMe = isMe(st, shooter);
    let h1 = esc(r.foul.text);
    if (r.source === 'player') {
      const iFlagged = r.foul.text.indexOf(me.name + ' flagged') === 0, opp = t[me.side === 'champ' ? 'challenger' : 'champ'];
      h1 = iFlagged ? (shooterIsMe ? 'You flagged your own shot' : 'You flagged ' + esc(shooter.name) + '’s shot') : (shooterIsMe ? esc(opp ? opp.name : 'A player') + ' flagged your shot' : esc(r.foul.text));
    }
    if (r.source === 'ai' && r.ball != null) {
      const myGroup = g.groups[me.side];
      h1 = shooterIsMe ? 'You hit the ' + r.ball + ' first' : esc(shooter.name) + ' hit ' + (myGroup && groupOfBall(r.ball) === myGroup ? 'your' : 'the') + ' ' + r.ball + ' first';
    }
    const voteBox = s => { const v = r.votes[s], say = isMe(st, t[s]) ? 'Say ' : 'Says '; return `<div class="vote${v ? '' : ' wait'}"><span class="chalk">${esc(who(st, t, s))}</span><span class="${v === 'accept' ? 'no' : v === 'dispute' ? 'yes' : ''}">${v === 'accept' ? say + 'foul' : v === 'dispute' ? say + 'no foul' : 'Still deciding'}</span></div>`; };
    const conf = r.foul.conf ? Math.round(r.foul.conf * 100) : null, sure = Math.round((r.threshold || 0.8) * 100);
    // Shots read from camera photos have no ball positions to replay: show the photo and say so.
    const look = r.replay && r.replay.from ? `<div class="replay"><div class="tbl" data-tbl="review"></div><p class="cliptag">Replay of shot ${r.shotNo}. The ring marks the first ball the cue ball touched.</p></div>`
      : photoURL(t) ? `<div class="replay">${photoHTML(t, 'Camera photo after shot ' + r.shotNo)}<p class="cliptag">There is no replay of this shot, only the photo taken after it. Decide from what you both saw.</p></div>` : '';
    const ifFoulMe = isMe(st, t[r.ifFoul]);
    return `${tableBar(t, '<span class="mono" style="font-size:13px;color:var(--foul)">PLAY PAUSED</span>')}
      <div style="display:flex;flex-direction:column;gap:6px"><span class="label" style="color:var(--foul)">Foul review · shot ${r.shotNo}</span><h1 class="h1" style="font-size:38px">${h1}</h1></div>
      ${look}
      ${conf != null ? `<div style="display:flex;flex-direction:column;gap:8px"><div style="display:flex;justify-content:space-between;font-size:14px"><span>How sure the camera is</span><span class="mono">${conf}%</span></div><div class="meter"><i style="width:${conf}%"></i><b style="left:${sure}%"></b></div><span class="dim" style="font-size:13px">Above ${sure}% the camera calls it on its own. Below that, both players decide.</span></div>` : `<p class="lede" style="font-size:14px">A player flagged this shot. ${r.replay && r.replay.from ? 'Watch the replay, then both players decide.' : 'Both players decide.'}</p>`}
      <div class="two">${voteBox(me.side)}${voteBox(me.side === 'champ' ? 'challenger' : 'champ')}</div>
      <div class="push">${r.staff ? '<p class="lede" style="font-size:14px">You disagree, so a staff member decides on the counter tablet.</p>' : mine ? '<p class="lede" style="font-size:14px">Waiting for the other player.</p>' : '<div class="two"><button class="cta foul" data-act="vote" data-v="accept">Foul</button><button class="cta line" data-act="vote" data-v="dispute">No foul</button></div>'}
      <p class="dim" style="font-size:13px;text-align:center">If it's a foul, ${ifFoulMe ? 'you get' : esc(t[r.ifFoul].name) + ' gets'} ball in hand.</p></div>`;
  },
  confirm(st, me, t, g) {
    const iWon = g.winner === me.side;
    const c = s => `<div class="vote${g.confirm[s] ? '' : ' wait'}"><span class="chalk">${esc(who(st, t, s))}</span><span class="${g.confirm[s] ? 'yes' : ''}">${g.confirm[s] ? 'Confirmed' : 'Not yet'}</span></div>`;
    return `${tableBar(t, '<span class="mono dim" style="font-size:13px">GAME OVER</span>')}
      <div class="won" style="display:flex;flex-direction:column;gap:6px"><span class="lede">${esc(g.winReason || '')}</span><span class="big">${iWon ? 'You won' : esc(t[g.winner].name) + ' wins'}</span></div>
      <p class="lede" style="font-size:14px">Both players confirm, so the rating change is fair.</p>
      <div class="two">${c(me.side)}${c(me.side === 'champ' ? 'challenger' : 'champ')}</div>
      <div class="push">${g.confirm[me.side] ? '<p class="lede" style="font-size:14px;text-align:center">Waiting for the other player.</p>' : '<button class="cta" data-act="confirm">Confirm result</button>'}</div>`;
  },
  manual(st, me, t) {
    const opp = t[me.side === 'champ' ? 'challenger' : 'champ'];
    return `${tableBar(t, `<span class="mono dim" style="font-size:13px">${t.gameType.toUpperCase()} · NO CAMERA</span>`)}
      <h1 class="h1">Game on</h1>
      <p class="lede">You vs ${esc(opp.name)}. This table has no camera referee, so tell us who won when you finish.</p>
      <div class="push"><div class="two"><button class="cta" data-act="report" data-v="won">I won</button><button class="cta line" data-act="report" data-v="lost">I lost</button></div></div>`;
  },
  result(st, me, t) {
    const r = me.result, won = r.won;
    const next = t && t.challenger;
    const before = r.rating - r.delta;
    return `<div class="ph-top"><span class="sign">${esc(r.table)}</span><span class="mono dim" style="font-size:13px">FINAL</span></div>
      <div class="won" style="display:flex;flex-direction:column;gap:4px"><span class="lede">${won ? 'You beat ' + esc(r.opponent) : esc(r.opponent) + ' won this one'}</span><span class="big">${won ? 'You won' : 'Good game'}</span>
        ${r.rated ? `<div class="delta"><b class="${r.delta < 0 ? 'down' : ''}">${r.delta >= 0 ? '+' : ''}${r.delta}</b><span>rating ${before} → ${r.rating}</span></div>` : '<div class="delta"><span>Unrated game</span></div>'}</div>
      ${won && r.stayOn ? `<div class="hold"><div class="hd"><b>You hold ${esc(r.table)}</b>${tally(r.streak, st.rules.maxWins)}</div><span class="dim" style="font-size:14px">Winner stays on. ${next ? `Next on the board: <span class="chalk" style="font-size:20px;color:var(--chalk)">${esc(next.name)}</span>, ${next.present ? 'ready to play.' : 'checking in now.'}` : 'Waiting for the next name on the board.'}</span></div>` : ''}
      ${r.retired ? `<div class="hold"><div class="hd"><b>${st.rules.maxWins} in a row</b>${tally(st.rules.maxWins, st.rules.maxWins)}</div><span class="dim" style="font-size:14px">House rule: the table goes to the next players now. Nice run.</span></div>` : ''}
      <section aria-label="Leaderboard" style="display:flex;flex-direction:column;gap:4px"><span class="label">Tonight's ratings</span>${lbHTML(st, me.pid, 4)}</section>
      <div class="push">${won && r.stayOn ? `<button class="cta" data-act="ack" data-g="${esc(r.gameId)}">${next ? 'Play ' + esc(next.name) + ' next' : 'Keep the table'}</button>` : `<button class="cta" data-act="rejoin">Put my name back on the board</button><button class="quiet" data-act="done">I'm done for tonight</button>`}</div>`;
  },
  missed(st, me) {
    return `${topBar(`<span class="mono dim" style="font-size:13px">${esc(me.ticket)}</span>`)}
      <h1 class="h1">You missed<br>your turn</h1>
      <p class="lede">The ${Math.round(st.rules.checkinSec / 60)} minutes ran out, so the next name on the board was called.</p>
      ${textsHTML(me)}
      <div class="push"><button class="cta" data-act="rejoin">Put my name back on the board</button></div>`;
  },
};
function playerPanel(st, t, g, side) {
  const grp = g.groups[side], all = groupBalls(grp), left = all.filter(b => g.onTable.includes(b)), potted = all.filter(b => !g.onTable.includes(b));
  const flag = g.turn === side ? `<span class="flag shoot">${g.ballInHand ? 'Ball in hand' : 'To shoot'}</span>` : side === 'champ' ? '<span class="flag hold">Holds table</span>' : '<span></span>';
  const sub = grp ? grp + ' · ' + (left.length ? left.length + ' left' : 'on the 8') : 'open table';
  const tray = !grp ? '<span class="open">First ball potted decides the groups</span>' : potted.length ? potted.map(ballChip).join('') : '<span class="open">None potted yet</span>';
  return `<div class="player${g.turn === side ? ' turn' : ''}"><div class="hd"><span class="chalk">${esc(t[side].name)}<small>${sub}</small></span>${flag}</div><div class="tray" aria-label="Potted balls">${tray}</div></div>`;
}
function bindJoin(el) {
  const f = $('#joinForm', el); if (!f) return;
  f.addEventListener('input', () => { S.draft.name = $('#jName', f).value; S.draft.email = $('#jEmail', f).value; S.draft.refOnly = $('#jRef', f).checked; });
  $$('[data-game]', f).forEach(b => b.addEventListener('click', () => { S.draft.gameType = b.dataset.game; S.sigs.delete(el); render(); }));
  f.addEventListener('submit', async e => {
    e.preventDefault();
    if (!S.draft.name.trim()) { toast('Add your name first.'); return; }
    const r = await act('join', { name: S.draft.name, email: S.draft.email, gameType: S.draft.gameType, refOnly: S.draft.refOnly && S.draft.gameType === '8-ball' });
    if (r && r.ok) { S.joinOpen = false; toast('You\'re on the board. Ticket ' + r.me.ticket); }
  });
}

// ---------- bar TV ----------
// The TV is laid out once, on a 16:9 canvas (1280 x 720), and scaled to the screen the way signage is: the whole screen
// at #tv, the column width on the Bar TV tab. Columns too narrow for that (All screens, phones) keep the stacked layout.
const TV_W = 1280, TV_H = 720;
function fitTV(el) {
  const full = document.body.classList.contains('tvmode');
  const w = full ? window.innerWidth : el.clientWidth;
  const fit = w >= (full ? 900 : 1100);
  el.classList.toggle('tvfit', fit);
  if (full) document.body.classList.toggle('tvfull', fit);
  if (fit) el.style.setProperty('--tvz', Math.floor((full ? Math.min(w / TV_W, window.innerHeight / TV_H) : w / TV_W) * 10000) / 10000);
}
// Right column, under the queue: the last shot when the AI has scored it from the camera photos (the call, the 0-100
// score and the tip; the after-photo is the big picture beside it), tonight's results otherwise.
function tvShotHTML(s) {
  const col = scoreColor(s.score);
  return `<section class="shotcard" aria-label="Last shot"><span class="label">Last shot · shot ${s.no}</span>
    <div class="sc"><b class="ring" style="color:${col}" aria-label="Score ${s.score} out of 100">${s.score}</b><p>${s.grade ? `<strong style="color:${col}">${esc(s.grade)}</strong> ` : ''}${shotLine(s, true)}.</p></div>
    ${s.tip ? `<p class="tipline">Tip for ${esc(s.shooter)}: ${esc(s.tip)}</p>` : ''}</section>`;
}
function tvResultsHTML(st) {
  const rows = st.recent.slice(0, 3);
  return `<section class="tvres" aria-label="Tonight's results"><span class="label">Tonight's results</span>${rows.length ? `<div class="rs">${rows.map(r => `<div><b>${esc(r.winner)}</b> beat ${esc(r.loser)}<small>${esc(r.table)}${r.rated && r.delta ? ' · +' + r.delta + ' rating' : ''}</small></div>`).join('')}</div>` : '<p class="dim">No games finished yet tonight.</p>'}</section>`;
}
function renderTV(el, st, key) {
  fitTV(el);
  const t = cameraTable(st) || refTable(st), g = t.game && t.game.mode === 'camera' ? t.game : null;
  const feed = st.feed.slice(0, 5), top = st.leaderboard.slice(0, 6);
  const sig = JSON.stringify([t.id, t.frameAt, t.gameType, t.status, t.streak, !g && t.game && t.game.minutes, t.champ && [t.champ.name, t.champ.rating], t.challenger && [t.challenger.name, t.challenger.present], g && [g.id, g.shots.length, g.status, g.turn, g.review && [g.review.staff, g.review.votes], g.shots[g.shots.length - 1]], st.queue.map(q => q.ticket + q.status + (q.eta && q.eta.min)), top.map(p => p.name + p.rating), st.leaderboard.map(p => p.badges), st.recent.slice(0, 3).map(r => r.at), feed.map(f => f.at + f.text), S.qr ? 1 : 0, st.me && st.me.ticket]);
  if (S.sigs.get(el) === sig) return;
  S.sigs.set(el, sig);
  let board = '', banner = '', idle = '';
  if (g) {
    const pl = (side, right) => {
      const grp = g.groups[side], potted = groupBalls(grp).filter(b => !g.onTable.includes(b));
      const meta = [t[side].rating, grp || 'open table', side === 'champ' && t.streak ? t.streak + ' win' + (t.streak > 1 ? 's' : '') : ''].filter(Boolean).join(' · ');
      const name = `<span class="chalk">${right ? `<small>${esc(meta)}</small> ` : ''}${esc(t[side].name)}${right ? '' : ` <small>${esc(meta)}</small>`}</span>`;
      return `<div class="p${right ? ' r' : ''}${g.turn === side ? ' turn' : ''}">${name}<div class="tray">${potted.length ? potted.map(ballChip).join('') : '<span class="open">—</span>'}</div></div>`;
    };
    board = `<div class="score">${pl('challenger')}<div class="mid">${g.shots.length ? 'SHOT<b class="num">' + g.shots.length + '</b>' : 'BREAK'}</div>${pl('champ', true)}</div>`;
    if (g.status === 'review') banner = `<div class="banner">${g.review.staff ? 'PLAYERS DISAGREE · STAFF DECIDING' : 'POSSIBLE FOUL · SHOT ' + g.review.shotNo + ' · PLAYERS DECIDING'}</div>`;
    if (g.status === 'confirm') banner = `<div class="banner win">${esc(t[g.winner].name).toUpperCase()} WINS</div>`;
  } else {
    // No camera game: the strip still says who is at the table, so the screen keeps one layout between games.
    const ch = t.champ, nx = t.challenger;
    const seat = (s, right) => {
      if (!s) return `<div class="p${right ? ' r' : ''}"><span class="chalk dim">Open seat</span></div>`;
      const meta = esc([s.rating, right && t.streak ? t.streak + ' win' + (t.streak > 1 ? 's' : '') : ''].filter(Boolean).join(' · '));
      return `<div class="p${right ? ' r' : ''}"><span class="chalk">${right ? `<small>${meta}</small> ` : ''}${esc(s.name)}${right ? '' : ` <small>${meta}</small>`}</span></div>`;
    };
    if (ch) board = `<div class="score">${seat(nx)}<div class="mid">VS</div>${seat(ch, true)}</div>`;
    const head = t.game ? 'Camera starts with the next game' : nx ? 'Up next' : ch ? esc(t.name) + ' needs a player' : esc(t.name) + ' is open';
    const line = t.game ? esc(ch.name) + ' and ' + esc(nx.name) + ' are finishing a game (' + t.game.minutes + ' min in).' : nx ? (nx.present ? 'Both players are at the table.' : esc(nx.name) + ' is checking in.') : 'Scan the code to put your name on the board.';
    idle = `<div class="idle"><div><b>${head}</b>${line}</div></div>`;
  }
  const f = feed[0], last = g && g.shots.length ? g.shots[g.shots.length - 1] : null;
  const honours = st.leaderboard.flatMap(p => (p.badges || []).map(b => `<span><span class="badge">${BADGE_NAMES[b] || esc(b)}</span> ${esc(p.name)}</span>`));
  el.innerHTML = `<div class="tv"><div class="tv-top"><div class="t"><span class="onair">LIVE</span><span class="sign">${esc(t.name)} · ${g && g.rated ? 'Rated ' : ''}${esc(t.gameType)}</span></div><div class="mark" style="margin:0;min-height:0">${ICON.mark}<b>LOOPOOL</b></div></div>
    <div class="tv-grid"><div class="tv-main">${board}<div class="tvtable">${g && photoURL(t) ? photoHTML(t, 'Camera photo' + (g.shots.length ? ' · after shot ' + g.shots.length : '')) : '<div data-tbl="tv"></div>'}${banner}${idle}</div>
      <div class="ticker"><p class="now"><b class="${f && f.kind === 'ai' ? 'ai' : ''}">${f && f.kind === 'ai' ? 'AI CALL' : 'LATEST'}</b><span>${f ? esc(f.text) : 'Waiting for the first shot'}</span></p>${feed.length > 1 ? `<div class="older"><div>${feed.slice(1).map(x => `<p>${esc(x.text)}</p>`).join('')}</div></div>` : ''}</div></div>
      <div class="aside">
        ${boardHTML(st, { gameType: t.gameType, title: 'On the board · ' + t.gameType, eta: true, max: 4 })}
        ${last && last.score != null ? tvShotHTML(last) : tvResultsHTML(st)}
        <section aria-label="Tonight's ratings" class="ratings"><span class="label">Tonight's ratings</span><div class="rt">${top.map((p, i) => `<div><span class="rk">${i + 1}</span><span class="nm">${esc(p.name)}</span><span class="pts">${p.rating}</span></div>`).join('')}</div>${honours.length ? `<p class="honours">${honours.join('')}</p>` : ''}</section>
        <div class="qrline"><span class="qrbox">${S.qr ? `<img src="${S.qr}" alt="QR code to join the queue">` : ''}</span><span class="sign">Scan to put your name on the board</span></div>
      </div></div></div>`;
  const v = mount(el, 'tv@' + key); if (v) v.show(g, g && g.status === 'review' && g.review ? g.review.ball : null);
}

// ---------- counter tablet ----------
function renderVenue(el, st) {
  const sig = JSON.stringify([st.tables.map(t => [t.status, t.streak, t.champ && [t.champ.name, t.champ.rating], t.challenger && [t.challenger.name, t.challenger.present, liveLeft(t.challenger.checkinLeft)], t.game && [t.game.minutes, t.game.status, t.game.shots && t.game.shots.length]]), st.queue, st.recent.slice(0, 5).map(r => r.at), st.feed.slice(0, 10).map(f => f.at + f.text), S.qr ? 1 : 0, Math.floor(st.now / 60000)]);
  if (S.sigs.get(el) === sig) return;
  S.sigs.set(el, sig);
  const statusText = t => ({ playing: ['play', 'In play'], review: ['alert', 'Foul review'], staff: ['alert', 'Staff decision'], confirm: ['wait', 'Confirming result'], checkin: ['wait', 'Checking in'], waiting: ['wait', 'Needs a player'], empty: ['free', 'Free'] }[t.status] || ['free', t.status]);
  const seat = (t, side) => {
    const s = t[side]; if (!s) return '<div class="seat"><span class="dim">Open seat</span></div>';
    const right = !s.present ? 'checking in ' + mmss(liveLeft(s.checkinLeft)) : side === 'champ' && t.streak ? s.rating + ' · ' + t.streak + ' in a row' : String(s.rating);
    return `<div class="seat"><span class="chalk">${esc(s.name)}</span><small>${right}</small></div>`;
  };
  const cards = st.tables.map(t => {
    const g = t.game, [cls, txt] = statusText(t);
    let extra = '';
    if (g && g.status === 'review' && g.review) extra = g.review.staff
      ? `<p style="font-size:13.5px">Players disagree on shot ${g.review.shotNo}: ${esc(g.review.foul.text)}.</p><div class="decide"><button class="uphold" data-act="staff" data-t="${t.id}" data-v="uphold">Foul</button><button data-act="staff" data-t="${t.id}" data-v="overrule">No foul</button></div>`
      : `<p class="dim" style="font-size:13.5px">Players are reviewing shot ${g.review.shotNo}.</p>`;
    const meta = [t.gameType, t.ref || t.camera ? 'camera referee' : '', g ? (g.minutes ? g.minutes + ' min' : 'just started') : '', g && g.mode === 'camera' && g.shots.length ? 'shot ' + g.shots.length : ''].filter(Boolean).join(' · ');
    return `<div class="tcard${t.status === 'staff' ? ' staff' : ''}"><div class="hd"><span class="sign">${esc(t.name)}</span><span class="st ${cls}">${txt}</span></div><span class="meta">${esc(meta)}</span><div class="felt"></div>${seat(t, 'champ')}${seat(t, 'challenger')}${extra}</div>`;
  }).join('');
  // Red is kept for what staff must act on: a foul the players disagree about, until staff decide it. Everything else is a plain record.
  const needsStaff = f => f.kind === 'staff' && st.tables.some(t => t.id === f.table && t.status === 'staff' && t.game && t.game.id === f.game && t.game.review && t.game.review.shotNo === f.shot);
  el.innerHTML = `<div class="tablet"><div class="tab-top"><span class="sign">${esc(st.venue.name)}</span><span class="clock num">${fmtTime(st.now)}</span></div>
    <div class="tgrid"><div class="panel" style="min-width:0"><div class="tables">${cards}</div>
      <section aria-label="Activity" class="panel" style="margin-top:6px"><span class="label">Activity</span><div class="activity">${st.feed.slice(0, 8).map(f => needsStaff(f) ? `<div class="todo"><span class="tm">${fmtTime(f.at)}</span><span>${ICON.flag}${esc(f.text)}</span></div>` : `<div><span class="tm">${fmtTime(f.at)}</span><span>${esc(f.text)}</span></div>`).join('')}</div></section></div>
      <div class="panel" style="min-width:0;gap:16px">
        ${boardHTML(st, { title: 'The board · all games', eta: true })}
        <div class="qrline"><span class="qrbox">${S.qr ? `<img src="${S.qr}" alt="QR code to join the queue">` : ''}</span><span class="sign">Scan to put your name on the board</span></div>
        <section aria-label="Recent results" class="panel"><span class="label">Recent results</span><div class="results">${st.recent.slice(0, 5).map(r => `<div><span><b>${esc(r.winner)}</b> beat ${esc(r.loser)}</span><small>${esc(r.table)}${r.rated ? ' · +' + r.delta : ''}</small></div>`).join('')}</div></section>
      </div></div></div>`;
}

// ---------- shell ----------
function renderMode() {
  const b = $('#modeBtn');
  b.className = 'src' + (S.mode === 'live' ? (S.err ? ' err' : ' live') : '');
  b.textContent = S.mode === 'live' ? (S.err ? 'n8n unreachable' : 'Live from n8n') : 'Demo data';
}
function renderControls(st) {
  const ct = st && cameraTable(st), g = ct && ct.game, me = st && st.me;
  $('[data-act="shot"]').disabled = !(g && g.status === 'live' && g.shots.length < SCRIPT.length);
  $('[data-act="skipturn"]').disabled = !(me && me.status === 'waiting');
  $('[data-act="quick"]').disabled = !!(me && ['waiting', 'called', 'playing'].includes(me.status));
  const ab = $('#autoBtn'); ab.textContent = S.auto ? 'Pause auto-play' : 'Auto-play shots'; ab.classList.toggle('on', S.auto);
  if (st) $('#clock').textContent = fmtTime(st.now);
  if (S.lastEv) $('#evChip').textContent = 'Shot ' + S.lastEv.shotNo + (S.mode === 'live' ? ' sent to n8n' : ' (demo data, nothing sent)') + ': potted [' + S.lastEv.potted.join(', ') + '], first contact ' + S.lastEv.firstContact + (S.lastEv.confidence.firstContact ? ' (' + Math.round(S.lastEv.confidence.firstContact * 100) + '% sure)' : '') + (S.lastEv.cueBallPotted ? ', scratch' : '');
}
function render() {
  $$('.views a').forEach(a => { const on = a.dataset.view === S.view; a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  VIEWS.forEach(v => $('#v-' + v).classList.toggle('on', v === S.view));
  renderMode();
  const st = S.state; renderControls(st);
  if (!st) return;
  const v = S.view;
  if (v === 'presenter' || v === 'phone') renderPhone($('#v-' + v + ' [data-phone]'), st, v);
  if (v === 'presenter' || v === 'live') renderTV($('#v-' + v + ' [data-tv]'), st, v);
  if (v === 'presenter' || v === 'venue') renderVenue($('#v-' + v + ' [data-venue]'), st);
  if (v === 'venue') renderStaff(st);
  if (v === 'camera') { const el = $('#v-camera [data-camera]'); if (el && !el.dataset.mounted && window.CameraView) { el.dataset.mounted = '1'; window.CameraView.mount(el, { base: S.mode === 'live' ? S.base : '', table: 'T1', tables: () => ((S.state && S.state.tables) || []).map(t => ({ id: t.id, name: t.name, ref: t.ref })) }); } }
}
// ---------- staff tools on the counter tablet (start match, switch turn, foul, undo, next match, winner, group, clear) ----------
function renderStaff(st) {
  const t = st.tables.find(x => x.id === $('#sTable').value) || st.tables[0], g = t.game;
  const names = [t.challenger, t.champ].filter(Boolean).map(s => s.name), sig = names.join('|');
  [$('#sWho'), $('#sWho2')].forEach(sel => { if (sel.dataset.sig !== sig) { sel.innerHTML = names.map(n => `<option>${esc(n)}</option>`).join('') || '<option value="">No players</option>'; sel.dataset.sig = sig; } });
  const cam = g && g.mode === 'camera', live = cam && g.status === 'live', type = (g && g.gameType) || t.gameType, eight = type === '8-ball';
  // each tool is switched off when it cannot do anything on this table, and the line beside the table name says why
  let now;
  if (!g) now = (t.champ ? t.champ.name + ' holds the table' + (t.challenger ? ', ' + t.challenger.name + ' is checking in' : ', waiting for a challenger') : 'Free') + '. No game to fix.';
  else if (!cam) now = type + ' · ' + g.minutes + ' min in · no camera here, so staff can only declare the winner or clear the table.';
  else now = type + ' · ' + (g.shots.length ? 'shot ' + g.shots.length : 'no shots yet') + ' · ' + (g.turn ? t[g.turn].name + ' to shoot' + (g.ballInHand ? ' (ball in hand)' : '') : g.status === 'confirm' ? 'game over, players are confirming the result' : 'paused for a foul review: decide it on the table card above');
  $('#sNow').textContent = now;
  $('#sSwitch').disabled = $('#sFoul').disabled = !live;
  $('#sGrp').disabled = $('#sWho2').disabled = $('#sGroup').disabled = !(live && eight);
  $('#sGrp').title = live && !eight ? 'Solids and stripes only exist in 8-ball' : '';
  $('#sEnd').disabled = $('#sWho').disabled = !g;
  $('#sNext').disabled = !!g;
  $('#sUndo').disabled = !t.canUndo;
  $('#sClear').disabled = !g && !t.champ && !t.challenger;
}
// An in-app "are you sure?" that matches the other dialogs. Resolves true only when the action button is pressed
// (Esc and the other button both mean no). The safe button gets the focus.
function askConfirm(o) {
  const d = $('#confirmDlg');
  if (!d.showModal) return Promise.resolve(window.confirm(o.title + '\n\n' + o.text));   // browsers without <dialog>
  $('#cfTitle').textContent = o.title; $('#cfText').textContent = o.text;
  $('#cfNo').textContent = o.no; $('#cfYes').textContent = o.yes;
  d.returnValue = '';
  return new Promise(done => { d.addEventListener('close', () => done(d.returnValue === 'yes'), { once: true }); d.showModal(); $('#cfNo').focus(); });
}
async function staffAct(a) {
  const table = $('#sTable').value, tname = $('#sTable').selectedOptions[0].textContent.replace(/ \(.*$/, '');
  const t0 = S.state && S.state.tables.find(x => x.id === table), g0 = t0 && t0.game;
  const at0 = t0 ? [t0.challenger, t0.champ].filter(Boolean).map(x => x.name) : [];
  if (a === 'start') {
    const p1 = $('#sP1').value.trim(), p2 = $('#sP2').value.trim();
    if (!p1 || !p2) return toast('Type both player names first.');
    const params = { table, players: p1 + ',' + p2, gameType: $('#sGame').value };
    const replace = () => askConfirm({ title: 'Replace the game on ' + tname + '?', text: (at0.length === 2 ? at0.join(' and ') + ' are playing on ' + tname : 'A game is being played on ' + tname) + '. Starting ' + p1 + ' vs ' + p2 + ' ends that game with no winner. Undo last change brings it back.', yes: 'Start the new match', no: 'Keep the game' });
    if (g0 && g0.status !== 'confirm') { if (!await replace()) return; params.force = '1'; }
    let r = await act('start_match', params, true);
    if (r && !r.ok && r.code === 409 && !params.force) { if (!await replace()) return; params.force = '1'; r = await act('start_match', params, true); }   // a game started there after this screen last refreshed
    if (r && !r.ok) toast(r.error);
    if (r && r.ok) { $('#sP1').value = ''; $('#sP2').value = ''; toast(p1 + ' vs ' + p2 + ' started on ' + tname + '. ' + p1 + ' breaks.'); }
    return;
  }
  if (a === 'end') { const w = $('#sWho').value; if (!w) return toast('No players at this table.'); const r = await act('end_match', { table, winner: w }); if (r && r.ok) toast(w + ' wins on ' + tname + '.'); return; }
  if (a === 'group') { const w = $('#sWho2').value, grp = $('#sGroup').value; const r = await act('set_group', { table, player: w, group: grp }); if (r && r.ok) toast(w + ' now plays ' + grp + '.'); return; }
  if (a === 'reset_table' && !await askConfirm({ title: 'Clear ' + tname + '?', text: (g0 ? (at0.length === 2 ? at0.join(' and ') + '\u2019s game' : 'The game') + ' stops with no winner' : at0.join(' and ') + (at0.length === 1 ? ' leaves' : ' leave') + ' the table') + ', and the next people in the queue are called to ' + tname + '. Undo last change brings it back.', yes: 'Clear table', no: g0 ? 'Keep the game' : 'Leave it as it is' })) return;
  const r = await act(a, { table });
  if (!r || !r.ok) return;
  const t = r.tables.find(x => x.id === table), g = t && t.game, turn = g && g.turn && t[g.turn] ? t[g.turn].name : '';
  toast({ switch_turn: turn ? 'Turn switched: ' + turn + ' to shoot.' : 'Turn switched.', foul: turn ? 'Foul called. ' + turn + ' has ball in hand.' : 'Foul called.', undo: 'Last change on ' + tname + ' undone.', next_match: 'Next players called to ' + tname + '.', reset_table: tname + ' cleared.' }[a] || 'Done.');
}
// #tv = the bar TV on its own, full screen; #mobile = the player phone on its own. Neither shows the site header,
// the test buttons (Reset!) or the footer, so the QR code and emails link to #mobile.
function route() { const h0 = hashParts().view, h = h0 === 'tv' ? 'live' : h0 === 'mobile' ? 'phone' : h0; document.body.classList.toggle('kiosk', h0 === 'tv' || h0 === 'mobile' || h0 === 'camera'); document.body.classList.toggle('tvmode', h0 === 'tv'); if (h0 !== 'tv') document.body.classList.remove('tvfull'); S.view = VIEWS.includes(h) ? h : (window.innerWidth < 900 ? 'phone' : 'presenter'); render(); }

async function sendShot(silent) {
  const st = S.state, t = st && cameraTable(st), g = t && t.game;
  if (!g) { if (!silent) toast('No camera game yet. Press Quick start, or join and check in at Table 1.'); return; }
  if (g.status === 'review') { if (!silent) toast('Play is paused for the foul review. Decide on the phone.'); return; }
  if (g.status !== 'live') { if (!silent) toast('This game is over.'); return; }
  const ev = SCRIPT[g.shots.length];
  if (!ev) { if (!silent) toast('The recorded game has no more shots.'); return; }
  S.lastEv = ev; $('#evPre').textContent = JSON.stringify(ev, null, 2);
  await act('shot', { table: t.id, event: JSON.stringify(ev) });
}
async function quickStart() {
  const r = await act('join', { name: S.draft.name || 'Alex', email: S.draft.email, gameType: '8-ball', refOnly: true });
  if (!r || !r.ok) return;
  await act('skip'); const c = await act('checkin');
  if (c && c.ok) { S.auto = true; toast('You\'re at Table 1 against the table holder. Shots play automatically.'); renderControls(S.state); }
}

document.addEventListener('click', async e => {
  const a = e.target.closest('[data-act]'); if (!a || a.disabled) return;
  const x = a.dataset.act;
  if (x === 'openjoin') { S.joinOpen = true; if (S.state && S.state.me && S.state.me.status === 'left') S.ticket = null; S.sigs.clear(); render(); }
  else if (x === 'closejoin') { S.joinOpen = false; S.sigs.clear(); render(); }
  else if (x === 'leave') act('leave');
  else if (x === 'checkin') act('checkin');
  else if (x === 'flag') act('flag');
  else if (x === 'vote') act('vote', { vote: a.dataset.v });
  else if (x === 'confirm') act('confirm');
  else if (x === 'report') act('report', { result: a.dataset.v });
  else if (x === 'staff') act('staff', { table: a.dataset.t, decision: a.dataset.v });
  else if (x === 'ack') { S.ack[a.dataset.g] = true; render(); }
  else if (x === 'rejoin') { S.ticket = null; const r = await act('join', { name: S.draft.name || (S.state.me && S.state.me.name), email: S.draft.email, gameType: S.draft.gameType, refOnly: S.draft.refOnly }); if (r && r.ok) toast('Back on the board. Ticket ' + r.me.ticket); }
  else if (x === 'done') { S.ticket = null; S.joinOpen = false; if (S.mode === 'live') saveTicket(null); S.sigs.clear(); act('state'); }
  else if (x === 'ask') { const d = $('#askDlg'); if (d.showModal) { d.showModal(); setTimeout(() => $('#askInput').focus(), 50); } }
  else if (x === 'askclose') $('#askDlg').close();
  else if (x.startsWith('s-')) staffAct(x.slice(2));
  else if (x === 'quick') quickStart();
  else if (x === 'skip1') act('advance', { minutes: 1 });
  else if (x === 'skipturn') act('skip');
  else if (x === 'shot') sendShot();
  else if (x === 'auto') { S.auto = !S.auto; renderControls(S.state); if (S.auto) sendShot(true); }
  else if (x === 'reset') { S.auto = false; S.ack = {}; S.lastEv = null; S.ticket = null; S.joinOpen = false; S.sigs.clear(); S.tviews.forEach(v => { v.stop(); v.key = null; }); $('#evChip').textContent = 'No camera events yet'; await act('reset'); toast('Demo reset'); }
  else if (x === 'showev') { const d = $('#evDlg'); if (d.showModal) d.showModal(); }
  else if (x === 'settings') { $('#baseInput').value = S.base || 'http://localhost:5678/webhook'; $('#testRes').textContent = ''; const d = $('#settings'); if (d.showModal) d.showModal(); }
  else if (x === 'use-demo') { S.mode = 'demo'; S.err = null; S.ticket = null; store.set('mode', 'demo'); $('#settings').close(); S.sigs.clear(); await act('state'); toast('Using demo data in this browser'); }
  else if (x === 'connect') {
    const v = $('#baseInput').value.trim(), res = $('#testRes');
    try { new URL(v); } catch (err) { res.textContent = 'That isn\'t a full URL. It should start with http:// or https://'; return; }
    const prev = { mode: S.mode, base: S.base };
    S.mode = 'live'; S.base = v; res.textContent = 'Testing…';
    const r = await api('state');
    if (r) { store.set('mode', 'live'); store.set('base', v); S.ticket = loadTicket(); S.sigs.clear(); res.textContent = 'Connected.'; setTimeout(() => $('#settings').close(), 400); apply(r, true); toast('Connected to n8n'); }
    else { res.textContent = 'Couldn\'t reach n8n (' + S.err + '). Check the workflow is active. A published demo page can\'t call other servers, so open ' + v.replace(/\/+$/, '') + '/pool-app instead.'; S.mode = prev.mode; S.base = prev.base; S.err = null; renderMode(); }
  }
});
window.addEventListener('hashchange', route);
window.addEventListener('resize', () => { if (S.view === 'live' && S.state) fitTV($('#v-live [data-tv]')); });   // the TV canvas follows the screen size
$('#sTable').addEventListener('change', () => render());
// ---------- ask the referee (AI agent in n8n: house rules + the live board) ----------
async function askReferee(q) {
  const log = $('#askLog'), add = (cls, txt) => { const p = document.createElement('p'); p.className = cls; p.textContent = txt; log.appendChild(p); log.scrollTop = log.scrollHeight; return p; };
  add('q', q);
  if (S.mode !== 'live') { add('a', 'The AI referee is switched off in this demo. On the venue\'s own page it answers from the house rules and the live board.'); return; }
  const p = add('a wait', 'Thinking…');
  try {
    const u = new URL(S.base.replace(/\/+$/, '') + '/pool-ask');
    u.searchParams.set('q', q); if (S.ticket) u.searchParams.set('ticket', S.ticket);
    const r = await fetch(u, { cache: 'no-store' }); const j = await r.json();
    p.className = 'a'; p.textContent = (j && (j.answer || j.error)) || 'No answer this time. Try again.';
  } catch (e) { p.className = 'a'; p.textContent = 'The referee can\'t be reached right now.'; }
  log.scrollTop = log.scrollHeight;
}
$('#askForm').addEventListener('submit', e => { e.preventDefault(); const i = $('#askInput'), q = i.value.trim(); if (!q) return; i.value = ''; askReferee(q.slice(0, 200)); });
function makeQR() {
  try {
    if (!window.QRCode) return;
    const box = document.createElement('div');
    new QRCode(box, { text: location.href.split('#')[0] + '#mobile', width: 336, height: 336, colorDark: '#111111', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
    const c = box.querySelector('canvas'); S.qr = c ? c.toDataURL() : '';
  } catch (err) { S.qr = ''; }
}
makeQR();
route();
(async () => { apply(await api('state'), true); })();
// Every call to n8n is one execution, and n8n Cloud plans cap them (Starter: 2,500 a month).
// So a live page checks gently: every 4 s while something is happening (you're called or playing,
// or the board changed in the last minute), every 20 s when nothing is going on, never while the tab is hidden.
let lastSig = '', lastChange = Date.now();
const boardSig = r => JSON.stringify([r.queue.map(q => q.ticket + q.status), r.tables.map(t => [t.status, t.game && t.game.status, t.game && t.game.shots && t.game.shots.length, t.champ && t.champ.name, t.challenger && [t.challenger.name, t.challenger.present]]), r.feed[0] && r.feed[0].at]);
function pollDelay() {
  if (S.mode !== 'live') return 1000;
  const me = S.state && S.state.me;
  return (me && ['called', 'playing'].includes(me.status)) || Date.now() - lastChange < 60000 ? 4000 : 20000;
}
async function poll() {
  if (!document.hidden && !S.busy) {
    const r = await api('state');
    if (r) { const sig = boardSig(r); if (sig !== lastSig) { lastSig = sig; lastChange = Date.now(); } apply(r, true); }
  }
  setTimeout(poll, pollDelay());
}
setTimeout(poll, pollDelay());
document.addEventListener('visibilitychange', async () => { if (!document.hidden && S.mode === 'live' && !S.busy) { lastChange = Date.now(); const r = await api('state'); if (r) apply(r, true); } });
setInterval(() => { if (S.mode === 'live' && S.state && !document.hidden) render(); }, 1000);   // countdowns tick between checks
setInterval(() => { if (S.auto && !S.busy) { const t = S.state && cameraTable(S.state), g = t && t.game; if (g && g.status === 'live') sendShot(true); else if (g && g.status === 'confirm') { S.auto = false; renderControls(S.state); } } }, 2600);
