# Vision service (the AI referee's eyes)

Watches a fixed overhead camera and turns every shot into one event for the n8n workflow. It follows the same pipeline shape DrillRoom describes in public (phone or camera on a stand, the camera maps the table, an event engine classifies each shot), built from scratch with OpenCV. No DrillRoom code, drills or content are used.

| Step | What it does | In `referee_vision.py` |
|---|---|---|
| 1. Calibrate | Finds the cloth, fits a straight line to each side (pockets cut the corners), and maps the table to a flat 1000 × 500 top-down view. Or pass the 4 corners yourself. | `auto_corners()` |
| 2. Detect | Everything that isn't cloth is a candidate. A distance transform finds ball centres, even when balls touch in the rack. | `Detector.detect()` |
| 3. Identify | Reads colour in a ring around each centre (skipping the white number disc). White in the ring means a stripe. Gives cue, 8, and 1–15. | `Detector.classify()` |
| 4. Track | Follows each ball between frames, ignores one-frame misreads, and never brings back a potted ball. | `Referee.update()` |
| 5. Events | Shot starts when the cue ball moves. **First contact** is the first resting ball to move, checked against the cue ball's real path. **Potted** means a ball vanished next to a pocket. **Shot ends** after 0.6 s with nothing moving. | `Referee.step()` / `finish()` |
| 6. Deliver | Sends the event to n8n (`GET /webhook/pool?action=shot&table=T1&event=…`) and saves a clip of the shot for foul reviews. | `post_to_n8n()` |

Each event includes a **confidence** score for first contact. Below 80%, n8n pauses the game and asks both players to review the clip. At 80% or above, the foul is applied automatically.

## Run it

```bash
pip install -r requirements.txt
```

Make a test video of the demo game, so you can test without a table:

```bash
python make_test_video.py
```

Check accuracy against the known answers:

```bash
python referee_vision.py --source test_game.mp4 --truth demo_game.json --debug debug_top.mp4
```

Send the shots into a live n8n game (join and check in at Table 1 first):

```bash
python referee_vision.py --source test_game.mp4 --n8n http://localhost:5678/webhook --table T1 --clips clips
```

Use a real camera (USB index or an RTSP stream). Click the 4 playing-surface corners on a still image once, then pass them:

```bash
python referee_vision.py --source 0 --corners "152,96;1129,86;1184,639;96,649" --n8n http://localhost:5678/webhook
```

## What was tested

On the rendered test video (perspective, uneven light, sensor noise), with automatic calibration:

- **14 of 14 shots fully correct**: potted balls, first contact and scratch.
- Ball positions within about 2 table units (about 5 mm on a real table).
- 66–97 frames per second on a laptop CPU, so live play at 30 fps has plenty of headroom.
- Played end to end through n8n: video → vision service → n8n → the right winner and rating change.

**This is a rendered video, not real footage.**

### Real footage (2026-11-14)

Two public drill videos from one home table (fixed overhead camera, 1280x720, 30 fps, green cloth, a
player's arm and cue over the table during aiming, edited cuts to a fresh rack). Truth was labelled by
hand by someone who did not write the tracker (`real/truth_drill08.json`, `real/truth_drill10.json`).
Tuned on drill08 only; drill10 was run once at the end. Scored with `eval_real.py` (shots matched to
truth by time overlap). Raw outputs: `results/`.

    python referee_vision.py --source real/creglia_drill08.mp4 --palette palettes/creglia.json --out ev08.json
    python eval_real.py ev08.json real/truth_drill08.json

| | drill08 (tuned on) | drill10 (held out, run once) |
|---|---|---|
| Truth shots | 30 | 42 |
| Shots found (matched by time) / missed / extra | 30 / 0 / 0 | 42 / 0 / 2 |
| Potted balls right (numbers) | 24/30 (80%) | 20/42 (48%) |
| Potted count right | 25/30 (83%) | 23/42 (55%) |
| Scratch right | 30/30 | 42/42 (no scratches in either video) |
| First contact right | 26/30 (87%) | 21/42 (50%) |
| Shots fully correct | 24/30 (80%) | 16/42 (38%) |
| Speed | 107 fps | 108 fps |

drill10 run 2 (120.6-244.3 s) has two sets of solids, so there potted is scored by count only
(`--count-only 120.6-244.3`). **The held-out numbers are the honest ones**: shot timing carries over to
the new video, pot detection and identity do not yet (most drill10 errors are pots not seen at all).

What was changed for real footage:

- **Calibration** finds the cushion nose (the brightness step a little inside the green area), not the
  outer edge of the cushions, on the per-pixel median of frames sampled over the first 30 s (title
  cards and arms drop out). `--corners` still overrides it.
- **Cloth model** is local (a wide median of the cloth colour per area, re-learned between shots,
  arm areas keep the old value), plus a learned mask of the dark shadow strip under the cushions.
- **Arms and cues**: a large blob touching the edge of the table is ignored, and a ball that vanishes
  under it is not counted as potted. Blobs that don't stop about one radius out (a cue butt) are not
  balls. A shot only starts from a cue ball that was at rest (or hidden under the arm) beforehand, and
  a "shot" where nothing went down and the cue ball ended where it was is dropped.
- **Ball identity** uses a per-venue palette (`--palette`, measured with `--dump-at SECONDS`). In this set
  4 is pink, 5 purple, 7 orange, and from above a stripe looks like its colour plus black, so solid
  versus stripe is a guess; tracked balls keep their number, and a number already potted or already on
  the table goes to the other ball of that colour.
- **Hand placement and cuts**: a potted number that is seen again while no shot is running for 1 s
  (or right after a jump cut in the video) is put back on the table. A jump cut ends a running shot.

Limits seen on this footage:

- Identity is the weak part: dark stripes (12-14) and the 8 get confused, and a stripe can be called
  its solid. Potted numbers are wrong more often than potted counts.
- A ball potted while the player's arm or cue covers the pocket is missed (counted as hidden, not potted).
- First contact is judged from the cue ball's path; fast strokes from a cue ball hidden under the arm are
  only seen once the object ball is rolling.
- The palette and thresholds were set on one table and one ball set. A new venue needs its own palette.
- Shot detection on the rendered video is sensitive to sub-pixel calibration changes in the rack; a
  5-frame stillness window fixed that, but the rack case is still the most fragile part.

## Before it works on a real table

1. **People and cues block the view.** Large blobs touching the table edge are now ignored (see above); a pot under the arm is still missed.
2. **Glare and lighting.** Mount the camera straight down, under the table lamp, and avoid shiny spots. Re-learn the cloth colour if the lights change (`Detector.learn_felt`).
3. **Green 6 and 14 on green cloth, and stripes rolled sideways.** These are the classic misreads. Record 10–20 games at your table, use the events as rough labels, and fine-tune a small YOLO model for ball identity. Keep this tracker and event logic as they are.
4. **Rules this version doesn't check:** a ball reaching a cushion after contact, double hits, and balls touched by hand. Add them as more event checks.
5. **Speed:** if the camera runs at 60 fps, the first-contact timing gets sharper. Pass the real fps.

## Livestream for the bar

The video doesn't go through n8n. Send the camera to a small streaming server (for example MediaMTX) and play it on the bar TVs, or as WebRTC or HLS in the app. Use OBS with the app's livestream page as a browser overlay for the scoreboard. n8n only carries the events, which keeps it fast.
