# Loopool API

One n8n workflow (`pool-referee.n8n.json`) serves the app and every endpoint. Base URL: `https://YOUR-NAME.app.n8n.cloud/webhook`.
All JSON replies allow any origin (`Access-Control-Allow-Origin: *`). Always call the production `/webhook/…` URLs (not `/webhook-test/…`); state lives in the workflow's static data, which only persists for production runs.

| Endpoint | Method | Who calls it | What it does |
|---|---|---|---|
| `/pool-app` | GET | People | The whole app (phone, bar TV, counter tablet, camera). Views by hash: `#mobile`, `#tv`, `#venue`, `#camera`, `#presenter` (all screens + demo buttons). |
| `/pool?action=…` | GET | App, camera service, staff | Queue, game rules, staff tools. Returns the full public state. |
| `/pool-score` | POST multipart | Camera screen | Shot photos in; AI reading + 0-100 score + game result out. |
| `/pool-apply` | POST JSON | The workflow itself | Applies a scored shot to the game in a short run of its own (see below). Not for clients. |
| `/pool-frame?table=T1` | GET | TV, phones | The latest after-shot photo of a table (JPEG). |
| `/pool-act?a=…&t=…&k=…` | GET | Email buttons | Check in, vote on a foul, confirm a result or leave, from a player's email (keyed per ticket). |
| `/pool-lookup?url=…` | GET | Bar app set-up page | Auto-fill: reads a bar's website or Google Maps page (schema.org data first, then the AI) and returns `{ ok, profile, found[], error? }` for the bar to check. |
| `/pool-ask?q=…&ticket=…` | GET | Phone | "Ask the referee": an AI agent answers from the house rules and the live board. `{ ok, answer }` |

## `/pool?action=…`

Every call returns `{ ok, error?, now, venue, tables[], queue[], leaderboard[], recent[], feed[], me? }` (`me` when a `ticket` is sent).

**Players**

| action | params | effect |
|---|---|---|
| `state` | `ticket?` | read only |
| `join` | `name`, `email?`, `gameType` (`8-ball` / `9-ball` / `10-ball`), `refOnly?` | joins the queue; emails "you're on the board" if an email is given |
| `checkin` | `ticket` | "I'm at the table" (3 minutes after being called, or the next name is called) |
| `leave` | `ticket` | leaves the queue |
| `flag` | `ticket` | flags the last shot as a foul (both players then vote) |
| `vote` | `ticket`, `vote=accept\|dispute` | foul review vote; if players disagree, staff decide |
| `report` / `confirm` | `ticket`, `result=won\|lost` | tables without a camera: report and confirm the winner |

**Player accounts** (made after a player's first game)

| action | params | effect |
|---|---|---|
| `account_create` | `name`, `email`, `hash` (SHA-256 of `loopool|email|password`, made on the phone) | creates the account; replies `{ account: { name, email } }` |
| `account_login` | `email`, `hash` | checks the password; replies `{ account }` |

Once an email has an account, `join` needs its `hash` too. `join` with the name and email (or ticket) of someone already on the board returns their ticket instead of an error. Any call with `player=<name>` also returns `my`: that player's rating, rank, record and last games.

**Bar setup and events** (`#business` page; players sign up for events from their phone)

| action | params | effect |
|---|---|---|
| `venue_save` | `profile` (JSON: `name`, `about`, `address`, `mapsUrl`, `phone`, `website`, `tableCount`, `tableBrand`, `tableSize`, `cues`, `hours: { mon: { open: "16:00", close: "00:00", closed: false }, … }`) | saves the bar profile; the name shows on every screen and in emails |
| `venue_open` | `open=1\|0`, `event?` (an event id to start) | starts or ends tonight's session; the bar app ends it when the camera is disconnected |
| `venue_delete` | | deletes the bar profile and its events (the bar app shows the set-up page again) |
| `event_save` | `event` (JSON: `id?` to edit, `title`, `kind=tournament\|league\|social\|lesson`, `date=YYYY-MM-DD`, `time=HH:MM`, `gameType`, `cap` (0 = no limit), `fee`, `prize`, `about`) | adds or edits a tournament or event night |
| `event_remove` | `id` | cancels an event |
| `event_join` / `event_leave` | `id`, `name` (or `ticket`) | a player signs up for, or drops out of, an event |

Every reply also carries `events[]`: upcoming events with `count` and `names` of the players signed up. "Ask the referee" knows the bar's hours and the upcoming events.

**Staff tools** (counter tablet). All take `table` (`T1` … `T4`).

| action | params | effect |
|---|---|---|
| `start_match` | `players=Ali,Bora` (first breaks), `gameType=8\|9\|10`, `force=1` to replace a game | starts a match; on Table 1 the camera referee scores it |
| `switch_turn` | | gives the turn to the other player |
| `foul` | | manual foul: turn passes, ball in hand |
| `set_group` | `player`, `group=solids\|stripes` | fixes 8-ball groups |
| `end_match` | `winner` | ends the match now, updates ratings |
| `next_match` | | calls the next people in the queue to the table |
| `undo` | | reverts the last shot or staff change (also a finished match and its ratings) |
| `reset_table` | | clears the table; the queue is called |
| `staff` | `decision=uphold\|overrule` | decides a disputed foul review |

**Camera service (event form)**: `shot` with `table`, `event={potted:[n], firstContact:n|'unknown', cueBallPotted, confidence:{firstContact}, positions?}` (used by the demo recorder).

## `/pool-score`

Multipart fields: `table`, `frame_start`, `frame_mid_1..N` (file name = time in seconds), `frame_end` (file name = shot duration), `frame_diff`, and optionally `ball_set` (`standard` or `pink`: the table's ball colours, added to the AI prompt). JPEGs. The camera screen sends 1024 px frames and 4 mid frames.

Reply:

```json
{
  "ok": true, "player": "Ali", "score": 78, "grade": "Good",
  "breakdown": { "pot": 55, "cue_ball": 15, "difficulty_bonus": 10, "foul": false },
  "potted_balls": ["solid 3"], "first_contact": "solid 3", "foul_reason": null,
  "observations": "…", "tip": "…", "confidence": 0.84, "needs_review": false,
  "game": { "practice": false, "shooter": "Ali", "keeps_turn": true, "turn_after": "Ali",
            "reason": "Shot 4 · Ali potted 3. Still shooting", "ball_in_hand": false,
            "finished": false, "winner": null, "review": false },
  "table": null
}
```

How it flows: photos → **AI reads the shot** (Claude Haiku 5.5 through n8n Gateway credits) → **Score the shot** (a fixed rubric: pot 55 / close 25 / medium 12, cue ball 25 / 15 / 5 / 0, difficulty bonus 0-20, a foul caps the score at 10) → **Apply the shot** (`POST /pool-apply`, a separate short run: the Referee engine applies turns, groups, fouls, 8-ball / money ball and ratings, and saves the photo for the TV). The AI call takes about 15 s, and n8n saves workflow state when a run ends, so applying the shot in that long run would overwrite whatever happened meanwhile. When the AI's confidence is below 0.6 and it saw a foul, play pauses and both players vote. A shot on a table with no game counts as practice.

## Rules

- **8-ball:** a pot on the break keeps the shooter at the table and the table stays open. The first legal pot after the break sets the groups (majority if both kinds go down). Own ball potted, no foul: keep shooting. Fouls (scratch, wrong ball first, no ball hit, or a foul the AI saw): ball in hand. The 8 is legal only after the group is cleared; early or on a foul, the opponent wins. When the AI cannot see which ball was hit first, no first-ball foul is called.
- **9-ball / 10-ball:** potted something without a foul: keep shooting. Money ball (9 / 10) potted without a foul: win. Potted on a foul: it comes back, ball in hand.
- **Queue:** winner stays on, at most 3 wins in a row while people wait; 3 minutes to check in when called.
- **Rating:** Elo with K = 48 for a player's first 5 matches, then 32, times a margin multiplier (1 + 0.05 × balls the loser still had), plus up to ±5 from the player's average AI shot score in that match.
- **Badges:** sharpshooter (best average shot, 5+ shots), fair play (fewest fouls per shot, 5+ shots), best shot (85+).

## From the original endpoints

| Original | Now |
|---|---|
| `GET /pool-state?table=T1` | `GET /pool?action=state` (all tables) |
| `POST /pool-match` | `/pool?action=start_match&table=T1&players=A,B&gameType=8` |
| `POST /pool-action` (`undo`, `switch_turn`, `foul`, `set_group`, `end_match`, `next_match`, `reset_table`) | `/pool?action=<same name>&table=T1&…` |
| `POST /pool-queue` | `/pool?action=join` / `leave` |
| `POST /pool-score` | unchanged |
| `POST /pool-apply` (internal) | `POST /pool-apply`, called by the workflow itself after the AI has read a shot |
