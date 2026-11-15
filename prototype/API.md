# 🎱 Pool Referee System: setup + API

Three pieces:

| File | What it is |
|---|---|
| `pool-referee-system.n8n.json` | The whole backend: AI shot scoring, game engine (turns, groups, fouls, winner), ELO ranking, queue. One n8n workflow. |
| `table-camera.html` | Runs on the device mounted above the table. Watches the live camera, detects each shot automatically, sends it to n8n. |
| `table-display.html` | Reference UI: scoreboard, last shot, queue, leaderboard, staff controls. Copy what you need into your own UI. |

---

## 1. Setup (15 min)

1. **n8n:** create a new workflow → paste the contents of `pool-referee-system.n8n.json`.
2. In **AI Analyze Shot (OpenRouter)** replace `YOUR_OPENROUTER_API_KEY` (keep `Bearer `).
3. **Save → Activate / Publish.** The game state is stored in the workflow's static data, which only persists for *production* runs. Always use `/webhook/…` URLs, never `/webhook-test/…`.
4. Deactivate any older shot-scorer workflows.
5. Your **base URL** is `https://YOUR-NAME.app.n8n.cloud/webhook`. Both pages ask for it once and remember it.

### Camera device
- **Laptop/webcam:** in the folder with the HTML files run `python3 -m http.server 8000`, open `http://localhost:8000/table-camera.html` in Chrome.
- **Phone above the table:** the camera only works on `https://`. Put `table-camera.html` on GitHub Pages or Netlify Drop, open it on the phone.
- **Demo without a table:** Source → *Video file (demo replay)*. The page treats the video exactly like a live feed. Start the clip with ~3 s of a still table (calibration).

### Camera checklist
1. Mount the camera above the table, as straight-down as possible, table filling the frame.
2. **Start**, keep the table still for 3 s (calibration measures camera noise).
3. **Set table area**: click the top-left and bottom-right corners of the table (outside the pockets).
4. Play. Each shot is detected when the balls stop for 1.5 s. If a player only leans over the table and no ball moves, it is ignored.
5. Shots are queued and sent one at a time, so fast play is fine.

---

## 2. How a shot flows

```
table-camera.html                        n8n workflow
───────────────────                      ─────────────────────────────────────────────
motion starts → keep "before" frame
balls stop 1.5 s → "after" frame
balls actually moved? ──yes──► POST /pool-score  ──►  AI describes shot (OpenRouter)
                                                  ──►  Score Shot: 0-100 (fixed rubric)
                                                  ──►  POST /pool-apply (same workflow)
                                                         Game Engine: who shot, keep turn?
                                                         groups, fouls, 8-ball, winner, ELO
                     ◄────────── JSON: score + game result + full table state
```

The camera never needs to know who is shooting. The engine knows whose turn it is and applies the rules.

---

## 3. Endpoints

All responses are JSON with `Access-Control-Allow-Origin: *`.
**Send POST bodies as `application/x-www-form-urlencoded` (`new URLSearchParams(...)`) or `FormData`.** That avoids CORS preflight issues. JSON bodies also work if your origin is allowed.

Every JSON endpoint returns the same envelope:

```json
{ "ok": true, "table": { ...TableState }, "leaderboard": [ ...Player ], "tables": ["T1"], "server_time": "..." }
{ "ok": false, "error": "human readable message", "table": { ... } }
```

### `GET /pool-state?table=T1`
Read-only. Poll it every 1-3 s from your UI.

### `POST /pool-match`
Start a match.

| field | example | notes |
|---|---|---|
| `table` | `T1` | |
| `players` | `Ali,Bora` | first player breaks |
| `game_type` | `8` / `9` / `10` | default 8 |
| `force` | `1` | replace a match that is still being played |

### `POST /pool-action`
| `action` | extra fields | effect |
|---|---|---|
| `undo` | | reverts the last shot or manual change (also reverts a finished match and its ratings) |
| `switch_turn` | | gives the turn to the other player |
| `foul` | | manual foul: turn passes, ball in hand |
| `set_group` | `player`, `group=solids\|stripes` | fixes 8-ball groups |
| `end_match` | `winner` | ends the match manually, updates ratings |
| `next_match` | | winner stays on, first person in the queue is called and breaks |
| `reset_table` | | clears the table |

### `POST /pool-queue`
| field | values |
|---|---|
| `action` | `join` (default) / `leave` |
| `name` | player name |

`join` also returns `"position": 2`.

### `POST /pool-score` (used by the camera)
Multipart: `table`, `frame_start`, `frame_mid_1..6`, `frame_end`, `frame_diff` (JPEGs; file name of each mid frame = its time in seconds).
Returns the shot + game result:

```json
{
  "ok": true, "engine": "openrouter-v4",
  "player": "Ali", "score": 78, "grade": "Good",
  "breakdown": { "pot": 55, "cue_ball": 15, "difficulty_bonus": 10, "foul": false },
  "potted_balls": ["solid 3"], "foul_reason": null,
  "observations": "…", "tip": "…", "confidence": 0.84, "needs_review": false,
  "game": { "practice": false, "shooter": "Ali", "keeps_turn": true, "turn_after": "Ali",
            "reason": "Ali takes solids and keeps shooting", "ball_in_hand": false,
            "finished": false, "winner": null },
  "table": { ...TableState }
}
```

`/pool-apply` is internal (protected by a secret inside the workflow). Don't call it from the UI.

---

## 4. TableState

```jsonc
{
  "table_id": "T1",
  "match": {                       // null when the table is free
    "id": "M12", "game_type": "8-ball", "status": "playing",   // or "finished"
    "shooter": "Ali",              // whose turn it is (null when finished)
    "ball_in_hand": false,
    "players": [
      { "name": "Ali",  "group": "solids",  "balls_left": 4, "rating": 1532, "is_shooting": true },
      { "name": "Bora", "group": "stripes", "balls_left": 6, "rating": 1488, "is_shooting": false }
    ],
    "shots_count": 9, "last_reason": "Own ball potted: Ali keeps shooting",
    "winner": null, "loser": null, "end_reason": null,
    "rating_delta": null,          // { "Ali": 23, "Bora": -20 } once finished
    "performance": null,           // average shot score per player once finished
    "can_undo": true, "started_at": "…", "ended_at": null
  },
  "queue": [ { "name": "Cem", "position": 1, "est_wait_min": 6, "joined_at": "…" } ],
  "next_up": "Cem",                // set when a match finishes and someone is waiting
  "called":  { "name": "Cem", "at": "…" },   // last person called to the table → show "It's your turn!"
  "last_shot": { …Shot },
  "recent_shots": [ …Shot ]        // newest first, max 10
}
```

**Shot:** `id, player, score, grade, potted[], foul, foul_reason, reason, keeps_turn, turn_after, tip, observations, confidence, needs_review, at`

**Leaderboard player:** `name, rating, matches, wins, losses, win_rate, avg_shot, shots, fouls, best_shot, badges[]` (`sharpshooter`, `fair_play`, `best_shot`), sorted by rating.

---

## 5. Rules the engine applies

**8-ball**
- Break: any ball potted → shooter continues, table stays open.
- Open table: first legal pot assigns the group (solids 1-7 / stripes 9-15).
- Own ball potted, no foul → keep shooting. Otherwise the turn passes.
- Foul or scratch → turn passes, **ball in hand**.
- 8-ball: legal only after the shooter's group is cleared. Early 8 or 8 with a foul → opponent wins.

**9-ball / 10-ball:** potted something without a foul → continue. Money ball (9 / 10) potted without a foul → win.

**Rating:** ELO (K = 48 for the first 5 matches, then 32) × margin multiplier (1 + 0.05 × balls the loser had left) + performance bonus from the player's average shot score in that match (±5).

---

## 6. Integrating your UI (copy-paste)

```js
const BASE = 'https://YOUR-NAME.app.n8n.cloud/webhook';
const TABLE = 'T1';

// read state (poll every 2 s)
const state = await (await fetch(`${BASE}/pool-state?table=${TABLE}`)).json();
const m = state.table.match;
// m.shooter → whose turn, m.players[i].balls_left, state.table.queue, state.leaderboard

// write (form-encoded = no preflight)
const post = (path, params) => fetch(`${BASE}/${path}`, { method: 'POST', body: new URLSearchParams({ table: TABLE, ...params }) }).then(r => r.json());
await post('pool-queue',  { action: 'join', name: 'Cem' });
await post('pool-match',  { players: 'Ali,Bora', game_type: '8' });
await post('pool-action', { action: 'undo' });
```

"It's your turn" notification: when `state.table.called.name` equals the logged-in user's name (and `called.at` is new), show the alert. The QR code at the table can simply open your UI with `?table=T1`.

---

## 7. Limits to know (and say in the pitch)

- State lives in n8n static data: perfect for a demo and one venue. For production, move it to Supabase/Postgres (same engine code).
- If two staff actions hit the exact same second, the last one wins. Shots are sent one by one by the camera, so they don't collide.
- The AI can misread a shot. That's why every shot has `confidence` / `needs_review`, and staff have **Undo**, **Switch turn**, **Set group**.
