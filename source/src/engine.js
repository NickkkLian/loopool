// ===== Pool Referee engine. The same code runs in the browser demo and inside the n8n workflow. =====
const RULES = { maxWins: 3, checkinSec: 180, simCheckinSec: 40, simVoteSec: 3, simConfirmSec: 3, avgGameMin: { '8-ball': 14, '9-ball': 11, '10-ball': 12 }, k: 32, startRating: 1200, games: ['8-ball', '9-ball', '10-ball'], aiReviewBelow: 0.6, undoDepth: 8 };
// Balls on the table at the start of each game type.
const BALLS = gt => Array.from({ length: gt === '9-ball' ? 9 : gt === '10-ball' ? 10 : 15 }, (_, i) => i + 1);
const TABLE = { W: 1000, H: 500, R: 11, pockets: [[0, 0], [500, -6], [1000, 0], [0, 500], [500, 506], [1000, 500]] };
const MIN = 60000;
// A table has a camera while a camera page is running for it: the page names its tables on every state poll
// (?cams=T1,T2), so a camera counts as gone once it has not reported for CAM_TTL. Table 1 (t.ref) always has one.
const CAM_TTL = MIN, CAM_SAVE_EVERY = 20000;
function camOn(t, now) { return !!t.camAt && now - t.camAt < CAM_TTL; }
function refereed(t, now) { return !!t.ref || camOn(t, now); }
function groupOf(b) { b = Number(b); return b === 8 ? 'eight' : b < 8 ? 'solids' : 'stripes'; }
function otherSide(s) { return s === 'champ' ? 'challenger' : 'champ'; }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function clone(o) { return JSON.parse(JSON.stringify(o)); }

function rackPositions() {
  const R = TABLE.R, rows = [[1], [10, 2], [3, 8, 11], [12, 5, 13, 4], [6, 14, 7, 15, 9]];
  const pos = { cue: [250, 250] };
  rows.forEach((row, i) => row.forEach((b, j) => { pos[b] = [Math.round(750 + i * (2 * R * 0.87 + 0.6)), Math.round(250 + (j - i / 2) * (2 * R + 0.8))]; }));
  return pos;
}

function seedState(now) {
  const P = (name, rating, w, l) => ({ name, rating, w, l });
  const seat = (pid, name) => ({ pid, name, ticket: null, real: false, present: true });
  return {
    v: 1, skew: 0, seq: 101, createdAt: now, flags: {},
    venue: { name: 'Loopool', note: 'Demo venue · fake players' },
    players: {
      p_sam: P('Sam', 1340, 18, 9), p_lee: P('Lee', 1255, 11, 10), p_ana: P('Ana', 1410, 24, 8), p_kai: P('Kai', 1175, 6, 9),
      p_noor: P('Noor', 1305, 15, 11), p_jules: P('Jules', 1230, 9, 9), p_kim: P('Kim', 1265, 12, 10), p_ravi: P('Ravi', 1190, 7, 9),
      p_priya: P('Priya', 1190, 5, 6), p_diego: P('Diego', 1280, 13, 10),
    },
    tables: [
      { id: 'T1', name: 'Table 1', ref: true, gameType: '8-ball', champ: seat('p_sam', 'Sam'), challenger: seat('p_lee', 'Lee'), streak: 1, game: { id: 'g1', mode: 'sim', rated: true, startedAt: now - 9 * MIN, endsAt: now + 5 * MIN, simWinner: 'champ' } },
      { id: 'T2', name: 'Table 2', ref: false, gameType: '9-ball', champ: seat('p_ana', 'Ana'), challenger: seat('p_kai', 'Kai'), streak: 2, game: { id: 'g2', mode: 'sim', rated: false, startedAt: now - 4 * MIN, endsAt: now + 16 * MIN, simWinner: 'champ' } },
      { id: 'T3', name: 'Table 3', ref: false, gameType: '8-ball', champ: seat('p_noor', 'Noor'), challenger: seat('p_jules', 'Jules'), streak: 1, game: { id: 'g3', mode: 'sim', rated: false, startedAt: now - 12 * MIN, endsAt: now + 3 * MIN, simWinner: 'challenger' } },
      { id: 'T4', name: 'Table 4', ref: false, gameType: '9-ball', champ: seat('p_kim', 'Kim'), challenger: seat('p_ravi', 'Ravi'), streak: 1, game: { id: 'g4', mode: 'sim', rated: false, startedAt: now - 2 * MIN, endsAt: now + 22 * MIN, simWinner: 'champ' } },
    ],
    queue: [{ ticket: 'A101', pid: 'p_priya', name: 'Priya', gameType: '8-ball', refOnly: false, real: false, status: 'waiting', joinedAt: now - 4 * MIN }],
    scheduled: [],
    history: [
      { at: now - 21 * MIN, table: 'Table 1', winner: 'Sam', loser: 'Ana', rated: true, delta: 19 },
      { at: now - 34 * MIN, table: 'Table 1', winner: 'Ana', loser: 'Kim', rated: true, delta: 12 },
    ],
    feed: [{ at: now - 60000, kind: 'table', text: 'Sam and Lee are playing a rated game on Table 1' }],
    outbox: [],
  };
}

function log(S, now, kind, text, ref) { S.feed.push(Object.assign({ at: now, kind, text }, ref || {})); if (S.feed.length > 40) S.feed.splice(0, S.feed.length - 40); }
// A message to one player. n8n emails it when the player gave an address. Buttons become links back to n8n
// ({base}/pool-act?a=checkin&t=A102&k=key), so players can check in, vote on a foul or confirm a result from the email.
// The key is per ticket and never leaves the server except inside that player's own emails.
const LINK_ACTIONS = ['checkin', 'vote', 'confirm', 'leave'];
function actLink(S, q, action, vote) { return (S.base || '') + '/pool-act?a=' + action + '&t=' + encodeURIComponent(q.ticket) + '&k=' + q.key + (vote ? '&v=' + vote : ''); }
function text(S, now, ticket, msg, notes, opts) {
  const q = S.queue.find(x => x.ticket === ticket); if (!q || !q.real) return;
  opts = opts || {};
  const n = { at: now, ticket, name: q.name, email: q.email || '', subject: opts.subject || msg, text: msg,
    buttons: (opts.buttons || []).map(b => ({ label: b[0], url: actLink(S, q, b[1], b[2]), style: b[3] || '' })),
    page: (S.base || '') + '/pool-app#mobile&t=' + encodeURIComponent(q.ticket) };
  S.outbox.push({ at: n.at, ticket, text: msg }); if (S.outbox.length > 40) S.outbox.splice(0, S.outbox.length - 40);
  if (q.email) notes.push(n);
}
function textSeats(S, t, now, notes, msgFor, opts) {
  ['champ', 'challenger'].forEach(side => { const s = t[side]; if (s && s.ticket) text(S, now, s.ticket, msgFor(side), notes, typeof opts === 'function' ? opts(side) : opts); });
}
function eligible(q, t) { return q.status === 'waiting' && q.gameType === t.gameType && (!q.refOnly || t.ref); }
function seatFromTicket(q, now) { return { pid: q.pid, name: q.name, ticket: q.ticket, real: !!q.real, present: false, calledAt: now }; }

// Player stats (shots scored by the AI, fouls, best shot) for the leaderboard and badges.
function stat(S, pid) { const p = S.players[pid]; if (!p) return null; if (p.shots == null) Object.assign(p, { shots: 0, scoreSum: 0, fouls: 0, best: 0 }); return p; }
function findPid(S, name, create) {
  const n = String(name || '').trim().replace(/\s+/g, ' ').slice(0, 24); if (!n) return null;
  let pid = Object.keys(S.players).find(k => S.players[k].name.toLowerCase() === n.toLowerCase());
  if (!pid && create) { pid = 'p_' + n.toLowerCase().replace(/[^a-z0-9]+/g, '') + '_' + (++S.seq); S.players[pid] = { name: n, rating: RULES.startRating, w: 0, l: 0 }; }
  return pid;
}
// Rating change: Elo with K = 48 for a player's first 5 matches, then 32, times a margin
// multiplier (1 + 0.05 x balls the loser still had), plus up to +-5 from the player's average AI shot score this game.
function ratingChange(S, g, W, L, loserLeft) {
  const pw = S.players[W.pid], pl = S.players[L.pid];
  const E = 1 / (1 + Math.pow(10, (pl.rating - pw.rating) / 400));
  const mult = 1 + 0.05 * Math.max(0, Math.min(7, loserLeft || 0));
  const perf = side => { const ss = (g.shots || []).filter(s => s.side === side && s.score != null); return ss.length ? ss.reduce((a, s) => a + s.score, 0) / ss.length : 50; };
  const bonus = v => Math.max(-5, Math.min(5, (v - 50) / 10));
  const K = p => ((p.w || 0) + (p.l || 0)) < 5 ? 48 : 32;
  return { dW: Math.round(K(pw) * (1 - E) * mult + bonus(perf(W.side))), dL: Math.round(-K(pl) * (1 - E) * mult + bonus(perf(L.side))) };
}

function startGame(S, t, now) {
  const real = t.champ.real || t.challenger.real || t.champ.staff || t.challenger.staff;   // staff-started matches are played for real too
  const mode = refereed(t, now) && real ? 'camera' : real ? 'manual' : 'sim';   // any table with a running camera is refereed; only Table 1 is rated
  const id = 'g' + (++S.seq);
  const g = { id, mode, rated: t.ref, startedAt: now, status: 'live' };
  if (mode === 'sim') {
    const h = hashStr(t.champ.pid + t.challenger.pid + id);
    g.endsAt = now + (RULES.avgGameMin[t.gameType] - 3 + (h % 7)) * MIN;
    const rc = (S.players[t.champ.pid] || {}).rating || 1200, rh = (S.players[t.challenger.pid] || {}).rating || 1200;
    g.simWinner = (h % 100) < 100 / (1 + Math.pow(10, (rh - rc) / 400)) ? 'champ' : 'challenger';
  }
  if (mode === 'camera') {
    Object.assign(g, { gameType: t.gameType, turn: t.breaker || 'challenger', groups: { champ: null, challenger: null }, onTable: BALLS(t.gameType), positions: t.gameType === '8-ball' ? rackPositions() : null, lastShot: null, shots: [], review: null, ballInHand: false, winner: null, confirm: {} });
  }
  if (mode === 'manual') Object.assign(g, { winner: null, confirm: {} });
  t.game = g; delete t.breaker;
  [t.champ, t.challenger].forEach(s => { const q = S.queue.find(x => x.ticket === s.ticket); if (q) q.status = 'playing'; });
  log(S, now, 'table', t.champ.name + ' vs ' + t.challenger.name + ' started on ' + t.name + (mode === 'camera' ? ' (camera referee)' : ''));
}

function finishGame(S, t, winSide, now, notes, reason) {
  const g = t.game, W = Object.assign({ side: winSide }, t[winSide]), L = Object.assign({ side: otherSide(winSide) }, t[otherSide(winSide)]);
  let delta = 0, lossDelta = 0;
  if (g.rated && S.players[W.pid] && S.players[L.pid]) {
    const lg = g.groups && g.groups[L.side];
    const loserLeft = g.mode === 'camera' && (g.gameType || t.gameType) === '8-ball' ? (lg ? g.onTable.filter(b => groupOf(b) === lg).length : 7) : 0;
    const r = ratingChange(S, g, W, L, loserLeft);
    delta = r.dW; lossDelta = r.dL;
    S.players[W.pid].rating += delta; S.players[L.pid].rating += lossDelta; S.players[W.pid].w++; S.players[L.pid].l++;
  }
  S.finished = (S.finished || 0) + 1;
  S.history.unshift({ at: now, table: t.name, winner: W.name, loser: L.name, rated: g.rated, delta, lossDelta, reason: reason || '' });
  if (S.history.length > 20) S.history.length = 20;
  t.streak = winSide === 'champ' ? t.streak + 1 : 1;
  log(S, now, 'result', W.name + ' beat ' + L.name + ' on ' + t.name + (g.rated ? ' (+' + delta + ' rating)' : '') + (reason ? ' · ' + reason : ''));
  const lq = S.queue.find(x => x.ticket === L.ticket);
  if (lq) { lq.status = 'done'; lq.result = { won: false, gameId: g.id, opponent: W.name, delta: lossDelta, rated: g.rated, rating: (S.players[L.pid] || {}).rating, table: t.name }; text(S, now, lq.ticket, 'Good game! ' + W.name + ' won on ' + t.name + (g.rated ? ' (' + lossDelta + ' rating)' : '') + '. Want another? Put your name back on the board.', notes, { subject: 'Good game on ' + t.name }); }
  const wq = S.queue.find(x => x.ticket === W.ticket);
  if (wq) { wq.result = { won: true, gameId: g.id, opponent: L.name, delta, rated: g.rated, rating: (S.players[W.pid] || {}).rating, table: t.name, streak: t.streak, stayOn: true }; text(S, now, wq.ticket, 'You beat ' + L.name + ' on ' + t.name + (g.rated ? ' (+' + delta + ' rating, now ' + wq.result.rating + ')' : '') + '. Winner stays on, so the table is yours for the next game.', notes, { subject: 'You won on ' + t.name }); }
  t.champ = Object.assign({}, W, { present: true });
  t.challenger = null; t.lastGame = { id: g.id, winner: W.name, loser: L.name, at: now };
  t.game = null;
  const waiting = S.queue.some(q => eligible(q, t));
  if (t.streak >= RULES.maxWins && waiting) {
    log(S, now, 'table', W.name + ' won ' + t.streak + ' in a row and hands over ' + t.name + ' (house rule: max ' + RULES.maxWins + ')');
    if (wq) { wq.status = 'done'; wq.result.stayOn = false; wq.result.retired = true; text(S, now, wq.ticket, 'You won ' + t.streak + ' in a row. House rule: the table goes to the next players now. Nice run!', notes); }
    t.champ = null; t.streak = 0;
  }
}

function resolveReview(S, t, decision, now, by) {
  const g = t.game, r = g.review; if (!r) return;
  const shot = g.shots.find(s => s.no === r.shotNo);
  if (decision === 'foul') {
    g.turn = r.ifFoul; g.ballInHand = true;
    if (shot) { shot.fouls.push(r.foul.text + ' (confirmed' + (by ? ' by ' + by : '') + ')'); shot.possible = []; }
    log(S, now, 'foul', 'Foul confirmed on shot ' + r.shotNo + ': ' + r.foul.text + '. ' + t[r.ifFoul].name + ' has ball in hand');
  } else {
    g.turn = r.ifClean;
    if (shot) { shot.possible = []; shot.cleared = true; }
    log(S, now, 'foul', 'No foul on shot ' + r.shotNo + (by ? ' (' + by + ')' : '') + '. ' + t[r.ifClean].name + ' to shoot');
  }
  g.status = 'live'; g.review = null;
}

function settle(S, now, notes) {
  for (let guard = 0, changed = true; changed && guard < 30; guard++) {
    changed = false;
    // scheduled walk-ins
    S.scheduled.filter(e => e.at <= now).forEach(e => {
      if (e.type === 'join' && !S.queue.some(q => q.pid === e.pid && ['waiting', 'called', 'playing'].includes(q.status))) {
        S.queue.push({ ticket: 'A' + (++S.seq), pid: e.pid, name: e.name, gameType: e.gameType, refOnly: e.refOnly, real: false, status: 'waiting', joinedAt: now });
        log(S, now, 'queue', e.name + ' joined the queue (' + e.gameType + (e.refOnly ? ', camera table only' : '') + ')');
      }
      changed = true;
    });
    S.scheduled = S.scheduled.filter(e => e.at > now);
    for (const t of S.tables) {
      const g = t.game;
      if (g && g.mode === 'sim' && g.endsAt <= now) { finishGame(S, t, g.simWinner, now, notes); changed = true; continue; }
      if (g && g.status === 'review' && g.review) {
        for (const side of ['champ', 'challenger']) {
          if (!t[side].real && !t[side].staff && !g.review.votes[side] && now - g.review.at >= RULES.simVoteSec * 1000) {
            g.review.votes[side] = g.review.source === 'player' && g.review.accused === side ? 'dispute' : 'accept';
            log(S, now, 'foul', t[side].name + (g.review.votes[side] === 'accept' ? ' accepted' : ' disputed') + ' the foul call');
            changed = true;
          }
        }
        const v = g.review.votes;
        if (v.champ && v.challenger && !g.review.staff) {
          if (v.champ === v.challenger) resolveReview(S, t, v.champ === 'accept' ? 'foul' : 'clean', now, 'both players');
          else { g.review.staff = true; log(S, now, 'staff', 'Players disagree on shot ' + g.review.shotNo + ' on ' + t.name + '. Staff decision needed', { table: t.id, game: g.id, shot: g.review.shotNo }); }   // the counter tablet shows this in red until staff decide
          changed = true;
        }
      }
      if (g && g.status === 'confirm') {
        for (const side of ['champ', 'challenger']) {
          if (!t[side].real && !g.confirm[side] && now - g.confirmAt >= RULES.simConfirmSec * 1000) { g.confirm[side] = true; changed = true; }
        }
        if (g.confirm.champ && g.confirm.challenger) { finishGame(S, t, g.winner, now, notes, g.winReason); changed = true; continue; }
      }
      if (!t.game) {
        for (const side of ['champ', 'challenger']) {
          const s = t[side];
          if (!s) continue;
          if (!s.present && !s.real && now - s.calledAt >= RULES.simCheckinSec * 1000) { s.present = true; log(S, now, 'queue', s.name + ' checked in at ' + t.name); changed = true; }
          if (!s.present && s.real && now - s.calledAt >= RULES.checkinSec * 1000) {
            const q = S.queue.find(x => x.ticket === s.ticket);
            if (q) { q.status = 'missed'; text(S, now, q.ticket, 'You missed your turn at ' + t.name + ', so the next name on the board was called. Put your name back on the board any time.', notes, { subject: 'You missed your turn at ' + t.name }); }
            log(S, now, 'queue', s.name + ' missed the check-in for ' + t.name);
            t[side] = null; changed = true;
          }
        }
        if (!t.champ && t.challenger) { t.champ = t.challenger; t.challenger = null; t.streak = 0; changed = true; }
        for (const side of ['champ', 'challenger']) {
          if (t[side]) continue;
          const q = S.queue.find(x => eligible(x, t));
          if (!q) break;
          q.status = 'called'; q.table = t.id; q.calledAt = now; q.seat = side;
          t[side] = seatFromTicket(q, now);
          log(S, now, 'queue', q.name + ' was called to ' + t.name);
          text(S, now, q.ticket, 'It\'s your turn! Go to ' + t.name + ' and check in within ' + Math.round(RULES.checkinSec / 60) + ' minutes, or the next name on the board is called.', notes, { subject: 'Your table is ready: ' + t.name, buttons: [['I\'m at the table', 'checkin']] });
          changed = true;
        }
        if (t.champ && t.challenger && t.champ.present && t.challenger.present) { startGame(S, t, now); changed = true; }
      }
    }
  }
}

function applyShot(S, t, ev, now, notes) {
  notes = notes || [];
  const g = t.game;
  if (!g || g.mode !== 'camera') return 'The camera is not following a game on ' + t.name + ' right now.';
  if (g.status === 'review') return 'Waiting for the foul review on shot ' + g.review.shotNo + '.';
  if (g.status !== 'live') return 'This game is over.';
  const gt = g.gameType || t.gameType || '8-ball', eightBall = gt === '8-ball';
  const side = g.turn, other = otherSide(side), nm = s => t[s].name;
  const before = g.onTable.slice();
  let potted = (ev.potted || []).map(Number).filter(b => before.includes(b));
  const mine = eightBall ? g.groups[side] : null;
  const leftBefore = mine ? before.filter(b => groupOf(b) === mine).length : null;
  const fouls = [], possible = [];
  const ai = ev.ai || null;                                   // the AI's reading of the shot photos
  const reviewBelow = ai ? RULES.aiReviewBelow : 0.8;
  const fcUnknown = ev.firstContact === 'unknown';            // the photos don't show which ball was hit first
  const fc = fcUnknown || ev.firstContact == null || ev.firstContact === '' ? null : Number(ev.firstContact);
  const isBreak = g.shots.length === 0;
  if (fc == null && !fcUnknown) fouls.push({ code: 'no-contact', text: 'Cue ball didn\'t hit any ball' });
  if (ev.cueBallPotted) fouls.push({ code: 'scratch', text: 'Scratch: the cue ball went in a pocket' });
  if (eightBall && fc != null && !isBreak) {                  // on the break any ball may be hit first
    const legal = mine ? (leftBefore > 0 ? groupOf(fc) === mine : fc === 8) : fc !== 8;
    if (!legal) {
      const conf = ev.confidence && ev.confidence.firstContact != null ? Number(ev.confidence.firstContact) : 0.95;
      (conf < reviewBelow ? possible : fouls).push({ code: 'wrong-ball', text: nm(side) + ' hit the ' + fc + ' first', conf });
    }
  }
  if (ai && ai.foul && !fouls.length && !possible.length) {  // a foul only the AI saw in the photos
    const conf = ai.confidence == null ? 0.95 : Number(ai.confidence);
    (conf < reviewBelow ? possible : fouls).push({ code: 'ai', text: ai.foulReason || 'Foul seen by the AI referee', conf });
  }
  const money = gt === '9-ball' ? 9 : gt === '10-ball' ? 10 : 8;
  const respot = !eightBall && potted.includes(money) && (fouls.length || possible.length);
  if (respot) potted = potted.filter(b => b !== money);       // 9/10-ball: the money ball potted on a foul comes back
  g.onTable = before.filter(b => !potted.includes(b));
  const from = g.positions;
  g.positions = ev.positions || (ai ? null : g.positions);    // the AI method sends photos, not ball positions
  g.lastShot = { no: g.shots.length + 1, cuePath: ev.cuePath || null, pockets: ev.pockets || {}, from };
  const shot = { no: g.shots.length + 1, side, shooter: nm(side), potted, firstContact: fc, scratch: !!ev.cueBallPotted, fouls: fouls.map(f => f.text), possible: possible.map(f => f.text + ' (' + Math.round(f.conf * 100) + '% sure)'), at: now, clip: ev.clip ? String(ev.clip).slice(0, 60) : null };
  if (ai) Object.assign(shot, { score: ai.score, grade: ai.grade, tip: ai.tip || '', observations: ai.observations || '', breakdown: ai.breakdown || null, confidence: ai.confidence, needsReview: !!ai.needsReview, ai: ai.observations ? String(ai.observations).slice(0, 240) : null });
  const lines = [];
  const confirmFlow = (winner, why) => {
    g.winner = winner; g.winReason = why; g.status = 'confirm'; g.confirmAt = now; g.confirm = {}; g.turn = null;
    lines.push('Shot ' + shot.no + ': ' + why + '. ' + nm(winner) + ' wins! Waiting for both players to confirm.');
    textSeats(S, t, now, notes, s => why + '. ' + (s === winner ? 'You win!' : nm(winner) + ' wins.') + ' Confirm the result so the ratings update.', { subject: 'Game over on ' + t.name + ': please confirm', buttons: [['Confirm result', 'confirm']] });
  };
  if (eightBall && potted.includes(8) && !isBreak) {
    const cleared = mine && leftBefore === 0;
    const ok = cleared && !fouls.length && !possible.length;
    confirmFlow(ok ? side : other, ok ? nm(side) + ' potted the 8' : (cleared ? nm(side) + ' fouled on the 8' : nm(side) + ' potted the 8 too early'));
  } else if (!eightBall && potted.includes(money)) {
    confirmFlow(side, nm(side) + ' potted the ' + money);
  } else {
    if (eightBall && !mine && !fouls.length && !possible.length && potted.length && !isBreak) {
      // open table: the first legal pot after the break sets the groups (majority if both kinds went down)
      const s1 = potted.filter(b => groupOf(b) === 'solids').length, s2 = potted.filter(b => groupOf(b) === 'stripes').length;
      if (s1 || s2) { const grp = s1 >= s2 ? 'solids' : 'stripes'; g.groups[side] = grp; g.groups[other] = grp === 'solids' ? 'stripes' : 'solids'; shot.note = nm(side) + ' takes ' + grp; lines.push(nm(side) + ' takes ' + grp); }
    }
    const own = eightBall ? (g.groups[side] ? potted.some(b => groupOf(b) === g.groups[side]) : potted.length > 0) : potted.length > 0;
    const desc = 'Shot ' + shot.no + ' · ' + nm(side) + (potted.length ? ' potted ' + potted.join(' and ') : ' missed') + (respot ? ' (the ' + money + ' comes back on a foul)' : '');
    if (possible.length) {
      g.status = 'review';
      g.review = { shotNo: shot.no, side, accused: side, source: 'ai', foul: possible[0], threshold: reviewBelow, ball: fc, clip: shot.clip, votes: {}, at: now, staff: false, ifFoul: other, ifClean: own && !fouls.length ? side : other, replay: { from, to: g.positions, cuePath: g.lastShot.cuePath, pockets: g.lastShot.pockets, highlight: fc } };
      g.turn = null;
      lines.unshift(desc);
      lines.push('Possible foul: ' + possible[0].text + ' (' + Math.round(possible[0].conf * 100) + '% sure). Play paused for review.');
      textSeats(S, t, now, notes, () => 'Possible foul on shot ' + shot.no + ': ' + possible[0].text + ' (the camera is ' + Math.round(possible[0].conf * 100) + '% sure). Play is paused until you both decide. ' + (ai ? 'Open your ticket to see the camera photo' : 'Watch the replay on your phone') + ', or answer here.', { subject: 'Possible foul on ' + t.name + ', shot ' + shot.no, buttons: [['Foul', 'vote', 'accept', 'foul'], ['No foul', 'vote', 'dispute']] });
    } else if (fouls.length) {
      g.turn = other; g.ballInHand = true;
      lines.unshift(desc);
      lines.push('Foul: ' + fouls.map(f => f.text).join(', ') + '. ' + nm(other) + ' has ball in hand.');
    } else {
      g.turn = own ? side : other; g.ballInHand = false;
      lines.unshift(desc + (own ? '. Still shooting' : '. ' + nm(other) + ' to shoot'));
    }
  }
  shot.reason = lines.join(' · ');
  g.lastReason = shot.reason;
  g.shots.push(shot);
  if (ai && ai.score != null) { const st = stat(S, t[side].pid); if (st) { st.shots++; st.scoreSum += Number(ai.score) || 0; st.best = Math.max(st.best, Number(ai.score) || 0); if (fouls.length) st.fouls++; } }
  lines.forEach(l => log(S, now, possible.length || fouls.length ? 'foul' : 'shot', t.name + ' · ' + l));
  if (shot.ai) log(S, now, 'ai', t.name + ' · ' + shot.ai);
  return null;
}

function findTicket(S, ticket) { return S.queue.find(q => q.ticket === ticket); }
function tableOf(S, q) { return q && q.table ? S.tables.find(t => t.id === q.table) : null; }
function sideOf(t, q) { if (!t || !q) return null; if (t.champ && t.champ.ticket === q.ticket) return 'champ'; if (t.challenger && t.challenger.ticket === q.ticket) return 'challenger'; return null; }

function etas(S, now) {
  const free = {};
  S.tables.forEach(t => {
    const avg = RULES.avgGameMin[t.gameType] * MIN;
    if (t.game) free[t.id] = t.game.mode === 'sim' ? t.game.endsAt : Math.max(now + 2 * MIN, t.game.startedAt + avg);
    else free[t.id] = t.champ && t.challenger ? now + 2 * MIN : now;
  });
  const out = {};
  S.queue.filter(q => q.status === 'waiting').forEach(q => {
    const cands = S.tables.filter(t => t.gameType === q.gameType && (!q.refOnly || t.ref));
    if (!cands.length) { out[q.ticket] = null; return; }
    let best = cands[0]; cands.forEach(t => { if (free[t.id] < free[best.id]) best = t; });
    out[q.ticket] = { min: Math.max(0, Math.round((free[best.id] - now) / MIN)), table: best.name };
    free[best.id] += RULES.avgGameMin[best.gameType] * MIN;
  });
  return out;
}

function publicState(S, now, ticket) {
  const E = etas(S, now);
  const rating = pid => (S.players[pid] || {}).rating || RULES.startRating;
  const seatPub = (s, t, side) => s ? { name: s.name, rating: rating(s.pid), present: !!s.present, real: !!s.real, ticket: s.ticket ? s.ticket : null, checkinLeft: !s.present && s.calledAt ? Math.max(0, Math.round(((s.real ? RULES.checkinSec : RULES.simCheckinSec) * 1000 - (now - s.calledAt)) / 1000)) : null, streak: side === 'champ' ? t.streak : 0 } : null;
  const tables = S.tables.map(t => {
    const g = t.game;
    let status = 'empty';
    if (g) status = g.status === 'review' ? (g.review && g.review.staff ? 'staff' : 'review') : g.status === 'confirm' ? 'confirm' : 'playing';
    else if (t.champ && t.challenger) status = 'checkin';
    else if (t.champ) status = 'waiting';
    const pub = { id: t.id, name: t.name, ref: t.ref, camera: refereed(t, now), gameType: t.gameType, status, streak: t.streak, champ: seatPub(t.champ, t, 'champ'), challenger: seatPub(t.challenger, t, 'challenger'), lastGame: t.lastGame || null, frameAt: t.frameAt || null, practice: t.practice || null, canUndo: !!(S.undo && S.undo[t.id] && S.undo[t.id].length) };
    if (g) {
      pub.game = { id: g.id, mode: g.mode, rated: g.rated, startedAt: g.startedAt, minutes: Math.max(0, Math.round((now - g.startedAt) / MIN)), left: g.mode === 'sim' ? Math.max(1, Math.round((g.endsAt - now) / MIN)) : null, status: g.status };
      if (g.mode === 'camera') Object.assign(pub.game, { gameType: g.gameType || t.gameType, lastReason: g.lastReason || '', turn: g.turn, groups: g.groups, onTable: g.onTable, positions: g.positions, lastShot: g.lastShot, shots: g.shots.slice(-14), review: g.review, ballInHand: g.ballInHand, winner: g.winner, winReason: g.winReason || '', confirm: g.confirm });
      if (g.mode === 'manual') Object.assign(pub.game, { winner: g.winner, confirm: g.confirm });
    }
    return pub;
  });
  const waiting = S.queue.filter(q => q.status === 'waiting' || q.status === 'called');
  const queue = waiting.map(q => ({ ticket: q.ticket, name: q.name, gameType: q.gameType, refOnly: q.refOnly, status: q.status, table: q.table ? (S.tables.find(t => t.id === q.table) || {}).name : null, eta: E[q.ticket] || null, position: q.status === 'waiting' ? S.queue.filter(x => x.status === 'waiting').indexOf(q) + 1 : 0 }));
  // Leaderboard with shot stats and badges: sharpshooter (best average shot, 5+ shots), fair play (fewest fouls per shot, 5+ shots), best shot (85+).
  const leaderboard = Object.entries(S.players).map(([pid, p]) => ({ pid, name: p.name, rating: p.rating, w: p.w, l: p.l, matches: (p.w || 0) + (p.l || 0), winRate: (p.w || 0) + (p.l || 0) ? Math.round(100 * (p.w || 0) / ((p.w || 0) + (p.l || 0))) : null, shots: p.shots || 0, avgShot: p.shots ? Math.round(p.scoreSum / p.shots) : null, fouls: p.fouls || 0, best: p.best || 0, badges: [] }));
  const top = (f, ok) => leaderboard.filter(ok).sort((a, b) => f(b) - f(a))[0];
  const sharp = top(r => r.avgShot, r => r.shots >= 5); if (sharp) sharp.badges.push('sharpshooter');
  const fair = top(r => -r.fouls / r.shots, r => r.shots >= 5); if (fair) fair.badges.push('fair_play');
  const bestShot = top(r => r.best, r => r.shots >= 1); if (bestShot && bestShot.best >= 85) bestShot.badges.push('best_shot');
  leaderboard.sort((a, b) => b.rating - a.rating); leaderboard.length = Math.min(leaderboard.length, 10);
  const out = { ok: true, now, venue: S.venue, rules: { maxWins: RULES.maxWins, checkinSec: RULES.checkinSec }, tables, queue, leaderboard, recent: S.history.slice(0, 6), feed: S.feed.slice(-14).reverse() };
  const q = ticket ? findTicket(S, ticket) : null;
  if (q) {
    const t = tableOf(S, q), side = sideOf(t, q);
    out.me = { ticket: q.ticket, name: q.name, pid: q.pid, emailOn: !!q.email, gameType: q.gameType, refOnly: q.refOnly, status: q.status, rating: rating(q.pid), position: q.status === 'waiting' ? S.queue.filter(x => x.status === 'waiting').indexOf(q) + 1 : 0, eta: E[q.ticket] || null, table: t ? t.id : null, side, result: q.result || null, texts: S.outbox.filter(n => n.ticket === q.ticket).slice(-4).reverse().map(n => ({ at: n.at, text: n.text })) };
  }
  return out;
}

// ---- AI shot reading -> engine ----
// The AI names balls like "solid 3", "stripe ?", "8 ball", "cue ball". Unknown numbers take the lowest ball of that kind still on the table.
function ballsFromAI(list, onTable, gt) {
  const out = [], left = onTable.slice(); let scratch = false;
  const take = n => { const i = left.indexOf(n); if (i >= 0) { left.splice(i, 1); out.push(n); } };
  for (const raw of list || []) {
    const t = String(raw).toLowerCase(), m = t.match(/\b(1[0-5]|[1-9])\b/), n = m ? +m[1] : null;
    if (n === null && /cue|white/.test(t)) { scratch = true; continue; }
    if (n !== null) { take(n); continue; }
    if (gt === '8-ball') {
      if (/eight|black/.test(t)) take(8);
      else if (/stripe/.test(t)) { const b = left.filter(x => x > 8).sort((a, c) => a - c)[0]; if (b) take(b); }
      else if (/solid/.test(t)) { const b = left.filter(x => x < 8).sort((a, c) => a - c)[0]; if (b) take(b); }
    }
  }
  return { potted: out, scratch };
}
function firstBallFromAI(v) { if (v == null) return 'unknown'; const m = String(v).match(/\b(1[0-5]|[1-9])\b/); return m ? +m[1] : (/eight|black/i.test(v) ? 8 : 'unknown'); }

// ---- staff tools: undo keeps snapshots of the table, players, results and queue (newest last) ----
function pushUndo(S, t) {
  S.undo = S.undo || {}; const st = S.undo[t.id] = S.undo[t.id] || [];
  st.push(clone({ t, players: S.players, history: S.history, queue: S.queue, finished: S.finished || 0 }));
  if (st.length > RULES.undoDepth) st.shift();
}
function popUndo(S, t) { const st = S.undo && S.undo[t.id]; if (st && st.length) st.pop(); }
function doUndo(S, t, now) {
  const st = S.undo && S.undo[t.id]; if (!st || !st.length) return false;
  const snap = st.pop(), i = S.tables.findIndex(x => x.id === t.id);
  S.tables[i] = snap.t; S.players = snap.players; S.history = snap.history; S.queue = snap.queue; S.finished = snap.finished;
  log(S, now, 'table', 'Staff undid the last change on ' + snap.t.name);
  return true;
}
function sideByName(t, name) { const n = String(name || '').trim().toLowerCase(); return ['champ', 'challenger'].find(sd => t[sd] && t[sd].name.toLowerCase() === n) || null; }
const STAFF_ACTIONS = ['start_match', 'switch_turn', 'foul', 'set_group', 'end_match', 'next_match', 'undo', 'reset_table'];

// One entry point for every request. Returns the new state, the response for the app, texts to send and a finished-game summary.
function handle(S, action, p, realNow) {
  const notes = [];
  const now = () => realNow + (S.skew || 0);
  const fail = (msg, code) => ({ S, response: Object.assign(publicState(S, now(), p.ticket), { ok: false, error: msg, code: code || 400 }), notify: notes, finished: null });
  const finBefore = S.finished || 0;
  if (p.base) S.base = String(p.base).slice(0, 200);
  if (p.k != null && p.k !== '') { const kq = p.ticket ? findTicket(S, p.ticket) : null; if (!kq || !kq.key || kq.key !== String(p.k)) return fail('This link doesn\'t match a ticket.', 403); }
  if (p.cams) {                                          // a camera page says which tables it is watching (before settle, so a game starting now is refereed)
    String(p.cams).toUpperCase().split(',').slice(0, 20).forEach(id => {
      const t = S.tables.find(x => x.id === id.trim());
      if (t && !(t.camAt && now() - t.camAt < CAM_SAVE_EVERY)) t.camAt = now();   // saved at most every 20 s per table
    });
  }
  settle(S, now(), notes);
  const q = p.ticket ? findTicket(S, p.ticket) : null;
  switch (action) {
    case 'state': break;
    case 'join': {
      const name = String(p.name || '').trim().slice(0, 24);
      if (!name) return fail('Please enter your name.');
      const gameType = RULES.games.includes(p.gameType) ? p.gameType : '8-ball';
      const refOnly = (p.refOnly === true || p.refOnly === 'true' || p.refOnly === '1') && gameType === '8-ball';
      let pid = Object.keys(S.players).find(k => S.players[k].name.toLowerCase() === name.toLowerCase());
      if (pid && S.queue.some(x => x.pid === pid && ['waiting', 'called', 'playing'].includes(x.status))) return fail(name + ' is already in the queue or at a table.');
      if (!pid) { pid = 'p_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '') + '_' + (S.seq + 1); S.players[pid] = { name, rating: RULES.startRating, w: 0, l: 0 }; }
      const em = String(p.email || '').trim().slice(0, 80);
      const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em) ? em : '';
      if (em && !email) return fail('That email address doesn\'t look right.');
      const ticket = 'A' + (++S.seq);
      const key = Math.random().toString(36).slice(2, 10);
      S.queue.push({ ticket, pid, name, email, key, gameType, refOnly, real: true, status: 'waiting', joinedAt: now() });
      p.ticket = ticket;
      log(S, now(), 'queue', name + ' joined the queue (' + gameType + (refOnly ? ', camera table only' : '') + ')');
      text(S, now(), ticket, 'You\'re on the board at ' + S.venue.name + ' with ticket ' + ticket + '. ' + (email ? 'We\'ll email you when your table is ready.' : 'Keep this page open: it tells you when your table is ready.'), notes, { subject: 'You\'re on the board: ticket ' + ticket });
      if (!S.flags.walkIn) { S.flags.walkIn = true; S.scheduled.push({ at: now() + 75000, type: 'join', pid: 'p_diego', name: 'Diego', gameType: '8-ball', refOnly: true }); }
      settle(S, now(), notes);
      break;
    }
    case 'checkin': {
      const t = tableOf(S, q), side = sideOf(t, q);
      if (!q || q.status !== 'called' || !side) return fail('You haven\'t been called to a table yet.');
      t[side].present = true; log(S, now(), 'queue', q.name + ' checked in at ' + t.name);
      settle(S, now(), notes);
      break;
    }
    case 'leave': {
      if (!q) return fail('Ticket not found.');
      const t = tableOf(S, q), side = sideOf(t, q);
      if (t && t.game) return fail('Finish your game first.');
      if (t && side) { t[side] = null; if (side === 'champ') t.streak = 0; }
      q.status = 'left'; log(S, now(), 'queue', q.name + ' left the queue');
      settle(S, now(), notes);
      break;
    }
    case 'shot': {
      const t = S.tables.find(x => x.id === (p.table || 'T1'));
      let ev = p.event; if (typeof ev === 'string') { try { ev = JSON.parse(ev); } catch (e) { return fail('The shot event is not valid JSON.'); } }
      if (!t || !ev) return fail('Missing table or shot event.');
      pushUndo(S, t);
      const err = applyShot(S, t, ev, now(), notes); if (err) { popUndo(S, t); return fail(err, 409); }
      break;
    }
    case 'shot_ai': {                                    // a shot read by the AI from the camera photos (POST /pool-score)
      const t = S.tables.find(x => x.id === String(p.table || 'T1').toUpperCase());
      let sh = p.shot; if (typeof sh === 'string') { try { sh = JSON.parse(sh); } catch (e) { sh = null; } }
      if (!t) return fail('Unknown table.');
      t.camAt = now();                                   // a shot from this table's camera: it is watching
      if (p.hasFrame) t.frameAt = now();                // the new photo shows on the TV even if the AI reading failed
      if (!sh || sh.ok === false) { const r = fail((sh && sh.error) || 'The AI could not read this shot.'); r.response = Object.assign(publicState(S, now(), p.ticket), { ok: false, error: (sh && sh.error) || 'The AI could not read this shot.' }); return r; }
      const g = t.game;
      if (g && g.mode === 'camera' && g.status === 'review') return fail('Waiting for the foul review on shot ' + g.review.shotNo + '.', 409);
      const ai = { score: sh.score, grade: sh.grade, tip: sh.tip, observations: sh.observations, breakdown: sh.breakdown, confidence: sh.confidence, needsReview: !!sh.needs_review, foul: !!(sh.breakdown && sh.breakdown.foul), foulReason: sh.foul_reason };
      if (!g || g.mode !== 'camera' || g.status !== 'live') {   // no refereed game: a practice shot, scored but not counted
        t.practice = { at: now(), score: sh.score, grade: sh.grade, tip: sh.tip || '', observations: sh.observations || '', potted: sh.potted_balls || [], foul: ai.foul ? (sh.foul_reason || 'foul') : null };
        log(S, now(), 'ai', t.name + ' · practice shot: ' + (sh.observations || sh.grade || ''));
        break;
      }
      const b = ballsFromAI(sh.potted_balls, g.onTable, g.gameType || t.gameType);
      const scratch = b.scratch || sh.cue_ball_outcome === 'scratch';
      if (scratch && ai.foul && /scratch|cue ball/i.test(ai.foulReason || '')) ai.foul = false;   // the scratch rule already covers it
      pushUndo(S, t);
      const err = applyShot(S, t, { potted: b.potted, cueBallPotted: scratch, firstContact: firstBallFromAI(sh.first_contact), confidence: { firstContact: sh.confidence }, ai }, now(), notes);
      if (err) { popUndo(S, t); return fail(err, 409); }
      break;
    }
    case 'flag': {
      const t = tableOf(S, q), side = sideOf(t, q), g = t && t.game;
      if (!g || g.mode !== 'camera' || g.status !== 'live' || !g.shots.length) return fail('There\'s no shot to flag right now.');
      const last = g.shots[g.shots.length - 1];
      if (last.flagged) return fail('That shot was already reviewed.');
      last.flagged = true;
      g.status = 'review';
      g.review = { shotNo: last.no, side: last.side, accused: last.side, source: 'player', foul: { code: 'player-flag', text: q.name + ' flagged shot ' + last.no + ' by ' + last.shooter }, ball: last.firstContact, clip: last.clip, votes: { [side]: side === last.side ? 'dispute' : 'accept' }, at: now(), staff: false, ifFoul: otherSide(last.side), ifClean: g.turn, replay: { from: g.lastShot ? g.lastShot.from : g.positions, to: g.positions, cuePath: g.lastShot ? g.lastShot.cuePath : null, pockets: g.lastShot ? g.lastShot.pockets : {}, highlight: last.firstContact } };
      g.turn = null;
      log(S, now(), 'foul', q.name + ' flagged shot ' + last.no + ' on ' + t.name + ' for review');
      textSeats(S, t, now(), notes, () => q.name + ' flagged shot ' + last.no + ' (' + last.shooter + ') as a foul. Play is paused until you both decide.', { subject: 'Foul review on ' + t.name + ', shot ' + last.no, buttons: [['Foul', 'vote', 'accept', 'foul'], ['No foul', 'vote', 'dispute']] });
      break;
    }
    case 'vote': {
      const t = tableOf(S, q), side = sideOf(t, q), g = t && t.game;
      if (!g || g.status !== 'review' || !side) return fail('There\'s nothing to review.');
      const v = p.vote === 'dispute' ? 'dispute' : 'accept';
      g.review.votes[side] = v; log(S, now(), 'foul', q.name + (v === 'accept' ? ' accepted' : ' disputed') + ' the foul call');
      settle(S, now(), notes);
      break;
    }
    case 'staff': {
      const t = S.tables.find(x => x.id === p.table), g = t && t.game;
      if (!g || g.status !== 'review') return fail('No review waiting on that table.');
      pushUndo(S, t);
      resolveReview(S, t, p.decision === 'uphold' ? 'foul' : 'clean', now(), 'staff decision');
      break;
    }
    case 'report': {
      const t = tableOf(S, q), side = sideOf(t, q), g = t && t.game;
      if (!g || g.mode !== 'manual' || !side) return fail('No game to report.');
      g.winner = p.result === 'lost' ? otherSide(side) : side; g.status = 'confirm'; g.confirmAt = now(); g.confirm = { [side]: true };
      g.winReason = 'reported by ' + q.name;
      textSeats(S, t, now(), notes, s => q.name + ' reported that ' + (g.winner === s ? 'you won' : t[g.winner].name + ' won') + '. Confirm the result so it counts.', { subject: 'Confirm the result on ' + t.name, buttons: [['Confirm result', 'confirm']] });
      settle(S, now(), notes);
      break;
    }
    case 'confirm': {
      const t = tableOf(S, q), side = sideOf(t, q), g = t && t.game;
      if (!g || g.status !== 'confirm' || !side) return fail('Nothing to confirm.');
      pushUndo(S, t);
      g.confirm[side] = true;
      settle(S, now(), notes);
      break;
    }
    case 'advance': {
      const m = Math.max(0, Math.min(120, Number(p.minutes) || 1));
      S.skew = (S.skew || 0) + m * MIN; settle(S, now(), notes);
      break;
    }
    case 'skip': {
      for (let i = 0; i < 240; i++) {
        const cur = p.ticket ? findTicket(S, p.ticket) : null;
        if (!cur || cur.status !== 'waiting') break;
        S.skew = (S.skew || 0) + 15000; settle(S, now(), notes);
      }
      break;
    }
    case 'reset': break;
    default: {
      if (!STAFF_ACTIONS.includes(action)) return fail('Unknown action: ' + action);
      const t = S.tables.find(x => x.id === String(p.table || 'T1').toUpperCase());
      if (!t) return fail('Unknown table.');
      const g = t.game, live = g && g.mode === 'camera' && g.status === 'live';
      if (action === 'undo') { if (!doUndo(S, t, now())) return fail('Nothing to undo on ' + t.name + '.'); break; }
      if (action === 'start_match') {
        const names = String(p.players || '').split(',').map(x => x.trim()).filter(Boolean);
        if (names.length !== 2 || names[0].toLowerCase() === names[1].toLowerCase()) return fail('A match needs two different player names.');
        if (g && g.status !== 'confirm' && String(p.force) !== '1') return fail('A game is being played on ' + t.name + '. Replace it?', 409);
        pushUndo(S, t);
        const n = String(p.gameType || p.game_type || '8').replace(/[^0-9]/g, '');
        t.gameType = ['8', '9', '10'].includes(n) ? n + '-ball' : '8-ball';
        [t.champ, t.challenger].forEach(sd => { const qq = sd && sd.ticket ? findTicket(S, sd.ticket) : null; if (qq && ['called', 'playing'].includes(qq.status)) qq.status = 'done'; });
        const seatFor = (name, side) => {
          const pid = findPid(S, name, true), qq = S.queue.find(x => x.pid === pid && ['waiting', 'called'].includes(x.status));
          if (qq) { qq.status = 'playing'; qq.table = t.id; qq.seat = side; }
          return { pid, name: S.players[pid].name, ticket: qq ? qq.ticket : null, real: !!qq, staff: !qq, present: true };
        };
        t.game = null; t.streak = 0; t.frameAt = null; t.practice = null;
        t.challenger = seatFor(names[0], 'challenger'); t.champ = seatFor(names[1], 'champ'); t.breaker = 'challenger';   // the first name breaks
        log(S, now(), 'table', 'Staff started ' + names[0] + ' vs ' + names[1] + ' (' + t.gameType + ') on ' + t.name);
        startGame(S, t, now());
        break;
      }
      if (action === 'next_match') { settle(S, now(), notes); if (!t.game && !(t.champ && t.challenger)) return fail('Nobody is waiting in the queue for ' + t.name + '.'); break; }
      if (action === 'reset_table') {
        pushUndo(S, t);
        [t.champ, t.challenger].forEach(sd => { const qq = sd && sd.ticket ? findTicket(S, sd.ticket) : null; if (qq && ['called', 'playing'].includes(qq.status)) qq.status = 'done'; });
        t.game = null; t.champ = null; t.challenger = null; t.streak = 0; t.frameAt = null; t.practice = null;
        log(S, now(), 'table', 'Staff cleared ' + t.name);
        settle(S, now(), notes);
        break;
      }
      if (action === 'end_match') {
        if (!g) return fail('No game being played on ' + t.name + '.');
        const w = sideByName(t, p.winner); if (!w) return fail('Pick the winner: ' + [t.champ, t.challenger].filter(Boolean).map(x => x.name).join(' or ') + '.');
        pushUndo(S, t);
        finishGame(S, t, w, now(), notes, 'ended by staff');
        settle(S, now(), notes);
        break;
      }
      if (!live) return fail(!g ? 'No game is being played on ' + t.name + '.' : g.mode !== 'camera' ? (refereed(t, now()) ? 'The camera is not following this game on ' + t.name : t.name + ' has no camera') + ', so staff can only declare the winner or clear the table.' : g.status === 'review' ? 'Play on ' + t.name + ' is paused for a foul review. Decide the review first.' : 'The game on ' + t.name + ' is over. The players are confirming the result.');
      pushUndo(S, t);
      if (action === 'switch_turn') { g.turn = otherSide(g.turn); g.ballInHand = false; g.lastReason = 'Turn switched by staff: ' + t[g.turn].name + ' to shoot'; log(S, now(), 'table', t.name + ' · ' + g.lastReason); }
      else if (action === 'foul') { g.turn = otherSide(g.turn); g.ballInHand = true; g.lastReason = 'Foul called by staff: ball in hand for ' + t[g.turn].name; log(S, now(), 'foul', t.name + ' · ' + g.lastReason); }
      else if (action === 'set_group') {
        if ((g.gameType || t.gameType) !== '8-ball') { popUndo(S, t); return fail('Groups only exist in 8-ball.'); }
        const sd = sideByName(t, p.player); if (!sd) { popUndo(S, t); return fail('Unknown player.'); }
        const grp = p.group === 'stripes' ? 'stripes' : 'solids';
        g.groups[sd] = grp; g.groups[otherSide(sd)] = grp === 'solids' ? 'stripes' : 'solids';
        g.lastReason = t[sd].name + ' set to ' + grp + ' by staff'; log(S, now(), 'table', t.name + ' · ' + g.lastReason);
      }
      break;
    }
  }
  const nFin = (S.finished || 0) - finBefore;
  const finished = nFin > 0 ? S.history.slice(0, nFin) : null;
  return { S, response: publicState(S, now(), p.ticket), notify: notes, finished };
}
