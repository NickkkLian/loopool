// ===== Table camera screen =====
// Port of loopool/tablecamera.html: same motion-detection state machine, same thresholds, same /pool-score wire format.
// Changes from the original (deliberate): frames are FRAME_LONG_SIDE px (was 1568), MID_FRAMES mid frames are sent
// (was 6), one JPEG quality for every frame, the "Table now" panel polls our own GET {base}/pool?action=state, and
// the page chrome is restyled with the app's own tokens. No external libraries. localStorage is optional.
//
//   CameraView.mount(el, { base: 'https://x.app.n8n.cloud/webhook', table: 'T1' })  ->  { destroy() }
(function () {
  'use strict';

  // ---- constants (detection ones are his, verbatim) ----
  const TICK_MS = 125;            // detection tick
  const SMALL_W = 240;            // width of the grayscale frame used for motion
  const CALIB_MS = 2500;          // calibration window
  const SETTLE_MS = 750;          // the first part of it is ignored
  const STILL_MS = 1500, MOVED_MIN = 0.0005, MAX_SHOT_MS = 30000;
  const MID_EVERY_MS = 350;       // mid-shot frame grab interval
  const FRAME_LONG_SIDE = 1024;   // long side of every frame sent to the AI (his page: 1568)
  const MID_FRAMES = 4;           // mid frames sent per shot (his page: 6)
  const JPEG_QUALITY = 0.82;
  const POLL_MS = 3000;

  const CSS = `
.cam-view{--c-board:var(--board,#1c2723);--c-board2:var(--board-2,#233029);--c-board3:var(--board-3,#2a3832);--c-tv:var(--tv,#121a17);
  --c-line:var(--line,#33413b);--c-line2:var(--line-2,#3a4842);--c-line3:var(--line-3,#5b6a63);--c-chalk:var(--chalk,#ecefe9);--c-dim:var(--dim,#a4afa8);--c-faint:var(--faint,#8e9b94);
  --c-brass:var(--brass,#e5ad3e);--c-blue:var(--blue,#5b9be8);--c-blueink:var(--blue-ink,#0e1714);--c-bluetext:var(--blue-text,#8fbcf2);--c-foul:var(--foul,#ff7a6b);--c-good:var(--good,#67d394);
  --c-sign:var(--f-sign,"Big Shoulders","Arial Narrow",sans-serif);--c-body:var(--f-body,system-ui,-apple-system,"Segoe UI",sans-serif);--c-mono:var(--f-mono,ui-monospace,Menlo,monospace);
  color:var(--c-chalk);font:15px/1.45 var(--c-body);display:grid;grid-template-columns:minmax(0,1.55fr) minmax(340px,1fr);gap:24px;align-items:start}
.cam-view *{box-sizing:border-box}
.cam-view .cam-col{display:grid;gap:18px;min-width:0}
.cam-view .cam-label{font:500 11px/1.3 var(--c-mono);letter-spacing:.14em;text-transform:uppercase;color:var(--c-dim)}
.cam-view .cam-sign{font-family:var(--c-sign);font-weight:800;letter-spacing:.04em;text-transform:uppercase;line-height:.95}
.cam-view .cam-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;min-height:36px}
.cam-view .cam-head h2{margin:0;font-size:30px}
.cam-view .cam-pill{display:inline-flex;align-items:center;gap:8px;min-height:30px;padding:0 12px;border-radius:6px;border:1px solid var(--c-line2);font:500 12px var(--c-mono);letter-spacing:.08em;text-transform:uppercase;color:var(--c-dim)}
.cam-view .cam-pill::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--c-faint)}
.cam-view .cam-pill.watching{color:var(--c-good)}.cam-view .cam-pill.watching::before{background:var(--c-good)}
.cam-view .cam-pill.motion{color:var(--c-brass);border-color:var(--c-brass)}.cam-view .cam-pill.motion::before{background:var(--c-brass)}
.cam-view .cam-pill.paused{color:var(--c-foul)}.cam-view .cam-pill.paused::before{background:var(--c-foul)}
.cam-view .cam-pill.calibrating{color:var(--c-bluetext)}.cam-view .cam-pill.calibrating::before{background:var(--c-blue)}
.cam-view .cam-meter{font:400 12px var(--c-mono);color:var(--c-faint)}
.cam-view .cam-top{grid-column:1/-1;display:flex;align-items:center;gap:12px 16px;flex-wrap:wrap;min-height:36px}
.cam-view .cam-top h2{margin:0;font-size:30px}
.cam-view .cam-brand{margin-left:auto;display:flex;align-items:center;gap:16px}
.cam-view .cam-brand a{color:var(--c-bluetext);font-size:14px;font-weight:500;text-decoration:none;min-height:36px;display:inline-flex;align-items:center}
.cam-view .cam-brand span{display:inline-flex;align-items:center;gap:10px;font:800 22px/1 var(--c-sign);letter-spacing:.06em}
.cam-view .cam-stage{position:relative;background:#050807;border:1px solid var(--c-line);border-radius:10px;overflow:hidden;aspect-ratio:16/9}
.cam-view .cam-stage.live{aspect-ratio:auto}
.cam-view video{display:block;width:100%;height:auto;background:#000}
.cam-view .cam-stage:not(.live) video{position:absolute;inset:0;height:100%;opacity:0}
.cam-view canvas.cam-ov{position:absolute;inset:0;width:100%;height:100%}
.cam-view .cam-empty{position:absolute;inset:0;display:grid;place-content:center;gap:8px;text-align:center;padding:20px;color:var(--c-dim)}
.cam-view .cam-empty b{font:800 28px/1 var(--c-sign);letter-spacing:.05em;text-transform:uppercase;color:var(--c-chalk)}
.cam-view .cam-stage.live .cam-empty{display:none}
.cam-view .cam-btns{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.cam-view .cam-b{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:0 14px;border-radius:6px;border:1px solid var(--c-line2);background:transparent;color:var(--c-chalk);font:600 13.5px var(--c-body);cursor:pointer}
.cam-view .cam-b:hover:not(:disabled){border-color:var(--c-line3)}
.cam-view .cam-b:disabled{opacity:.4;cursor:not-allowed}
.cam-view .cam-b.go{background:var(--c-blue);border-color:var(--c-blue);color:var(--c-blueink)}
.cam-view .cam-b.on{border-color:var(--c-brass);color:var(--c-brass)}
.cam-view .cam-hint{font-size:13px;color:var(--c-dim);min-height:1.45em}
.cam-view .cam-hint.err,.cam-view .cam-err{color:var(--c-foul)}
.cam-view .cam-card{background:var(--c-board2);border:1px solid var(--c-line);border-radius:10px;padding:16px;display:grid;gap:12px}
.cam-view .cam-card h3{margin:0;font-size:22px}
.cam-view .cam-field{display:grid;gap:6px}
.cam-view select,.cam-view input[type=file]{width:100%;min-height:42px;padding:8px 12px;border-radius:8px;border:1px solid var(--c-line2);background:var(--c-board);color:var(--c-chalk);font:14px var(--c-body)}
.cam-view input[type=file]{padding:5px 12px 5px 5px;color:var(--c-dim)}
.cam-view input[type=file]::file-selector-button{margin-right:12px;min-height:30px;padding:0 12px;border-radius:6px;border:1px solid var(--c-line3);background:transparent;color:var(--c-chalk);font:600 13.5px var(--c-body);cursor:pointer}
.cam-view .cam-conn{font:400 12px/1.5 var(--c-mono);color:var(--c-dim);overflow-wrap:anywhere}
.cam-view .cam-now-game{font:500 12px var(--c-mono);letter-spacing:.1em;text-transform:uppercase;color:var(--c-dim)}
.cam-view .cam-turn{font:800 38px/1 var(--c-sign);letter-spacing:.03em;text-transform:uppercase}
.cam-view .cam-turn small{font:500 12px var(--c-mono);letter-spacing:.1em;color:var(--c-brass);margin-left:8px}
.cam-view .cam-players{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.cam-view .cam-pc{border:1px solid var(--c-line2);border-radius:8px;padding:10px 12px;display:grid;gap:2px;min-width:0}
.cam-view .cam-pc.on{border-color:var(--c-good)}
.cam-view .cam-pc b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cam-view .cam-pc span{font:400 12px var(--c-mono);color:var(--c-dim)}
.cam-view .cam-log{display:flex;flex-direction:column;max-height:560px;overflow-y:auto}
.cam-view .cam-item{display:grid;grid-template-columns:52px minmax(0,1fr);gap:12px;padding:12px 0;border-bottom:1px solid var(--c-line);font-size:14px}
.cam-view .cam-item:last-child{border-bottom:0}
.cam-view .cam-ring{--p:0;--c:var(--c-line3);width:48px;height:48px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--c) calc(var(--p)*1%),var(--c-line) 0);position:relative;font:800 20px/1 var(--c-sign);color:var(--c)}
.cam-view .cam-ring::before{content:"";position:absolute;inset:4px;border-radius:50%;background:var(--c-board2)}
.cam-view .cam-ring span{position:relative}
.cam-view .cam-item .t{font:400 11.5px var(--c-mono);color:var(--c-faint);letter-spacing:.04em}
.cam-view .cam-item .who{font-weight:600}
.cam-view .cam-item .foul,.cam-view .cam-item .errtxt{color:var(--c-foul)}
.cam-view .cam-item .next{color:var(--c-good)}
.cam-view .cam-item .check{color:var(--c-brass)}
.cam-view .cam-item .mut{color:var(--c-dim)}
.cam-view .cam-item .tip{color:var(--c-bluetext)}
.cam-view .cam-none{color:var(--c-dim);font-size:14px}
@media (max-width:900px){.cam-view{grid-template-columns:minmax(0,1fr);gap:18px}.cam-view .cam-top h2{font-size:26px}.cam-view .cam-turn{font-size:32px}}
`;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem('poolcam.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('poolcam.' + k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  };

  function mount(el, opts) {
    opts = opts || {};
    const tableId = () => String(opts.table || 'T1').trim().toUpperCase();
    const base = () => String(opts.base || '').trim().replace(/\/+$/, '').replace(/\/(pool-[a-z]+)$/, '');

    if (!document.getElementById('cam-view-style')) {
      const st = document.createElement('style'); st.id = 'cam-view-style'; st.textContent = CSS; document.head.appendChild(st);
    }
    el.innerHTML = `
<div class="cam-view">
  <div class="cam-top"><h2 class="cam-sign">Table camera</h2><span class="cam-pill" data-r="pill" role="status">Stopped</span><span class="cam-meter" data-r="meter"></span>
    <div class="cam-brand"><a href="#presenter">All screens</a><span><svg width="26" height="24" viewBox="0 0 26 24" aria-hidden="true"><path d="M13 2.5 24 21.5H2Z" fill="none" stroke="#e5ad3e" stroke-width="2.2" stroke-linejoin="round"/><circle cx="13" cy="15" r="3.4" fill="#ecefe9"/></svg>LOOPOOL</span></div></div>
  <section class="cam-col">
    <div class="cam-stage" data-r="stage">
      <video data-r="v" playsinline muted></video>
      <canvas class="cam-ov" data-r="ov"></canvas>
      <div class="cam-empty"><b>No picture yet</b><span>Choose a source, then press Start.</span></div>
    </div>
    <div class="cam-btns">
      <button class="cam-b" data-r="pauseBtn" disabled title="Stop counting shots for a while, for example while the balls are being set up">Pause</button>
      <button class="cam-b" data-r="manualBtn" disabled title="If the camera missed a shot, send the table as it is now to the referee">Send a missed shot</button>
    </div>
    <div class="cam-hint" data-r="hint">Put the camera above the table so the table fills the picture, then press Start. Keep the table still for 3 seconds while the camera gets ready.</div>
  </section>
  <section class="cam-col">
    <div class="cam-card">
      <h3 class="cam-sign">Setup</h3>
      <div class="cam-conn" data-r="conn"></div>
      <div class="cam-field"><span class="cam-label">Picture from</span>
        <select data-r="src" aria-label="Picture from"><option value="camera">This device's camera</option><option value="file">A recorded video (for demos)</option></select></div>
      <div class="cam-field" data-r="camRow"><span class="cam-label">Which camera</span>
        <select data-r="dev" aria-label="Which camera"><option value="">Back camera (usual choice)</option></select></div>
      <div class="cam-field" data-r="fileRow" style="display:none"><span class="cam-label">Video file</span>
        <input type="file" data-r="file" accept="video/*" aria-label="Video file"></div>
      <div class="cam-field"><span class="cam-label">Ball colours</span>
        <select data-r="balls" aria-label="Ball colours" title="The AI names balls by colour. Telling it this table's set makes it name the right ball far more often."><option value="standard">Usual colours (4 purple, 5 orange, 7 maroon)</option><option value="pink">4 pink, 5 purple, 7 orange</option></select></div>
      <div class="cam-btns"><button class="cam-b go" data-r="startBtn">Start</button><button class="cam-b" data-r="stopBtn" disabled>Stop</button></div>
      <div class="cam-hint err" data-r="setupErr"></div>
    </div>
    <div class="cam-card">
      <h3 class="cam-sign">Table now</h3>
      <div data-r="now" class="cam-none">Checking the table…</div>
    </div>
    <div class="cam-card">
      <h3 class="cam-sign">Shots</h3>
      <div class="cam-log" data-r="log"><div class="cam-none" data-r="nolog">No shots yet. Each shot the camera sees is listed here with its score.</div></div>
    </div>
  </section>
</div>`;
    const root = el.querySelector('.cam-view');
    const R = {}; root.querySelectorAll('[data-r]').forEach(n => { R[n.dataset.r] = n; });
    const v = R.v, ov = R.ov, octx = ov.getContext('2d');
    const cs = getComputedStyle(root);
    const tok = (n, d) => (cs.getPropertyValue(n).trim() || d);
    const COL = { good: tok('--c-good', '#67d394'), brass: tok('--c-brass', '#e5ad3e'), foul: tok('--c-foul', '#ff7a6b'), lime: '#b6e36b' };
    const fontSans = tok('--c-body', 'sans-serif');

    // ---------------- settings (remembered when storage works) ----------------
    const tableName = () => tableId().replace(/^T(\d+)$/, 'Table $1');
    const NO_VENUE = 'Shot seen, but not scored: this demo page is not connected to a venue.';
    R.conn.textContent = base() ? `${tableName()} · shots go to ${base().replace(/^https?:\/\//, '').replace(/\/webhook.*$/, '')}` : `${tableName()} · demo page. It sees shots but cannot score them. To score, open the camera from the venue's own link (it ends in /pool-app#camera).`;
    if (!base()) { R.now.textContent = 'A demo page has no live game to show.'; }
    R.src.value = store.get('src', 'camera') === 'file' ? 'file' : 'camera';
    let wantDev = store.get('dev', '');
    const syncSrc = () => { R.camRow.style.display = R.src.value === 'camera' ? '' : 'none'; R.fileRow.style.display = R.src.value === 'file' ? '' : 'none'; };
    syncSrc();
    R.src.onchange = () => { store.set('src', R.src.value); syncSrc(); };
    R.balls.value = store.get('balls', 'standard') === 'pink' ? 'pink' : 'standard';
    R.balls.onchange = () => store.set('balls', R.balls.value);
    R.dev.onchange = () => { wantDev = R.dev.value; store.set('dev', wantDev); };

    // ---------------- video + geometry ----------------
    // the camera is mounted once, looking straight down, and watches the whole picture with fixed levels: a shot starts when
    // more than 0.3% of the picture changes between two looks and ends after 1.5 s below 0.1%. Fixed levels caught 169 of 193
    // hand-labelled shots (10 overhead videos and the demo clip) with 7 false ones; levels scaled to the measured background
    // movement caught at most 126 and none on the demo clip (vision/camera_threshold_sweep.py, camera_sens_sweep.py).
    const START_LEVEL = 0.003, END_LEVEL = 0.001;
    function srcRect() { return [0, 0, v.videoWidth, v.videoHeight]; }
    const sc = document.createElement('canvas'), sctx = sc.getContext('2d', { willReadFrequently: true });
    function smallGray() {
      const [sx, sy, sw, sh] = srcRect(); const w = SMALL_W, h = Math.max(1, Math.round(SMALL_W * sh / sw));
      if (sc.width !== w || sc.height !== h) { sc.width = w; sc.height = h; }
      sctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, h);
      const d = sctx.getImageData(0, 0, w, h).data, g = new Uint8Array(w * h);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = (d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10;
      return g;
    }
    function diffFrac(a, b, th) { if (!a || !b || a.length !== b.length) return 0; let c = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > th) c++; return c / a.length; }
    function captureFull() {
      const [sx, sy, sw, sh] = srcRect(), s = FRAME_LONG_SIDE / Math.max(sw, sh), c = document.createElement('canvas');
      c.width = Math.round(sw * s); c.height = Math.round(sh * s);
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height); return c;
    }
    const toBlob = (c, q) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('frame')), 'image/jpeg', q == null ? JPEG_QUALITY : q));
    function diffCanvas(a, b) {
      const c = document.createElement('canvas'); c.width = a.width; c.height = a.height;
      const A = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, B = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
      const g = c.getContext('2d'), out = g.createImageData(a.width, a.height);
      for (let i = 0; i < A.length; i += 4) { const d = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]); const x = d > 90 ? 255 : 0; out.data[i] = out.data[i + 1] = out.data[i + 2] = x; out.data[i + 3] = 255; }
      g.putImageData(out, 0, 0); return c;
    }

    // ---------------- detection state machine ----------------
    let running = false, paused = false, timer = null, state = 'stopped';
    let prev = null, onCount = 0, quietSince = null, motionStart = 0, stillSince = null, lastMid = 0, mids = [];
    let still = null;                       // { canvas, small, at } = last calm table image (the "before" frame)
    let before = null, calib = null, ON = 0.004, OFF = 0.0008, lastM = 0, lastFrameT = -1;

    const PILL = { stopped: 'Stopped', calibrating: 'Getting ready…', idle: 'Watching', motion: 'Shot in progress', paused: 'Paused' };
    function setState(s) { state = s; R.pill.textContent = PILL[s] || s; R.pill.className = 'cam-pill ' + ({ idle: 'watching', motion: 'motion', paused: 'paused', calibrating: 'calibrating' }[s] || ''); }
    function resetRef() { prev = null; still = null; onCount = 0; quietSince = null; if (running && !paused) startCalibration(); }
    function startCalibration() { calib = { start: performance.now(), samples: [] }; setState('calibrating'); }

    function tick() {
      if (!running || v.readyState < 2 || !v.videoWidth) return;
      if (v.srcObject == null && v.currentTime === lastFrameT && !v.paused) return;   // file replay: wait for a new frame
      lastFrameT = v.currentTime;
      const t = performance.now(), g = smallGray();
      const m = diffFrac(g, prev, 18); prev = g; lastM = m;
      if (calib) {
        if (t - calib.start > SETTLE_MS) calib.samples.push(m);   // skip the start: a camera adjusting its exposure or a video's first frames are not table noise
        if (t - calib.start > CALIB_MS) {
          const s = calib.samples.slice().sort((a, b) => a - b), p95 = s[Math.floor(s.length * 0.95)] || 0;
          OFF = END_LEVEL; ON = START_LEVEL;   // p95 is only shown in the hint below
          calib = null; still = { canvas: captureFull(), small: g, at: t }; setState('idle');
          R.hint.className = 'cam-hint';
          R.hint.textContent = 'Ready. Watching the table for shots.';
          R.hint.title = `Background movement ${(p95 * 100).toFixed(3)}% · a shot starts above ${(ON * 100).toFixed(2)}% · ends below ${(OFF * 100).toFixed(2)}%`;
        }
        draw(m); return;
      }
      if (paused) { draw(m); return; }
      if (state === 'idle') {
        if (m > ON) {
          if (++onCount >= 2) { setState('motion'); motionStart = t; stillSince = null; mids = []; lastMid = 0; before = still; }
        } else {
          onCount = 0;
          if (m < OFF) { quietSince = quietSince || t; if (t - quietSince > 800 && (!still || t - still.at > 1500)) still = { canvas: captureFull(), small: g, at: t }; }
          else quietSince = null;
        }
      } else if (state === 'motion') {
        if (t - lastMid > MID_EVERY_MS) {
          lastMid = t; const rel = (t - motionStart) / 1000;
          toBlob(captureFull()).then(b => { mids.push({ t: rel, blob: b }); if (mids.length > 40) mids.splice(1, 1); }).catch(() => {});
        }
        if (m < OFF) { stillSince = stillSince || t; if (t - stillSince > STILL_MS) finishShot(g, t); }
        else stillSince = null;
        if (t - motionStart > MAX_SHOT_MS) finishShot(g, t);
      }
      draw(m);
    }
    function finishShot(g, t) {
      const b = before, after = captureFull(), dur = (t - motionStart) / 1000, myMids = mids.slice();
      setState('idle'); onCount = 0; quietSince = t; still = { canvas: after, small: g, at: t };
      if (!b) { addLog({ status: 'ignored', text: 'Something moved before the camera was ready. Not counted.' }); return; }
      const moved = diffFrac(b.small, g, 40);
      if (moved < MOVED_MIN) { addLog({ status: 'ignored', text: 'Something moved, but no ball changed place. Not counted.' }); return; }
      enqueue({ before: b.canvas, after, mids: myMids, dur, moved });
    }
    function scoreNow() {
      if (!still) { R.setupErr.textContent = 'Wait until the camera says "Watching", then try again.'; return; }
      R.setupErr.textContent = '';
      enqueue({ before: still.canvas, after: captureFull(), mids: [], dur: 0, moved: null, manual: true });
    }

    // ---------------- sending ----------------
    const queue = []; let busy = false, seq = 0, destroyed = false;
    function enqueue(p) { p.id = ++seq; p.li = addLog({ status: 'queued', text: p.manual ? 'Shot sent by hand. Waiting its turn…' : `Shot seen (${p.dur.toFixed(1)} s). Waiting its turn…` }); queue.push(p); pump(); }
    function sample(arr, n) { if (arr.length <= n) return arr; const out = []; for (let i = 0; i < n; i++) out.push(arr[Math.round(i * (arr.length - 1) / (n - 1))]); return out; }
    async function pump() {
      if (busy || !queue.length) return;
      busy = true; const p = queue.shift(); const t0 = Date.now();
      updateLog(p.li, { status: 'sending', text: 'The AI referee is looking at the photos…' });
      try {
        if (!base()) throw new Error(NO_VENUE);
        const fd = new FormData();
        fd.append('table', tableId());
        fd.append('ball_set', R.balls.value);
        fd.append('frame_start', await toBlob(p.before), '0.00.jpg');
        sample(p.mids, MID_FRAMES).forEach((m, i) => fd.append('frame_mid_' + (i + 1), m.blob, m.t.toFixed(2) + '.jpg'));
        fd.append('frame_end', await toBlob(p.after), Math.max(0.01, p.dur).toFixed(2) + '.jpg');
        fd.append('frame_diff', await toBlob(diffCanvas(p.before, p.after)), 'diff.jpg');
        const res = await fetch(base() + '/pool-score', { method: 'POST', body: fd });
        const raw = await res.text(); let d;
        try { d = JSON.parse(raw); } catch (e) { throw new Error(`Not scored: the venue's server gave an answer the camera could not read (code ${res.status}). Try the next shot; if it keeps happening, tell whoever runs the n8n workflow.`); }
        if (!d.ok) throw new Error('Not scored: ' + (d.error || d.message || 'the AI referee could not read this shot.') + (d.raw ? ' · AI said: ' + String(d.raw).slice(0, 160) : ''));
        updateLog(p.li, { status: 'done', data: d, secs: Math.round((Date.now() - t0) / 1000) });
        pollState();
      } catch (e) {
        updateLog(p.li, { status: 'error', text: /fetch|load failed|network/i.test(e.message) ? 'Not scored: the venue\'s server did not answer. Check the internet connection and that the n8n workflow is switched on.' : e.message });
      } finally { busy = false; pump(); }
    }

    // ---------------- UI: shot log ----------------
    const ringColor = s => s >= 85 ? COL.good : s >= 70 ? COL.lime : s >= 50 ? COL.brass : COL.foul;
    function addLog(o) {
      if (R.nolog && R.nolog.parentNode) R.nolog.remove();
      const li = document.createElement('div'); li.className = 'cam-item'; R.log.prepend(li); updateLog(li, o); return li;
    }
    function updateLog(li, o) {
      const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
      if (o.status === 'done') {
        const d = o.data, g = d.game || {}, sc = Math.max(0, Math.min(100, Math.round(+d.score || 0)));
        const player = d.player || g.shooter || '';
        li.innerHTML = `<div class="cam-ring" style="--p:${sc};--c:${ringColor(sc)}"><span>${sc}</span></div>
      <div><div><span class="who">${esc(player || 'Shot')}</span> · ${esc(d.grade || '')} <span class="t">· ${esc(time)} · ${o.secs}s</span></div>
      ${d.foul_reason ? `<div class="foul">Foul: ${esc(d.foul_reason)}</div>` : ''}
      ${g.reason ? `<div>${esc(g.reason)}</div>` : (d.skipped ? '<div>Not counted</div>' : '')}
      ${g.finished ? `<div class="next">${esc(g.winner)} wins the game</div>` : (g.turn_after ? `<div class="next">Next shooter: ${esc(g.turn_after)}${g.ball_in_hand ? ' (ball in hand)' : ''}</div>` : '')}
      ${d.needs_review ? '<div class="check">The AI is not sure about this one. Please check it.</div>' : ''}
      ${d.apply_error ? `<div class="errtxt">Scored, but the game was not updated: ${esc(d.apply_error)}</div>` : ''}
      ${d.tip ? `<div class="tip">Tip: ${esc(d.tip)}</div>` : ''}
      ${d.observations ? `<div class="mut">${esc(d.observations)}</div>` : ''}</div>`;
      } else {
        const icon = { queued: '…', sending: 'AI', ignored: '·', error: '!' }[o.status] || '';
        const cls = o.status === 'error' ? 'errtxt' : o.status === 'ignored' ? 'mut' : '';
        li.innerHTML = `<div class="cam-ring" style="--p:${o.status === 'error' ? 100 : 0};--c:${o.status === 'error' ? COL.foul : 'var(--c-line3)'}"><span style="font-size:16px">${icon}</span></div>
      <div class="${cls}">${esc(o.text)}<div class="t">${esc(time)}</div></div>`;
      }
    }

    // ---------------- UI: "Table now" (our GET {base}/pool?action=state) ----------------
    const GROUP_BALLS = { solids: [1, 2, 3, 4, 5, 6, 7], stripes: [9, 10, 11, 12, 13, 14, 15] };
    function renderNow(j) {
      const t = (j.tables || []).find(x => x.id === tableId());
      if (!t) { R.now.className = 'cam-none'; R.now.textContent = `${tableName()} is not set up at this venue.`; return; }
      const g = t.game;
      if (!g) { R.now.className = 'cam-none'; R.now.textContent = 'No game on this table right now. Staff can start one on the counter tablet.'; return; }
      R.now.className = '';
      const seat = s => (t[s] && t[s].name) || (s === 'champ' ? 'Player 1' : 'Player 2');
      const left = s => {
        const grp = g.groups && g.groups[s];
        if (t.gameType === '8-ball' || grp) {
          if (!grp) return 'open table';
          const n = (g.onTable || []).filter(b => (GROUP_BALLS[grp] || []).includes(b)).length;
          return `${grp} · ${n} left`;
        }
        return '';
      };
      const players = ['champ', 'challenger'].map(s => `<div class="cam-pc ${g.turn === s ? 'on' : ''}"><b>${esc(seat(s))}</b><span>${esc(left(s) || (t[s] && t[s].rating ? 'rating ' + t[s].rating : ''))}</span></div>`).join('');
      const shots = (g.shots || []).length ? g.shots[g.shots.length - 1].no : 0;
      const head = `<div class="cam-now-game">${esc(t.gameType || '')}${shots ? ' · shot ' + shots : ''}</div>`;
      let body;
      if (g.status === 'confirm' || g.winner) {
        body = `<div class="cam-turn">${esc(seat(g.winner))} won</div><div class="cam-none">${esc(g.winReason || '')}${g.status === 'confirm' ? ' · Waiting for both players to confirm.' : ''}</div>`;
      } else if (g.turn) {
        body = `<div class="cam-turn">${esc(seat(g.turn))} to shoot${g.ballInHand ? '<small>BALL IN HAND</small>' : ''}</div>${g.status === 'review' || g.status === 'staff' ? '<div class="cam-none">A foul call is being reviewed.</div>' : ''}`;
      } else {
        body = `<div class="cam-none">Game running. No shots recorded yet.</div>`;
      }
      R.now.innerHTML = `${head}${body}<div class="cam-players" style="margin-top:12px">${players}</div>`;
    }
    let pollBusy = false;
    async function pollState() {
      if (destroyed || !base() || pollBusy) return;
      pollBusy = true;
      try {
        const r = await fetch(`${base()}/pool?action=state`, { cache: 'no-store' }); const d = await r.json();
        if (d && d.ok !== false && d.tables) renderNow(d);
      } catch (e) { /* keep the last picture of the table */ }
      pollBusy = false;
    }
    const pollTimer = setInterval(pollState, POLL_MS);

    // ---------------- overlay ----------------
    function draw(m) {
      const r = ov.getBoundingClientRect(); if (ov.width !== Math.round(r.width) || ov.height !== Math.round(r.height)) { ov.width = Math.round(r.width); ov.height = Math.round(r.height); }
      const W = ov.width, H = ov.height; octx.clearRect(0, 0, W, H);
      if (m !== undefined && running) {
        const bw = Math.min(260, W - 24), lvl = Math.min(1, m / (ON * 2.5));
        octx.fillStyle = 'rgba(0,0,0,.6)'; octx.fillRect(12, H - 30, bw, 14);
        octx.fillStyle = m > ON ? COL.brass : COL.good; octx.fillRect(12, H - 30, bw * lvl, 14);
        octx.fillStyle = '#fff'; octx.fillRect(12 + bw * (1 / 2.5), H - 33, 2, 20);
        R.meter.textContent = `movement ${(m * 100).toFixed(2)}%`;
      }
    }
    const onResize = () => draw();
    window.addEventListener('resize', onResize);

    // ---------------- start / stop ----------------
    async function listDevices() {
      try {
        const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'), cur = R.dev.value || wantDev;
        R.dev.innerHTML = '<option value="">Back camera (usual choice)</option>' + devs.map((d, i) => `<option value="${esc(d.deviceId)}">${esc(d.label || 'Camera ' + (i + 1))}</option>`).join('');
        R.dev.value = cur; if (R.dev.value !== cur) R.dev.value = '';
      } catch (e) { /* no device list */ }
    }
    function stopAll() {
      running = false; clearInterval(timer); setState('stopped');
      if (v.srcObject) { v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null; }
      v.pause(); R.startBtn.disabled = false; R.stopBtn.disabled = true; R.pauseBtn.disabled = true; R.manualBtn.disabled = true;
    }
    async function start() {
      R.setupErr.textContent = '';
      stopAll();
      try {
        if (R.src.value === 'camera') {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('This browser will not share the camera with this page. Open the page from an https:// link, or pick "A recorded video" above.');
          const id = R.dev.value;
          const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: id ? { deviceId: { exact: id }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } } });
          v.srcObject = stream; await v.play(); listDevices();
        } else {
          const f = R.file.files[0]; if (!f) throw new Error('Choose a video file first.');
          v.removeAttribute('srcObject'); v.srcObject = null; v.src = URL.createObjectURL(f); v.loop = false; await v.play();
        }
      } catch (e) {
        const what = e.name + ' ' + e.message, fromCam = R.src.value === 'camera';
        R.setupErr.textContent = /Choose a video|will not share/.test(e.message) ? e.message
          : fromCam && /NotAllowed|Permission|denied/i.test(what) ? 'The camera is blocked for this page. Allow it in the browser\'s address bar, then press Start again.'
          : fromCam ? 'No camera could be started on this device. Check one is plugged in and not used by another app, or pick "A recorded video" above.'
          : 'This browser cannot play that video. Try an MP4 or WebM file.';
        return;
      }
      R.stage.classList.add('live');
      running = true; paused = false; prev = null; still = null; lastFrameT = -1;
      startCalibration(); timer = setInterval(tick, TICK_MS);
      R.startBtn.disabled = true; R.stopBtn.disabled = false; R.pauseBtn.disabled = false; R.manualBtn.disabled = false; R.pauseBtn.textContent = 'Pause';
      pollState();
    }
    v.onended = () => { setTimeout(() => { if (running && state !== 'motion') { addLog({ status: 'ignored', text: 'The video has finished. Press Start to play it again.' }); stopAll(); } }, STILL_MS + 1200); };
    R.startBtn.onclick = start;
    R.stopBtn.onclick = stopAll;
    R.pauseBtn.onclick = () => { paused = !paused; R.pauseBtn.textContent = paused ? 'Resume' : 'Pause'; if (paused) setState('paused'); else resetRef(); };
    R.manualBtn.onclick = scoreNow;
    if (store.get('src', 'camera') === 'camera') listDevices();
    setState('stopped');
    draw();
    pollState();

    return {
      destroy() { destroyed = true; stopAll(); clearInterval(pollTimer); window.removeEventListener('resize', onResize); el.innerHTML = ''; },
    };
  }

  window.CameraView = { mount };
})();
