// ===== Demo "camera service": builds the shot events a real vision system would send to n8n. =====
// One scripted 8-ball game. Roles come from the engine's turn order, so the challenger plays the stripes here.
const SHOT_SPEC = [
  { brk: true, pot: [10] },
  { target: 12, pot: true },
  { target: 13, pot: false },
  { target: 2, pot: true },
  { target: 5, pot: true },
  { target: 11, pot: false, conf: 0.62 },
  { target: 9, pot: true, bih: true },
  { target: 14, pot: true },
  { target: 11, pot: true, extra: [15] },
  { target: 13, pot: true, scratch: true },
  { target: 1, pot: true, bih: true },
  { target: 3, pot: true },
  { target: 4, pot: false },
  { target: 8, pot: true },
];
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function buildScript() {
  const R = TABLE.R, W = TABLE.W, H = TABLE.H, P = TABLE.pockets;
  const rnd = mulberry32(20261118);
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const round = p => [Math.round(p[0]), Math.round(p[1])];
  let pos = rackPositions();
  const free = (p, ignore) => p[0] > R + 6 && p[0] < W - R - 6 && p[1] > R + 6 && p[1] < H - R - 6 && P.every(q => d(p, q) > 48) && Object.entries(pos).every(([k, q]) => ignore.includes(k) || d(p, q) > 2 * R + 4);
  const spot = (ignore, x0, x1, y0, y1) => { for (let i = 0; i < 800; i++) { const p = [x0 + rnd() * (x1 - x0), y0 + rnd() * (y1 - y0)]; if (free(p, ignore)) return round(p); } return [W / 2, H / 2]; };
  const nearest = p => P.reduce((bi, q, i) => d(p, q) < d(p, P[bi]) ? i : bi, 0);
  const events = [];
  SHOT_SPEC.forEach((s, idx) => {
    const ev = { shotNo: idx + 1, potted: [], cueBallPotted: false, firstContact: null, confidence: {}, cuePath: null, pockets: {}, clip: 'table1_shot' + String(idx + 1).padStart(2, '0') + '.mp4' };
    if (s.brk) {
      const apex = pos[1];
      const contact = [apex[0] - 2 * R, apex[1]];
      const next = { cue: null };
      const old = pos; pos = { cue: old.cue };
      for (let b = 1; b <= 15; b++) {
        if (s.pot.includes(b)) continue;
        const p = b <= 7 || b === 8 ? spot(['cue'], 380, 975, 25, 475) : spot(['cue'], 300, 975, 25, 475);
        pos[b] = p; next[b] = p;
      }
      s.pot.forEach(b => { ev.pockets[b] = 2; });
      const rest = spot([], 380, 520, 160, 340);
      ev.cuePath = [old.cue, round(contact), rest];
      pos.cue = rest;
      ev.potted = s.pot.slice(); ev.firstContact = 1;
    } else {
      const tgt = pos[s.target];
      const pk = nearest(tgt), pocket = P[pk];
      const dist = d(tgt, pocket) || 1;
      const dir = [(pocket[0] - tgt[0]) / dist, (pocket[1] - tgt[1]) / dist];
      let start = pos.cue;
      if (s.bih || !start) {
        start = round([tgt[0] - dir[0] * 140, tgt[1] - dir[1] * 140]);
        if (!free(start, ['cue'])) start = spot(['cue'], 60, 940, 40, 460);
      }
      const contact = round([tgt[0] - dir[0] * 2 * R, tgt[1] - dir[1] * 2 * R]);
      ev.firstContact = s.target;
      if (s.conf) ev.confidence.firstContact = s.conf;
      if (s.pot) { delete pos[s.target]; ev.potted.push(s.target); ev.pockets[s.target] = pk; }
      else {
        const move = Math.min(dist - 50, 70 + rnd() * 60);
        const np = round([tgt[0] + dir[0] * move, tgt[1] + dir[1] * move]);
        pos[s.target] = free(np, [String(s.target)]) ? np : tgt;
      }
      (s.extra || []).forEach(b => { if (pos[b]) { ev.pockets[b] = nearest(pos[b]); delete pos[b]; ev.potted.push(b); } });
      let rest;
      if (s.scratch) {
        const sp = P.map((q, i) => i).filter(i => i !== pk).sort((a, b) => d(contact, P[a]) - d(contact, P[b]))[0];
        rest = P[sp]; ev.cueBallPotted = true; delete pos.cue;
      } else {
        rest = null;
        for (let i = 0; i < 40 && !rest; i++) {
          const ang = (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.7);
          const len = 70 + rnd() * 160;
          const c = Math.cos(ang), sn = Math.sin(ang);
          const p = round([contact[0] + (dir[0] * c - dir[1] * sn) * len, contact[1] + (dir[0] * sn + dir[1] * c) * len]);
          if (free(p, ['cue'])) rest = p;
        }
        if (!rest) rest = spot(['cue'], 60, 940, 40, 460);
        pos.cue = rest;
      }
      ev.cuePath = [start, contact, round(rest)];
    }
    ev.positions = clone(pos);
    events.push(ev);
  });
  return events;
}
