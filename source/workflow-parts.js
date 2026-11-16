// Code that runs inside the n8n Code nodes. Each function's body is copied into a node by build.js
// (the functions are never called here; $input, $json and friends exist only inside n8n).
/* eslint-disable no-undef */

// Where this n8n lives, so emails can link back to it (works on n8n Cloud and on localhost).
function baseUrlSnippet() {
  const h = $input.first().json.headers || {};
  const host = String(h['x-forwarded-host'] || h.host || '').split(',')[0].trim();
  const proto = String(h['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https')).split(',')[0].trim();
  const base = proto + '://' + host + '/webhook';
}

function readRequest() {
  // The app's request, e.g. ?action=join&name=Alex&gameType=8-ball
  const q = $input.first().json.query || {};
  /*BASE*/
  return [{ json: Object.assign({}, q, { action: String(q.action || 'state'), via: 'app', base }) }];
}

function readEmailLink() {
  // A tap on a button in a player's email, e.g. ?a=checkin&t=A102&k=<key>
  // Only these actions can come from an email, and only with the ticket's own key.
  const q = $input.first().json.query || {};
  /*BASE*/
  const allowed = ['checkin', 'vote', 'confirm', 'leave'];
  return [{ json: { action: allowed.includes(q.a) ? q.a : 'state', ticket: String(q.t || ''), k: String(q.k || 'missing'), vote: q.v === 'dispute' ? 'dispute' : 'accept', via: 'email', base } }];
}

function readQuestion() {
  // A question typed into "Ask the referee" on a player's phone, e.g. ?q=When's my turn?&ticket=A102
  const q = $input.first().json.query || {};
  /*BASE*/
  return [{ json: { action: 'state', ticket: String(q.ticket || ''), question: String(q.q || '').slice(0, 200), via: 'ask', base } }];
}

function resultPage() {
  // The small page a player sees after tapping a button in an email. It looks like the app's phone screens:
  // same fonts, colours, logo and buttons.
  const r = $json.response, me = r.me, esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const table = me && me.table ? (r.tables.find(t => t.id === me.table) || {}).name : '';
  const done = { checkin: "You're checked in" + (table ? ' at ' + table : ''), vote: 'Thanks, your vote is in', confirm: 'Result confirmed', leave: 'You left the queue' };
  const title = r.ok ? (done[$json.action] || 'Done') : "That didn't go through";
  const detail = r.ok ? ($json.action === 'checkin' ? 'The game starts as soon as both players are at the table.' : $json.action === 'vote' ? 'Play continues once both players have decided.' : $json.action === 'confirm' ? 'Ratings update once both players confirm.' : 'Put your name back on the board any time.') : r.error;
  const app = $json.base + '/pool-app#mobile';
  // "Open my ticket" only when the link matched a ticket that is still on the board or at a table.
  // No match (an old or wrong link: the engine answers 403), or the player just left the queue: a plain way back
  // to the tables instead.
  const hasTicket = !!me && r.code !== 403 && me.status !== 'left';
  const button = hasTicket ? '<a class="cta" href="' + esc(app + '&t=' + encodeURIComponent(me.ticket)) + '">Open my ticket</a>' : '<a class="quiet" href="' + esc(app) + '">See the tables and the queue</a>';
  const sign = '"Big Shoulders","Arial Narrow","Roboto Condensed",sans-serif', mono = '"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace';
  const css = 'body{margin:0;background:#1c2723;color:#ecefe9;font:15px/1.45 "Instrument Sans",system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}' +
    'main{box-sizing:border-box;max-width:460px;margin:0 auto;padding:16px 20px 26px;display:flex;flex-direction:column;gap:18px}' +
    '.top{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px}' +
    '.mark{display:flex;align-items:center;gap:10px}.mark b{font:800 22px/1 ' + sign + ';letter-spacing:.06em}' +
    '.ticket{font:500 13px ' + mono + ';color:#e5ad3e}' +
    '.said{display:flex;flex-direction:column;gap:8px}' +
    '.label{font:500 11px/1.3 ' + mono + ';letter-spacing:.14em;text-transform:uppercase;color:#67d394}.label.no{color:#ff7a6b}' +
    'h1{margin:0;font:800 42px/.95 ' + sign + ';letter-spacing:.01em;text-transform:uppercase;text-wrap:balance}' +
    'p{margin:0;font-size:15px;color:#a4afa8}' +
    'a{display:flex;align-items:center;justify-content:center;border-radius:8px;text-decoration:none}a:focus-visible{outline:2px solid #8fbcf2;outline-offset:2px}' +
    '.cta{min-height:54px;background:#5b9be8;color:#0e1714;font:800 21px/1 ' + sign + ';letter-spacing:.06em;text-transform:uppercase}' +
    '.quiet{min-height:48px;border:1px solid #3a4842;color:#ecefe9;font-weight:600;font-size:15px}';
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Loopool</title>' +
    '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders:wght@800&family=IBM+Plex+Mono:wght@500&family=Instrument+Sans:wght@400;600&display=swap">' +
    '<style>' + css + '</style></head><body><main>' +
    '<div class="top"><div class="mark"><svg width="26" height="24" viewBox="0 0 26 24" aria-hidden="true"><path d="M13 2.5 24 21.5H2Z" fill="none" stroke="#e5ad3e" stroke-width="2.2" stroke-linejoin="round"/><circle cx="13" cy="15" r="3.4" fill="#ecefe9"/></svg><b>LOOPOOL</b></div>' +
    (hasTicket ? '<span class="ticket">' + esc(me.ticket) + '</span>' : '') + '</div>' +
    '<div class="said"><span class="label' + (r.ok ? '' : ' no') + '">' + (r.ok ? 'Done' : 'Not done') + '</span><h1>' + esc(title) + '</h1><p>' + esc(detail) + '</p></div>' +
    button + '</main></body></html>';
  return [{ json: { html } }];
}

function briefReferee() {
  // Turns the live board into a short brief for the AI referee, from the asking player's point of view.
  const r = $json.response, me = r.me;
  const seat = s => s ? s.name + ' (' + s.rating + ')' : 'open seat';
  const tables = r.tables.map(t => {
    const g = t.game;
    let st = t.status === 'playing' ? 'playing, ' + (g ? g.minutes : 0) + ' min in' : t.status === 'checkin' ? 'players checking in' : t.status === 'waiting' ? 'needs a challenger' : t.status === 'review' ? 'paused for a foul review' : t.status === 'confirm' ? 'game over, waiting for both players to confirm' : t.status === 'staff' ? 'players disagree on a foul, staff deciding' : 'free';
    if (g && g.mode === 'camera' && g.groups) {
      const left = side => { const grp = g.groups[side]; if (!grp) return 'open table'; const n = g.onTable.filter(b => grp === 'solids' ? b < 8 : b > 8).length; return grp + ', ' + n + ' left'; };
      st += '; ' + t.champ.name + ': ' + left('champ') + '; ' + t.challenger.name + ': ' + left('challenger') + (g.turn ? '; ' + t[g.turn].name + ' to shoot' + (g.ballInHand ? ' with ball in hand' : '') : '');
      const last = g.shots && g.shots[g.shots.length - 1];
      if (last) st += '; last shot: ' + last.shooter + (last.potted.length ? ' potted ' + last.potted.join(', ') : ' missed') + (last.fouls.length ? ' (' + last.fouls.join('; ') + ')' : '');
    }
    return '- ' + t.name + ' (' + t.gameType + (t.ref ? ', camera referee, rated' : '') + '): ' + seat(t.champ) + ' vs ' + seat(t.challenger) + ', ' + st + (t.streak ? ', table holder has ' + t.streak + ' win(s) in a row' : '');
  }).join('\n');
  const queue = r.queue.length ? r.queue.map(q => '- ' + (q.status === 'called' ? 'called to ' + q.table : '#' + q.position) + ': ' + q.name + ' (' + q.gameType + (q.refOnly ? ', Table 1 only' : '') + (q.eta ? ', about ' + q.eta.min + ' min' : '') + ')').join('\n') : '- nobody waiting';
  let asker = 'The person asking has not joined the queue.';
  if (me) asker = 'The person asking is ' + me.name + ' (ticket ' + me.ticket + ', rating ' + me.rating + '). Status: ' + me.status +
    (me.position ? ', #' + me.position + ' in line' : '') + (me.eta ? ', estimated wait about ' + me.eta.min + ' min, most likely ' + me.eta.table : '') +
    (me.table ? ', at ' + ((r.tables.find(t => t.id === me.table) || {}).name || me.table) + ' as ' + (me.side === 'champ' ? 'the table holder' : 'the challenger') : '') + '.';
  const top = r.leaderboard.slice(0, 5).map((p, i) => (i + 1) + '. ' + p.name + ' ' + p.rating).join(', ');
  // The bar's profile and upcoming events (from the Bar setup page), so players can ask "when's the next tournament?"
  const v = r.venue || {}, days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const hours = v.hours ? days.map(d => d + ' ' + (v.hours[d].closed ? 'closed' : v.hours[d].open + '-' + v.hours[d].close)).join(', ') : 'not set';
  const bar = (v.name || 'the bar') + (v.open === false ? ' (closed right now)' : '') + '. Hours: ' + hours + (v.address ? '. Address: ' + v.address : '') + (v.tableCount ? '. ' + v.tableCount + ' tables' + (v.tableBrand ? ' (' + v.tableBrand + (v.tableSize ? ', ' + v.tableSize : '') + ')' : '') : '') + (v.cues ? ', ' + v.cues + ' house cues' : '');
  const events = (r.events || []).length ? r.events.map(e => '- ' + e.date + ' ' + e.time + ': ' + e.title + ' (' + e.kind + ', ' + e.gameType + (e.fee ? ', entry ' + e.fee : '') + (e.prize ? ', prize ' + e.prize : '') + ', ' + e.count + (e.cap ? ' of ' + e.cap : '') + ' signed up). ' + (e.about || '') + ' Players sign up from the list at the bottom of their phone screen.').join('\n') : '- none posted';
  const brief = 'Time: ' + new Date(r.now).toLocaleTimeString('en-CA', { timeZone: 'America/Vancouver', hour: 'numeric', minute: '2-digit' }) + '\n' + asker + '\nTABLES\n' + tables + '\nQUEUE\n' + queue + "\nTONIGHT'S RATINGS: " + top + '\nTHE BAR: ' + bar + '\nUPCOMING EVENTS\n' + events;
  return [{ json: { question: $json.question || 'Hi', brief } }];
}

function writeEmail() {
  // One email per message: the text, tap buttons that link back to n8n, and a link to the live ticket page.
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return $input.all().filter(i => i.json.email).map(i => {
    const n = i.json;
    const buttons = (n.buttons || []).map(b => '<a href="' + esc(b.url) + '" style="display:inline-block;margin:0 8px 8px 0;padding:13px 20px;border-radius:8px;background:' + (b.style === 'foul' ? '#ff7a6b' : '#5b9be8') + ';color:#0e1714;font-weight:700;font-size:16px;text-decoration:none">' + esc(b.label) + '</a>').join('');
    const html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;color:#1c2723">' +
      '<p style="margin:0 0 6px;color:#9a6b12;letter-spacing:.12em;font-size:12px;font-weight:700">LOOPOOL</p>' +
      '<p style="margin:0 0 4px;font-size:15px">Hi ' + esc(n.name) + ',</p>' +
      '<p style="margin:0 0 18px;font-size:17px;line-height:1.45">' + esc(n.text) + '</p>' +
      (buttons ? '<div style="margin:0 0 14px">' + buttons + '</div>' : '') +
      '<p style="margin:0;font-size:14px"><a href="' + esc(n.page) + '" style="color:#1f6b47">Open my ticket</a> · ticket ' + esc(n.ticket) + '</p></div>';
    return { json: { to: n.email, subject: n.subject, html } };
  });
}

function briefShot() {
  // The facts of the shot the camera just scored, for the AI commentator.
  const r = $json.response, t = r.tables.find(x => x.id === ($json.table || 'T1')), g = t && t.game;
  const s = g && g.shots && g.shots[g.shots.length - 1];
  if (!s) return [{ json: { facts: 'No shot data.' } }];
  const nm = side => (t[side] ? t[side].name : side);
  const group = side => {
    const grp = g.groups && g.groups[side];
    if (!grp) return nm(side) + ': open table (no group yet)';
    const left = g.onTable.filter(b => grp === 'solids' ? b < 8 : b > 8).length;
    return nm(side) + ': ' + grp + ', ' + (left ? left + ' left' : 'all cleared, on the 8');
  };
  const lines = [
    'Table: ' + t.name + ' (' + t.gameType + '), shot ' + s.no + ' of the game.',
    'Shooter: ' + s.shooter + '.',
    // Ball numbers are written as "the 2-ball" so the model never reads them as counts ("pots two solids").
    'Balls potted on this shot: ' + (s.potted.length ? s.potted.map(b => 'the ' + b + '-ball').join(' and ') + ' (' + s.potted.length + ' ball' + (s.potted.length > 1 ? 's' : '') + ')' : 'none') + '.',
    'First ball the cue ball hit: ' + (s.firstContact == null ? 'none' : 'the ' + s.firstContact + '-ball') + '.',
    'Cue ball in a pocket (scratch): ' + (s.scratch ? 'yes' : 'no') + '.',
    s.fouls.length ? 'Fouls called: ' + s.fouls.join('; ') + '.' : 'No foul called.',
    s.possible && s.possible.length ? 'Possible foul, play paused for the players to review: ' + s.possible.join('; ') + '.' : '',
    s.note ? 'Groups decided: ' + s.note + '.' : '',
    'Groups now: ' + group('champ') + '; ' + group('challenger') + '.',
    g.status === 'confirm' ? 'Game over: ' + g.winReason + '. Winner: ' + nm(g.winner) + '.' : g.turn ? 'Next to shoot: ' + nm(g.turn) + (g.ballInHand ? ', with ball in hand' : '') + '.' : '',
  ].filter(Boolean);
  return [{ json: { facts: lines.join('\n') } }];
}

function saveCommentary() {
  // Stores the AI line on the shot (phones and the bar TV show it) and puts it in the live feed.
  const eng = $('Referee engine').first().json, resp = eng.response, tid = eng.table || 'T1';
  const text = String($json.output || '').replace(/\s+/g, ' ').trim().slice(0, 240);
  if (text && resp.ok) {
    const S = $getWorkflowStaticData('global').pool;
    const t = S && S.tables.find(x => x.id === tid), g = t && t.game, last = g && g.shots && g.shots[g.shots.length - 1];
    if (last) {
      last.ai = text;
      const item = { at: Date.now() + (S.skew || 0), kind: 'ai', text: t.name + ' · ' + text };
      S.feed.push(item); if (S.feed.length > 40) S.feed.splice(0, S.feed.length - 40);
      const rt = resp.tables.find(x => x.id === tid), rs = rt && rt.game && rt.game.shots;
      if (rs && rs.length) rs[rs.length - 1].ai = text;
      resp.feed.unshift(item);
    }
  }
  return [{ json: { response: resp, commentary: text } }];
}


// ===================== Camera referee: photos -> AI reading -> score -> game =====================
async function prepareShot() {
  // Orders the photos the camera page sent and writes the referee prompt.
  // Runs on Claude through n8n (Gateway credits) instead of OpenRouter. Also keeps the after-photo for the bar TV.
  const MAX_MB = 12;
  const item = $input.first();
  const bin = item.binary || {};
  const body = item.json.body || item.json;
  const tableId = String(body.table || body.table_id || 'T1').trim().toUpperCase();
  const store = $getWorkflowStaticData('global');
  const pool = store.pool, t = pool && pool.tables ? pool.tables.find(x => x.id === tableId) : null;
  const gameType = String(body.game_type || (t && t.game && t.game.gameType) || (t && t.gameType) || '8-ball');
  // The table's ball colours, picked on the camera page. Naming balls by colour is where the AI goes wrong most
  // (our model test), so the prompt says which colour is which number on this table.
  const BALL_SETS = {
    standard: 'Ball colours on this table: 1 yellow, 2 blue, 3 red, 4 purple, 5 orange, 6 green, 7 maroon, 8 black; 9-15 are the same colours with a white band (9 yellow, 10 blue, 11 red, 12 purple, 13 orange, 14 green, 15 maroon). The cue ball is plain white.',
    pink: 'Ball colours on this table (not the usual set): 1 yellow, 2 blue, 3 red, 4 pink (can look dark red or maroon), 5 purple, 6 green, 7 orange, 8 black; 9-15 are the same colours with a white band (9 yellow, 10 blue, 11 red, 12 pink, 13 purple, 14 green, 15 orange). The cue ball is cream with a small red dot.',
  };
  const ballKey = BALL_SETS[String(body.ball_set || '').toLowerCase()] || '';
  /*BASE*/
  const frames = []; let total = 0, hasDiff = false;
  for (const k of Object.keys(bin)) {
    if (k === 'frame_diff') { hasDiff = true; continue; }
    if (!k.startsWith('frame_')) continue;
    const meta = bin[k], size = Number(meta.fileSize) || 0; total += size;
    const tsec = parseFloat(String(meta.fileName || '').replace(/[^0-9.]/g, '')) || 0;
    frames.push({ key: k, order: k === 'frame_start' ? -1 : k === 'frame_end' ? 1e9 : tsec, t: tsec });
  }
  frames.sort((a, b) => a.order - b.order);
  if (frames.length < 2) return [{ json: { error: 'No photos received. Use the camera screen in Chrome so it can grab frames from the video.', table: tableId, base } }];
  // The after-photo goes to the bar TV and phones. It is handed on, not saved here: this run waits about 15 s
  // for the AI, and n8n writes saved state back when a run ends, so saving here would undo anything players
  // did in the meantime. "Apply the shot" (/pool-apply) saves it together with the game result.
  let frame = null;
  if (bin.frame_end) {
    const buf = await this.helpers.getBinaryDataBuffer(0, 'frame_end');
    if (buf.length / 1048576 < MAX_MB) frame = { b64: buf.toString('base64'), mime: bin.frame_end.mimeType || 'image/jpeg' };
  }
  const labels = frames.map((f, i) => (i + 1) + ': ' + (i === 0 ? 'BEFORE' : i === frames.length - 1 ? 'AFTER (balls stopped)' : 't=' + f.t.toFixed(2) + 's'));
  if (hasDiff) labels.push((frames.length + 1) + ': CHANGE MAP (white = pixels that changed between BEFORE and AFTER, black = unchanged)');
  const prompt = `You are a strict billiards referee. Analyse ONE ${gameType} shot from the ${frames.length} still frames above, in time order.
The images are, in order: ${labels.join(' · ')}.
The FIRST frame is the table before the shot, the LAST frame is after all balls stopped.
Pocket names are relative to the image as displayed: top-left, top-middle, top-right, bottom-left, bottom-middle, bottom-right.${ballKey ? '\n' + ballKey : ''}

Work in this order:
1. FIRST vs LAST frame: list each ball (colour, solid/stripe/cue/8) present in the first frame but missing in the last. Only these were pocketed.${hasDiff ? ' Use the CHANGE MAP to find where things changed: a pocketed ball leaves ONE white spot (its old position); a ball that moved leaves TWO spots (old and new position).' : ''}
   The cue ball is the plain white ball with no number or stripe. Before calling it missing, search the WHOLE cloth in the last frame and say where it is in "cue_ball_after". It is a scratch ONLY if it is truly not on the table.
2. Use the middle frames to follow the cue ball: which ball it hit first, where balls travelled.
3. Then give the verdict. It MUST agree with steps 1-2. Never claim a ball was pocketed if it is still visible in the last frame.
If something happens between frames and you cannot see it, say so and lower confidence.

Reply with ONLY this JSON, no other text:
{
  "missing_after": [string],
  "cue_ball_after": string,
  "timeline": [{"t": string, "event": string}],
  "shot_detected": boolean,
  "first_contact": string or null,
  "target_ball": string or null,
  "intended_pocket": string or null,
  "potted_balls": [string],
  "target_potted": boolean,
  "miss_quality": "potted" | "close" | "medium" | "far",
  "cue_ball_outcome": "good_position" | "ok_position" | "bad_position" | "scratch",
  "difficulty": "easy" | "medium" | "hard",
  "foul": boolean,
  "foul_reason": string or null,
  "observations": string,
  "tip": string,
  "confidence": number
}
How to rate the shot (choose the option that fits; "medium" and "ok_position" are not defaults):
- "difficulty": "easy" = the object ball is within about a quarter of the table length of its pocket AND the cut is nearly straight (cue ball, object ball and pocket close to one line). "hard" = any of: the object ball travels more than half the table length to the pocket; a thin cut (the cue ball meets it more than about 45 degrees off straight); a bank or kick; or the cue ball has to pass close to other balls. "medium" = everything else.
- "cue_ball_outcome": look at where the cue ball stopped in the LAST frame. "good_position" = BOTH: it is within about a quarter of the table length of a ball the same player could pot next with nothing in the way, AND that ball has a clear, nearly straight line into a pocket. "bad_position" = it is touching or almost touching a cushion, or another ball blocks the line to every ball the player could play next, or every such ball is more than half the table away. "ok_position" = only when neither fits. "scratch" = the cue ball went in a pocket.
Name each potted ball as "solid N", "stripe N", "8 ball" or "cue ball" (use "solid ?" / "stripe ?" + colour if the number is unreadable). "cue_ball_after" is where the cue ball is in the LAST frame, or "not visible". Keep "observations" to one or two plain sentences a player would understand.`;
  const keys = frames.map(f => f.key).concat(hasDiff ? ['frame_diff'] : []);
  return [{ json: { table: tableId, game_type: gameType, prompt, imageKeys: keys.join(','), frame_count: frames.length, has_frames: true, base, frame }, binary: bin }];
}

function scoreShot() {
  // Score the shot: the code decides the 0-100 number, the AI only describes the shot.
  const req = $('Prepare the AI request').first().json;
  const r = $input.first().json;
  if (req.error) return [{ json: { ok: false, table_id: req.table, error: req.error } }];
  if (r.error) { const m = typeof r.error === 'string' ? r.error : (r.error.message || JSON.stringify(r.error)); return [{ json: { ok: false, table_id: req.table, error: 'AI request failed: ' + m } }]; }
  const finish = r.stop_reason === 'max_tokens' ? 'length' : (r.stop_reason || null);
  const text = (r.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  function extractJson(t) {
    t = t.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
    try { return JSON.parse(t.trim()); } catch (e) {}
    const cands = [];
    for (let i = 0; i < t.length; i++) {
      if (t[i] !== '{') continue;
      let depth = 0, inStr = false, esc = false;
      for (let j = i; j < t.length; j++) {
        const c = t[j];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { cands.push(t.slice(i, j + 1)); i = j; break; } }
      }
    }
    for (const c of cands.reverse()) { try { const o = JSON.parse(c); if (o && 'shot_detected' in o) return o; } catch (e) {} }
    return null;
  }
  const o = extractJson(text);
  if (!o) {
    const why = !text.trim() ? (finish === 'length' ? 'the model ran out of tokens' : 'the model returned an empty answer') : finish === 'length' ? 'the answer was cut off (too long)' : 'the answer was not valid JSON';
    return [{ json: { ok: false, table_id: req.table, model: r.model || null, error: 'Could not read the AI answer: ' + why + '. Try again.', raw: text.slice(0, 400) } }];
  }
  if (!o.shot_detected) return [{ json: { ok: false, table_id: req.table, error: 'No shot detected in these photos', ai: o } }];
  const cueAfter = String(o.cue_ball_after || '').toLowerCase();
  const cueSeen = cueAfter && !/not visible|missing|pocket|none|n\/a/.test(cueAfter);
  if (cueSeen) {
    o.missing_after = (o.missing_after || []).filter(b => !/cue|white/i.test(b));
    if (o.cue_ball_outcome === 'scratch') { o.cue_ball_outcome = 'ok_position'; o.confidence = Math.min(Number(o.confidence) || 0, 0.5); }
    if (o.foul && /scratch|cue ball/i.test(o.foul_reason || '')) { o.foul = false; o.foul_reason = null; }
  }
  const miss = (o.missing_after || []).join(' ').toLowerCase();
  if (/cue|white/.test(miss)) { o.cue_ball_outcome = 'scratch'; o.foul = true; o.foul_reason = o.foul_reason || 'cue ball scratched'; }
  if (o.target_potted && o.target_ball && !miss.includes(String(o.target_ball).toLowerCase().split(' (')[0].split(' ').pop())) o.confidence = Math.min(Number(o.confidence) || 0, 0.5);
  const POT = { potted: 55, close: 25, medium: 12, far: 0 }, CUE = { good_position: 25, ok_position: 15, bad_position: 5, scratch: 0 }, DIFF = { easy: 0, medium: 10, hard: 20 };
  const pot = o.target_potted ? 55 : (POT[o.miss_quality] ?? 0), cue = CUE[o.cue_ball_outcome] ?? 0, diff = DIFF[o.difficulty] ?? 0;
  const diffBonus = o.target_potted ? diff : Math.round(diff / 2);
  let score = Math.min(100, pot + cue + diffBonus); if (o.foul) score = Math.min(score, 10);
  const grade = score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Okay' : 'Needs work';
  const confidence = Math.max(0, Math.min(1, Number(o.confidence) || 0));
  return [{ json: { ok: true, table_id: req.table, game_type: req.game_type, score, grade, breakdown: { pot, cue_ball: cue, difficulty_bonus: diffBonus, foul: !!o.foul },
    target_ball: o.target_ball || null, intended_pocket: o.intended_pocket || null, potted_balls: o.potted_balls || [], difficulty: o.difficulty, cue_ball_outcome: o.cue_ball_outcome,
    foul_reason: o.foul ? (o.foul_reason || 'foul') : null, observations: o.observations || '', first_contact: o.first_contact || null, cue_ball_after: o.cue_ball_after || null,
    missing_after: o.missing_after || [], timeline: Array.isArray(o.timeline) ? o.timeline.slice(0, 12) : [], frame_count: req.frame_count || 0, model: r.model || null,
    tip: o.tip || '', confidence, needs_review: confidence < 0.6, scored_at: new Date().toISOString() } }];
}

function readScoredShot() {
  // Packs the scored shot and the after-photo for "Apply the shot" (POST /pool-apply), a separate short run that
  // loads the current game state, applies the shot (turn, groups, fouls, winner, ratings) and saves at once.
  const s = $input.first().json, req = $('Prepare the AI request').first().json;
  return [{ json: { url: (req.base || '') + '/pool-apply', payload: { table: s.table_id || req.table, shot: JSON.stringify(s), hasFrame: !!req.frame, frame: req.frame || null, base: req.base } } }];
}

function applyShot() {
  // POST /pool-apply: saves the table photo and hands the scored shot to the Referee engine, in one short run.
  const b = $input.first().json.body || {};
  const tableId = String(b.table || 'T1').trim().toUpperCase();
  const store = $getWorkflowStaticData('global');
  if (b.frame && b.frame.b64) { store.frames = store.frames || {}; store.frames[tableId] = { b64: String(b.frame.b64), mime: b.frame.mime || 'image/jpeg', at: Date.now() }; }
  return [{ json: { action: 'shot_ai', table: tableId, shot: typeof b.shot === 'string' ? b.shot : JSON.stringify(b.shot || {}), hasFrame: !!(b.frame && b.frame.b64), via: 'score', base: b.base || '' } }];
}

function cameraReply() {
  // The reply the camera page expects: the score plus the game result (from "Apply the shot").
  const scored = $('Score the shot').first().json, r = $json.response, id = String(scored.table_id || 'T1').toUpperCase();
  if (!r) return [{ json: Object.assign({}, scored, { apply_error: 'The shot was read but could not be added to the game. Staff can enter it by hand.' }) }];
  if (!scored.ok) return [{ json: scored }];
  const t = (r.tables || []).find(x => x.id === id), g = t && t.game;
  const camera = g && g.mode === 'camera' && g.shots && g.shots.length;
  const last = camera ? g.shots[g.shots.length - 1] : null;
  const name = side => (side && t[side] ? t[side].name : null);
  const game = !camera ? { practice: true, reason: 'Practice shot: no game is on at this table, so it is scored but not counted' } : {
    practice: false, shooter: last.shooter, keeps_turn: g.turn === last.side, turn_after: name(g.turn), reason: last.reason,
    ball_in_hand: !!g.ballInHand, finished: g.status === 'confirm', winner: name(g.winner), review: g.status === 'review' };
  return [{ json: Object.assign({}, scored, { player: last ? last.shooter : 'Practice', shot_no: last ? last.no : null, game, table: null, apply_error: r.ok ? null : r.error }) }];
}

async function loadFrame() {
  // Serves the latest after-shot photo of a table (GET /pool-frame?table=T1) for the bar TV and phones.
  const q = $input.first().json.query || {}, id = String(q.table || 'T1').toUpperCase();
  const f = ($getWorkflowStaticData('global').frames || {})[id];
  if (!f) return [{ json: { ok: false }, binary: { data: await this.helpers.prepareBinaryData(Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'), 'none.gif', 'image/gif') } }];   // no photo yet: a blank pixel
  return [{ json: { ok: true, at: f.at }, binary: { data: await this.helpers.prepareBinaryData(Buffer.from(f.b64, 'base64'), id + '.jpg', f.mime) } }];
}

// ---------- Profile auto-fill (GET /pool-lookup?url=...): read a bar's website or Google Maps page into a profile ----------
function readLookup() {
  // The link the bar pasted on the setup page, e.g. ?url=https://maps.app.goo.gl/abc or ?url=https://mybar.com
  const q = $input.first().json.query || {};
  let url = String(q.url || '').trim();
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  let ok = false;
  try { const u = new URL(url); ok = /^https?:$/.test(u.protocol) && !/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname); } catch (e) { ok = false; }
  const maps = /(^|\.)(google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl)$/i.test(ok ? new URL(url).hostname : '') && /maps|goo\.gl/i.test(url);
  return [{ json: { url: ok ? url : '', maps, error: ok ? '' : 'Paste a full link to your website or your Google Maps page.' } }];
}

function pageFacts() {
  // Turns the fetched page into facts we can trust (schema.org data, page title, Google Maps place name)
  // plus a short plain-text version of the page for the AI to read for the rest (tables, cues, about).
  const link = $('Read the link').first().json;
  const res = $input.first().json || {};
  const html = String(res.body != null ? res.body : res.data != null ? res.data : '').slice(0, 600000);
  const facts = {};
  const dec = s => String(s || '').replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
  const meta = name => {                                  // <meta property="og:title" content="..."> in either attribute order
    const tags = html.match(/<meta\b[^>]*>/gi) || [];
    for (const tag of tags) {
      const key = /(?:property|name)\s*=\s*(["'])(.*?)\1/i.exec(tag), val = /content\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
      if (key && val && key[2].toLowerCase() === name) return dec(val[2]);
    }
    return '';
  };
  // 1. schema.org data (most bar websites and booking sites have it): name, address, phone, opening hours
  const DAY = { mo: 'mon', tu: 'tue', we: 'wed', th: 'thu', fr: 'fri', sa: 'sat', su: 'sun' }, ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const hm = t => { const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '')); return m ? String(Math.min(23, Number(m[1]))).padStart(2, '0') + ':' + m[2] : ''; };
  const setDays = (days, open, close) => { if (!open || !close) return; facts.hours = facts.hours || {}; days.forEach(d => { facts.hours[d] = { open, close, closed: false }; }); };
  const dayKey = d => { const k = String(d || '').replace(/^https?:\/\/schema\.org\//i, '').slice(0, 2).toLowerCase(); return DAY[k] || ''; };
  const objs = [];
  const re = /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi; let m;
  while ((m = re.exec(html))) { try { const j = JSON.parse(m[1].trim()); (Array.isArray(j) ? j : [j]).forEach(o => { objs.push(o); if (o && Array.isArray(o['@graph'])) objs.push(...o['@graph']); }); } catch (e) { /* broken JSON-LD: skip */ } }
  const biz = objs.find(o => o && /BarOrPub|LocalBusiness|Restaurant|NightClub|EntertainmentBusiness|SportsActivityLocation|FoodEstablishment/i.test([].concat(o['@type'] || []).join(' ')));
  if (biz) {
    if (biz.name) facts.name = dec(biz.name);
    const a = biz.address;
    if (a) facts.address = typeof a === 'string' ? dec(a) : [a.streetAddress, a.addressLocality, a.addressRegion].filter(Boolean).map(dec).join(', ');
    if (biz.telephone) facts.phone = dec(biz.telephone);
    if (biz.description) facts.about = dec(biz.description).slice(0, 280);
    if (biz.url && /^https:\/\//.test(biz.url)) facts.website = biz.url;
    if (biz.geo && biz.geo.latitude != null) { facts.lat = Number(biz.geo.latitude); facts.lng = Number(biz.geo.longitude); }
    [].concat(biz.openingHoursSpecification || []).forEach(sp => { const days = [].concat(sp.dayOfWeek || []).map(dayKey).filter(Boolean); setDays(days, hm(sp.opens), hm(sp.closes)); });
    [].concat(biz.openingHours || []).forEach(str => {               // "Mo-Th 16:00-00:00" or "Fr,Sa 16:00-02:00"
      const mm = /^([A-Za-z,\- ]+)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(String(str)); if (!mm) return;
      const days = [];
      mm[1].split(',').forEach(part => { const [x, y] = part.trim().split('-').map(dayKey); if (!x) return; if (!y) { days.push(x); return; } for (let i = ORDER.indexOf(x); i !== -1; i = (i + 1) % 7) { days.push(ORDER[i]); if (ORDER[i] === y || days.length > 7) break; } });
      setDays(days, hm(mm[2]), hm(mm[3]));
    });
    if (facts.hours) ORDER.forEach(d => { if (!facts.hours[d]) facts.hours[d] = { open: '', close: '', closed: true }; });
  }
  // 2. Google Maps: the place name is in the link, and the page title reads "Name · Address"
  if (link.maps) {
    const pm = /\/maps\/place\/([^/@?]+)/.exec(link.url) || /\/maps\/place\/([^/@?]+)/.exec(html);
    if (pm && !facts.name) facts.name = decodeURIComponent(pm[1].replace(/\+/g, ' ')).trim();
    const og = meta('og:title');
    if (og && og.includes('·')) { const [n, ...rest] = og.split('·').map(x => x.trim()); if (n && !facts.name) facts.name = n; if (rest.length && !facts.address) facts.address = rest.join(', '); }
    if (!facts.website && link.url) facts.mapsUrl = link.url;
  }
  if (link.maps) { facts.mapsUrl = link.url; const g = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(link.url) || /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(link.url + ' ' + html.slice(0, 200000)); if (g) { facts.lat = Number(g[1]); facts.lng = Number(g[2]); } }
  else if (!facts.website && link.url) facts.website = link.url;
  if (!facts.name) { const t = meta('og:site_name') || meta('og:title') || dec((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1]); if (t) facts.name = t.split(/\s[|\-–·]\s/)[0].trim().slice(0, 40); }
  if (!facts.about) { const d = meta('og:description') || meta('description'); if (d) facts.about = d.slice(0, 280); }
  // 3. the page as plain text, for the AI (tables, cues, brand, anything said in words)
  const text = dec(html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, 7000);
  const status = res.statusCode || 0;
  const fetched = html.length > 0;
  const prompt = 'Below is text from the web page of a bar or pool hall (' + link.url + ').\n' +
    'Facts already found: ' + JSON.stringify(facts) + '\n\n' +
    'Return ONLY a JSON object with these keys, using null for anything the page does not clearly state (never guess):\n' +
    '{"name": string, "about": string (one or two sentences for pool players, at most 200 characters), "address": string, "phone": string, ' +
    '"tableCount": number (pool tables), "tableBrand": string, "tableSize": "7 ft" | "8 ft" | "9 ft", "cues": number (house cues), ' +
    '"hours": {"mon": {"open": "HH:MM", "close": "HH:MM", "closed": boolean}, ... for tue wed thu fri sat sun}}\n\nPAGE TEXT\n' + (text || '(empty)');
  return [{ json: { url: link.url, facts, prompt, read: fetched && text.length > 40, error: link.error || (fetched ? '' : 'The page could not be opened' + (status ? ' (HTTP ' + status + ')' : '') + '.') } }];
}

function profileFromPage() {
  // Merges the AI's reading with the facts found in the page's own data (those win), and checks every field.
  const base = $('Page facts').first().json;
  let ai = {};
  const out = String(($input.first().json || {}).output || '');
  const j = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
  try { ai = JSON.parse(j) || {}; } catch (e) { ai = {}; }
  const str = (v, n) => (v == null ? '' : String(v)).trim().slice(0, n);
  const hm = t => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(t || '')) ? String(t) : '';
  const p = {}, f = base.facts || {};
  p.name = str(f.name || ai.name, 40);
  p.about = str(f.about || ai.about, 280);
  p.address = str(f.address || ai.address, 120);
  p.phone = str(f.phone || ai.phone, 30);
  if (f.website) p.website = f.website;
  if (f.mapsUrl) p.mapsUrl = f.mapsUrl;
  if (Math.abs(f.lat) <= 90 && Math.abs(f.lng) <= 180) { p.lat = f.lat; p.lng = f.lng; }
  const n = Math.round(Number(ai.tableCount)); if (n >= 1 && n <= 40) p.tableCount = n;
  const c = Math.round(Number(ai.cues)); if (c >= 1 && c <= 200) p.cues = c;
  if (ai.tableBrand) p.tableBrand = str(ai.tableBrand, 40);
  if (['7 ft', '8 ft', '9 ft'].includes(ai.tableSize)) p.tableSize = ai.tableSize;
  const H = f.hours || ai.hours;
  if (H && typeof H === 'object') {
    p.hours = {};
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(d => { const h = H[d] || {}; p.hours[d] = { open: hm(h.open), close: hm(h.close), closed: !!h.closed || !(hm(h.open) && hm(h.close)) }; });
    if (Object.values(p.hours).every(h => h.closed)) delete p.hours;   // nothing usable
  }
  Object.keys(p).forEach(k => { if (p[k] === '' || p[k] == null) delete p[k]; });
  const found = Object.keys(p);
  return [{ json: { ok: found.length > 0, profile: p, found, source: base.url, error: found.length ? '' : (base.error || 'We couldn\'t find your bar\'s details on that page. Fill in the profile yourself, or try your website link.') } }];
}

module.exports = { readLookup, pageFacts, profileFromPage, prepareShot, scoreShot, readScoredShot, applyShot, cameraReply, loadFrame, baseUrlSnippet, readRequest, readEmailLink, readQuestion, resultPage, briefReferee, writeEmail, briefShot, saveCommentary };
