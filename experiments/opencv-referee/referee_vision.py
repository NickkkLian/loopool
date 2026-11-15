"""Loopool: classic computer-vision referee (experiment).

Watches a fixed overhead camera, tracks every ball, and turns each shot into one event for n8n:
potted balls, first ball the cue ball touched (with a confidence score), scratch, ball positions
and the cue ball's path. The same pipeline shape that DrillRoom describes publicly (camera on a
stand, table calibration, ball map, event engine), built from scratch with OpenCV.

    # test without a table (renders a fake overhead video of the demo game first)
    python make_test_video.py
    python referee_vision.py --source test_game.mp4 --truth demo_game.json

    # send events to n8n while a game is running at Table 1
    python referee_vision.py --source test_game.mp4 --n8n http://localhost:5678/webhook --table T1

    # real footage with a venue's own ball colours (see README "Real footage"), scored against labels
    python referee_vision.py --source real/creglia_drill08.mp4 --palette palettes/creglia.json --out ev08.json
    python eval_real.py ev08.json real/truth_drill08.json

    # live camera (USB index or RTSP URL), playing-surface corners clicked once from a still
    python referee_vision.py --source 0 --corners "152,96;1129,86;1184,639;96,649" --n8n ...
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import deque

import cv2
import numpy as np

W, H = 1000, 500                       # playing surface in table units (same as the n8n engine)
BALL_R = 12                            # ball radius in table units
POCKETS = [(0, 0), (500, -6), (1000, 0), (0, 500), (500, 506), (1000, 500)]
NUMBERED = {'yellow': 1, 'blue': 2, 'red': 3, 'purple': 4, 'orange': 5, 'green': 6, 'maroon': 7}


# ---------------------------------------------------------------- 1. calibration
def order_corners(pts):
    pts = np.asarray(pts, np.float32)
    s, d = pts.sum(1), np.diff(pts, axis=1).ravel()
    return np.float32([pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]])


def cloth_hue(hsv):
    h, s, v = cv2.split(hsv)
    sat = (s > 70) & (v > 40)
    hist = np.bincount(h[sat].ravel(), minlength=180).astype(np.float32)
    hist = np.convolve(np.concatenate([hist[-3:], hist, hist[:3]]), np.ones(7), 'valid')
    return int(np.argmax(hist))


def hue_dist(h, ref):
    d = np.abs(h.astype(np.int16) - ref)
    return np.minimum(d, 180 - d)


def auto_corners(frame, cushion):
    """Find the cloth, fit a straight line to each side (pockets cut the corners), intersect them.
    The cloth also covers the cushions, so the result is mapped to a slightly larger rectangle."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    fh = cloth_hue(hsv)
    mask = ((hue_dist(hsv[..., 0], fh) < 12) & (hsv[..., 1] > 70) & (hsv[..., 2] > 40)).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not cnts:
        raise RuntimeError('Could not find the table cloth. Pass --corners instead.')
    c = max(cnts, key=cv2.contourArea)
    hull = cv2.convexHull(c)
    approx = cv2.approxPolyDP(hull, 0.02 * cv2.arcLength(hull, True), True).reshape(-1, 2)
    rough = order_corners(approx if len(approx) == 4 else cv2.boxPoints(cv2.minAreaRect(c)))
    pts = c.reshape(-1, 2).astype(np.float32)
    lines = []
    for i in range(4):
        a, b = rough[i], rough[(i + 1) % 4]
        L = float(np.linalg.norm(b - a)); u = (b - a) / L; n = np.array([-u[1], u[0]])
        t, d = (pts - a) @ u, np.abs((pts - a) @ n)
        sel = pts[(t > 0.15 * L) & (t < 0.85 * L) & (d < 30)]
        lines.append(cv2.fitLine(sel, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel() if len(sel) > 20 else None)
    corners = []
    for i in range(4):
        l1, l2 = lines[(i - 1) % 4], lines[i]
        if l1 is None or l2 is None:
            corners.append(rough[i]); continue
        A = np.array([[l1[0], -l2[0]], [l1[1], -l2[1]]]); bb = np.array([l2[2] - l1[2], l2[3] - l1[3]])
        t = np.linalg.solve(A, bb)[0]
        corners.append([l1[2] + l1[0] * t, l1[3] + l1[1] * t])
    cloth = np.float32(corners)
    # The green area runs out to the outer edge of the cushions. Balls play on the surface inside the
    # cushion nose, which shows as a sharp brightness step a little way in from each side (the cushion
    # top is lit differently from the cloth, and casts a shadow onto it). Find that step per side.
    Wo, Ho = 1000, 500
    M = cv2.getPerspectiveTransform(cloth, np.float32([[0, 0], [Wo, 0], [Wo, Ho], [0, Ho]]))
    g = cv2.cvtColor(cv2.warpPerspective(frame, M, (Wo, Ho)), cv2.COLOR_BGR2GRAY).astype(np.float32)
    cols, rows = np.r_[100:450, 550:900], np.r_[60:440]        # stay clear of the pockets
    # medians, not means: an arm or cue lying over part of a side must not move the edge
    profiles = [np.median(g[:70][:, cols], 1), np.median(g[rows][:, ::-1][:, :70], 0),
                np.median(g[::-1][:70][:, cols], 1), np.median(g[rows][:, :70], 0)]   # top, right, bottom, left
    inset = []
    for p in profiles:
        grad = np.abs(p[2:] - p[:-2])          # grad[i] is the step around p[i + 1]
        lo = 3
        mx = grad[lo:].max()
        if mx < 12:                            # no clear step: fall back to the cushion width given
            inset.append(cushion); continue
        i = lo + int(np.argmax(grad[lo:] >= 0.5 * mx))          # outermost strong step = the nose
        j = i + int(np.argmax(grad[i:i + 5]))
        inset.append(j + 1.5)
    t, r, b, l = [min(max(v, 2.0), 60.0) for v in inset]
    surface = cv2.perspectiveTransform(np.float32([[[l, t]], [[Wo - r, t]], [[Wo - r, Ho - b]], [[l, Ho - b]]]),
                                       np.linalg.inv(M)).reshape(-1, 2)
    return surface


def calibrate(source, first, cushion, seconds=30):
    """Auto calibration on a clean picture of the table: a video file is sampled every 2 s over its first
    30 s (on its own reader, so the main reader is not moved) and the per-pixel median of those frames is
    used. A title card, a player's arm or the cue lying over the table in a few frames drops out of the
    median; balls that stay put remain but don't touch the cushions. A live camera uses its first frame."""
    frames = []
    if isinstance(source, str) and os.path.isfile(source):
        cap = cv2.VideoCapture(source)
        step = int(2 * (cap.get(cv2.CAP_PROP_FPS) or 30.0))
        k, ok = 0, True
        while ok and k < seconds * step / 2:
            ok, fr = cap.read()
            if ok and k % step == 0:
                frames.append(fr)
            k += 1
        cap.release()
    bg = np.median(np.stack(frames), axis=0).astype(np.uint8) if len(frames) >= 3 else first
    return auto_corners(bg, cushion), bg


# ---------------------------------------------------------------- 2. ball detection
class Detector:
    def __init__(self, ball_r=12.0, palette=None):
        self.r = ball_r
        self.felt = None
        yy, xx = np.mgrid[0:H, 0:W]
        self.keep = np.ones((H, W), np.uint8)
        for px, py in POCKETS:
            self.keep[(xx - px) ** 2 + (yy - py) ** 2 < 34 ** 2] = 0
        self.keep[:4, :] = 0; self.keep[-4:, :] = 0; self.keep[:, :4] = 0; self.keep[:, -4:] = 0
        k = int(math.ceil(self.r)) + 1
        yy, xx = np.mgrid[-k:k + 1, -k:k + 1]
        rr = np.sqrt(xx ** 2 + yy ** 2)
        self.ring = (rr >= 0.58 * self.r) & (rr <= 0.92 * self.r)   # skips the white number disc in the middle
        self.disc = rr <= 0.85 * self.r
        self.k2 = int(math.ceil(1.7 * self.r))
        yy2, xx2 = np.mgrid[-self.k2:self.k2 + 1, -self.k2:self.k2 + 1]
        rr2 = np.sqrt(xx2 ** 2 + yy2 ** 2)
        self.halo = (rr2 >= 1.25 * self.r) & (rr2 <= 1.7 * self.r)
        t = max(3, int(round(0.8 * self.r)) | 1)
        self.thin = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (t, t))
        self.k = k
        self.palette = palette
        self.occluded = np.zeros((H, W), bool)
        self.fixed = None

    def learn_felt(self, hsv, occluded=None):
        """Cloth colour per area, not one global colour: real tables are lit unevenly (brighter under the
        lamp, darker at the ends). A wide median over a small copy keeps the cloth and drops the balls
        (each ball covers a small part of the window). Areas covered by an arm or cue keep the old value."""
        small = cv2.resize(hsv, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
        if occluded is not None and self.felt is not None and occluded.any():
            occ = cv2.resize(occluded.astype(np.uint8), (W // 4, H // 4), interpolation=cv2.INTER_NEAREST) > 0
            small[occ] = self.felt_small[occ]
        self.felt_small = small.copy()
        ref = cv2.medianBlur(small, 15)
        self.felt = np.median(hsv[20:-20:4, 20:-20:4].reshape(-1, 3), axis=0)
        self.ref = [cv2.resize(ref[..., i], (W, H), interpolation=cv2.INTER_LINEAR).astype(np.int16) for i in range(3)]

    def learn_fixtures(self, top):
        """Things that never move near the cushions: the dark shadow strip under a cushion, pocket jaws.
        Learned from the clean table picture used for calibration; a pixel there counts as cloth while it
        keeps that brightness, so a ball rolling along the rail (brighter) still shows."""
        hsv = cv2.cvtColor(top, cv2.COLOR_BGR2HSV)
        self.learn_felt(hsv)
        band = np.zeros((H, W), bool)
        band[:30, :] = band[-30:, :] = True; band[:, :30] = band[:, -30:] = True
        self.fixed = band & ~self.felt_mask(hsv)
        self.fixed_v = hsv[..., 2].astype(np.int16)
        self.felt = None                    # cloth colour is learned again from the first live frame

    def felt_mask(self, hsv):
        fh, fs, fv = self.ref
        h, s, v = hsv[..., 0], hsv[..., 1].astype(np.int16), hsv[..., 2].astype(np.int16)
        d = np.abs(h.astype(np.int16) - fh); d = np.minimum(d, 180 - d)
        lit = (d < 9) & (np.abs(s - fs) < 45) & (np.abs(v - fv) < np.maximum(28, fv * 0.32))
        shade = (d < 30) & (s > 90) & (v >= 35) & (v < fv * 0.75)     # shadows of balls and cushions on the cloth
        m = lit | shade
        if self.fixed is not None:
            m |= self.fixed & (np.abs(v - self.fixed_v) < 30)
        return m

    def detect(self, top):
        hsv = cv2.cvtColor(top, cv2.COLOR_BGR2HSV)
        if self.felt is None:
            self.learn_felt(hsv)
        felt = self.felt_mask(hsv)
        obj = ((~felt).astype(np.uint8) * 255) & (self.keep * 255)
        obj = cv2.morphologyEx(obj, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        # An arm, a hand or the cue stick reaches in over the rail: a large blob touching the edge of the
        # playing surface (or any blob far bigger than a cluster of balls). Drop it, and remember where it
        # is so the referee doesn't read a ball hidden under it as potted.
        # (Thin parts, the cue stick and its tip touching a ball at address, are opened away first, so a
        # ball the cue is pointing at stays a separate blob.)
        n, lab, stats, _ = cv2.connectedComponentsWithStats(cv2.morphologyEx(obj, cv2.MORPH_OPEN, self.thin), connectivity=8)
        ball_area = math.pi * self.r ** 2
        big = []
        for i in range(1, n):
            x, y, w, h, area = stats[i]
            edge = x <= 6 or y <= 6 or x + w >= W - 6 or y + h >= H - 6
            if (edge and area > 2.2 * ball_area) or area > 40 * ball_area:
                big.append(i)
        self.occluded = np.isin(lab, big) if big else np.zeros((H, W), bool)
        if big:
            self.occluded = cv2.dilate(self.occluded.astype(np.uint8), np.ones((15, 15), np.uint8)) > 0
            obj[self.occluded] = 0
        self.hsv = hsv
        dist = cv2.distanceTransform(obj, cv2.DIST_L2, 5)
        peaks = (dist == cv2.dilate(dist, np.ones((13, 13), np.uint8))) & (dist >= 0.55 * self.r)
        ys, xs = np.nonzero(peaks)
        order = np.argsort(-dist[ys, xs])
        centers = []
        for i in order:
            x, y = int(xs[i]), int(ys[i])
            if all((x - cx) ** 2 + (y - cy) ** 2 > (1.25 * self.r) ** 2 for cx, cy in centers):
                centers.append((x, y))
        out = []
        k2 = self.k2
        for x, y in centers:
            if self.palette and k2 <= x < W - k2 and k2 <= y < H - k2:
                # a ball is round: the blob must stop about one radius out. A cue butt or a sleeve lying on
                # the cloth is thick enough for a centre but carries on past it.
                around = obj[y - k2:y + k2 + 1, x - k2:x + k2 + 1][self.halo] > 0
                if around.mean() > 0.55:
                    continue
            if self.palette:
                lab_, conf, alts = self.classify_palette(hsv, x, y)
            else:
                (lab_, conf), alts = self.classify(hsv, felt, x, y), []
            if lab_:
                out.append((lab_, (float(x), float(y)), conf, alts))
        return out

    def features(self, hsv, x, y):
        """Colour make-up of the whole ball disc: share of white, black and coloured pixels, the mean hue
        and saturation of the coloured ones, and the mean saturation and brightness of the disc."""
        k = self.k
        patch = hsv[y - k:y + k + 1, x - k:x + k + 1][self.disc]
        h, s, v = patch[:, 0].astype(np.float32), patch[:, 1], patch[:, 2]
        white, black = (s < 70) & (v > 150), v < 60
        col = ~white & ~black & (s >= 80)
        hue, sat = -1.0, 0.0
        if col.any():
            ang = h[col] * (2 * math.pi / 180)
            hue = (math.degrees(math.atan2(np.sin(ang).mean(), np.cos(ang).mean())) / 2) % 180
            sat = float(s[col].mean())
        return {'white': float(white.mean()), 'black': float(black.mean()), 'col': float(col.mean()),
                'hue': hue, 'sat': sat, 'meanS': float(s.mean()), 'meanV': float(v.mean())}

    def classify_palette(self, hsv, x, y):
        """Per-venue colours (--palette): nearest colour group by hue and saturation; the solid/stripe
        choice is a guess from the black share and comes with the other number as an alternative, so the
        referee can keep identities apart (two balls of one colour, or one already potted)."""
        k = self.k
        if x - k < 0 or y - k < 0 or x + k >= W or y + k >= H:
            return None, 0, []
        f, P = self.features(hsv, x, y), self.palette
        cue = P['cue']
        if f['meanS'] < cue['max_sat'] and f['meanV'] > cue['min_val'] and f['black'] < 0.1:
            return 'cue', 0.9, []
        def group():
            best = min(P['groups'].items(), key=lambda g: min(abs(f['hue'] - g[1]['hue']), 180 - abs(f['hue'] - g[1]['hue']))
                       + abs(f['sat'] - g[1]['sat']) / 12)
            return best[1]['numbers']
        if f['black'] > 0.45 or (f['col'] < 0.12 and f['black'] > 0.25):
            # mostly black: the 8, or a stripe turned so its black part faces up (this set)
            # the 8 shows its white number disc; a dark stripe shows a little colour instead
            alts = [str(group()[1])] if f['col'] >= 0.01 else []
            return '8', float(np.clip(0.6 + f['white'] - 2 * f['col'], 0.1, 1.0)), alts
        if f['col'] < 0.12:
            return None, 0, []
        solid, stripe = [str(n) for n in group()]
        conf = float(min(1.0, f['col'] + 0.3))
        return (stripe, conf, [solid]) if f['black'] >= P.get('stripe_black', 0.12) else (solid, conf, [stripe])

    def classify(self, hsv, felt, x, y):
        k = self.k
        if x - k < 0 or y - k < 0 or x + k >= W or y + k >= H:
            return None, 0
        patch = hsv[y - k:y + k + 1, x - k:x + k + 1][self.ring]
        fpatch = felt[y - k:y + k + 1, x - k:x + k + 1][self.ring]
        h, s, v = patch[:, 0].astype(np.int16), patch[:, 1], patch[:, 2]
        white = (s < 70) & (v > 150)
        black = v < 60
        colored = ~white & ~black & ~fpatch & (s >= 80)
        wf, bf, cf = white.mean(), black.mean(), colored.mean()
        if wf > 0.78:
            return 'cue', min(1.0, wf)
        if bf > 0.5:
            return '8', min(1.0, bf)
        if cf < 0.12:
            return None, 0
        hs = h[colored]
        ang = hs * (2 * math.pi / 180)
        hue = (math.degrees(math.atan2(np.sin(ang).mean(), np.cos(ang).mean())) / 2) % 180
        vmean = float(v[colored].mean())
        if hue < 8 or hue >= 168:
            name = 'maroon' if vmean < 150 else 'red'
        elif hue < 20:
            name = 'orange'
        elif hue < 38:
            name = 'yellow'
        elif hue < 92:
            name = 'green'
        elif hue < 130:
            name = 'blue'
        else:
            name = 'purple'
        n = NUMBERED[name] + (8 if wf > 0.22 else 0)
        return str(n), float(min(1.0, cf + 0.3))


# ---------------------------------------------------------------- 3. tracking + shot events
def path_dist(path, q):
    """Closest distance from point q to the cue ball's path so far, and the closest point (the contact point)."""
    best, bp = 1e9, path[-1]
    for a, b in zip(path, path[1:] or path):
        ab = (b[0] - a[0], b[1] - a[1]); L2 = ab[0] ** 2 + ab[1] ** 2
        t = 0 if L2 == 0 else max(0, min(1, ((q[0] - a[0]) * ab[0] + (q[1] - a[1]) * ab[1]) / L2))
        p = (a[0] + ab[0] * t, a[1] + ab[1] * t); d = math.dist(p, q)
        if d < best:
            best, bp = d, p
    return best, bp


def nearest_pocket(p):
    i = min(range(6), key=lambda k: (p[0] - POCKETS[k][0]) ** 2 + (p[1] - POCKETS[k][1]) ** 2)
    return i, math.dist(p, POCKETS[i])


def pocket_for_vanished(hist):
    """Which pocket a ball that just vanished went into, or None.
    The detector can't see balls inside the pocket mouth, so a fast ball is often last seen a little
    short of the pocket: accept a last position near a pocket, or a straight-line run into one."""
    p = hist[-1]
    i, d = nearest_pocket(p)
    if d < 48:
        return i
    if len(hist) >= 3:
        vx, vy = (hist[-1][0] - hist[-3][0]) / 2, (hist[-1][1] - hist[-3][1]) / 2
        if math.hypot(vx, vy) > 1.0:
            for k in range(1, 13):
                j, dj = nearest_pocket((p[0] + vx * k, p[1] + vy * k))
                if dj < 30:
                    return j
    return None


class Referee:
    MOVE, STILL_FRAMES, GONE_FRAMES = 1.4, 18, 6

    def __init__(self, fps=30.0, sticky=False):
        self.fps = fps
        self.sticky = sticky
        self.balls = {}            # label -> {'p', 'hist': deque, 'miss'}
        self.state = 'idle'
        self.shot = None
        self.shot_no = 0
        self.cue_moving = 0
        self.cue_rest, self.rest_before = 0, 0
        self.rest_snap = {}
        self.events = []
        self.gone = set()          # potted balls; one comes back only if it is seen again while no shot runs
        self.reappear = {}
        self.cut_frame = -999
        self.occluded = None

    def update(self, detections, frame_no, occluded=None, cut=False):
        """Match detections to balls: first by position (a ball keeps its number while it is tracked,
        whatever a single frame's colour reading says), then by label for new or reappearing balls."""
        self.occluded = occluded
        if cut:                                 # the video jumped: positions are not continuous
            if self.state == 'shot':
                self.finish(frame_no)
            for b in self.balls.values():
                b['hist'].clear()
            self.cut_frame = frame_no
        dets = sorted(detections, key=lambda d: -d[2])
        seen, taken = {}, set()
        pairs = []
        for l, b in self.balls.items():
            # Standard set (rendered test): labels are read reliably, so each frame's reading wins (racked
            # balls swap less that way). Venue palette: colours are ambiguous, so tracked balls keep theirs.
            if b['miss'] >= self.GONE_FRAMES or not self.sticky:
                continue
            h = b['hist']
            v = ((h[-1][0] - h[-2][0]), (h[-1][1] - h[-2][1])) if len(h) >= 2 else (0, 0)
            pred = (b['p'][0] + v[0] * (b['miss'] + 1), b['p'][1] + v[1] * (b['miss'] + 1))
            gate = min(60, 20 + 1.5 * math.hypot(*v))
            for j, d in enumerate(dets):
                dd = math.dist(pred, d[1])
                pen = 0 if d[0] == l else (8 if l in d[3] else 25)
                if dd < gate and dd + pen < gate + 8:
                    pairs.append((dd + pen, l, j))
        reading = {}
        for _, l, j in sorted(pairs):
            if l in seen or j in taken:
                continue
            seen[l] = dets[j][1]; taken.add(j); reading[l] = dets[j]
        recent_cut = frame_no - self.cut_frame < 15
        for j, d in enumerate(dets):
            if j in taken:
                continue
            for lab in [d[0]] + list(d[3]):
                if lab in seen:
                    if lab != d[0] or d[3]:
                        continue
                    # same label twice: give it to the ball that went missing nearest to it
                    cands = [(math.dist(d[1], bb['p']), l) for l, bb in self.balls.items() if l not in seen and bb['miss'] > 0]
                    cands = [c for c in cands if c[0] < 25]
                    if cands:
                        seen[min(cands)[1]] = d[1]
                    break
                if lab in self.gone:
                    # a potted ball back on the table: only while no shot runs, after it has been seen for
                    # a second (or straight after a cut to a fresh rack), so a misread can't bring it back
                    if self.state == 'idle':
                        self.reappear[lab] = self.reappear.get(lab, 0) + 1
                        if self.reappear[lab] >= 30 or recent_cut:
                            self.gone.discard(lab)
                    if lab in self.gone:
                        continue
                prev = self.balls.get(lab)
                if prev and prev['miss'] == 0 and (self.sticky or math.dist(d[1], prev['p']) > 80):
                    continue                    # that number is tracked elsewhere / a jump across the table
                if prev and prev['miss'] < self.GONE_FRAMES and math.dist(d[1], prev['p']) > 80:
                    prev['hist'].clear()        # reappeared far away (out from under an arm, or a cut)
                seen[lab] = d[1]; reading[lab] = d
                break
        for lab in list(self.reappear):
            if lab not in seen:
                self.reappear.pop(lab)
        for lab, p in seen.items():
            b = self.balls.setdefault(lab, {'p': p, 'hist': deque(maxlen=8), 'miss': 0, 'age': 0})
            b['p'] = p; b['miss'] = 0; b['hist'].append(p); b['age'] += 1
        for lab in list(self.balls):
            b = self.balls[lab]
            if lab not in seen:
                b['miss'] += 1
                if b['age'] < 5 and b['miss'] > self.GONE_FRAMES:
                    del self.balls[lab]        # a short-lived misread, not a real ball
        self.step(frame_no)

    def drift(self, b):
        h = b['hist']
        if b['miss'] or len(h) < 3:
            return 0.0
        return math.dist(h[-1], h[max(0, len(h) - 6)]) / (min(len(h), 6) - 1)

    def speed(self, b):
        h = b['hist']
        return math.dist(h[-1], h[-3]) / 2 if b['miss'] == 0 and len(h) >= 3 else 0.0

    def recent(self):
        # balls seen in the last few frames; with a venue palette also balls hidden for up to 3 s (under
        # the player's arm while aiming), which are still lying where they were last seen
        lim = 90 if self.sticky else self.GONE_FRAMES
        return {l: b for l, b in self.balls.items() if b['miss'] < lim}

    def visible(self):
        return {l: b for l, b in self.balls.items() if b['miss'] < self.GONE_FRAMES}

    def step(self, f):
        cue = self.balls.get('cue')
        if self.state == 'idle':
            if self.sticky:
                # where each ball last lay still: a fast stroke from a cue ball hidden under the arm is
                # only seen once the object ball is already rolling
                for l, b in self.balls.items():
                    if b['miss'] == 0 and self.speed(b) < self.MOVE:
                        self.rest_snap[l] = b['p']
            sp = self.speed(cue) if cue else 0.0
            if cue and (cue['miss'] > 0 or sp < 0.6):
                self.cue_rest += 1          # at rest, or hidden under the player's arm (it can't roll there unseen for long)
            if sp > self.MOVE:
                if self.cue_moving == 0:
                    self.rest_before = self.cue_rest
                self.cue_moving += 1
            else:
                self.cue_moving = 0
            # A shot starts from a cue ball at rest: motion straight after the last shot ended is the
            # cue ball still creeping, and a jump while it was hidden by the player is not a stroke.
            if self.cue_moving >= 2 and self.rest_before >= 10:
                start = cue['hist'][0] if len(cue['hist']) >= 4 else cue['p']
                self.state = 'shot'
                self.shot = {'start': f, 'cue_start': start, 'first': None, 'conf': None, 'contact': None,
                             'starters': [], 'late': [], 'potted': [], 'pockets': {}, 'scratch': False, 'still': 0, 'cue_pts': [start],
                             'resting': {l for l, b in self.recent().items() if l != 'cue' and (self.speed(b) < self.MOVE or l in self.rest_snap)},
                             'rest_pos': {l: self.rest_snap.get(l, b['p']) for l, b in self.recent().items()}}
            return
        s = self.shot
        if cue and cue['miss'] == 0 and s['first'] is None:
            s['cue_pts'].append(cue['p'])
        if cue and cue['miss'] == 0:
            s['cue_far'] = max(s.get('cue_far', 0.0), math.dist(cue['p'], s['cue_start']))
        # a mover must also have left its resting spot: a centre wobbling by a few pixels (a striped ball
        # whose black side catches the light differently) is not a ball that was hit
        movers = [l for l, b in self.balls.items() if l != 'cue' and l in s['resting'] and self.speed(b) > self.MOVE
                  and (not self.sticky or math.dist(b['p'], s['rest_pos'][l]) > 6)]
        if s['first'] is None and movers:
            path = s['cue_pts']
            # A ball can only be hit once the cue ball has reached it. A "mover" the cue ball's path
            # never came near is a tracking wobble (touching balls in the rack swap labels), not a hit.
            reach = 2 * BALL_R + 18
            hit = [l for l in movers if path_dist(path, s['rest_pos'][l])[0] <= reach]
            if hit:
                s['starters'] = hit
                s['first'] = min(hit, key=lambda l: path_dist(path, s['rest_pos'][l])[0])
                s['gap'], s['contact'] = path_dist(path, s['rest_pos'][s['first']])
                s['first_frame'] = f
            elif not s['late']:
                s['late'] = movers     # fallback if the cue ball's path is never seen near anything
        elif s['first'] is not None and f - s['first_frame'] <= 2:
            s['starters'] = sorted(set(s['starters']) | set(movers))
        for l, b in self.balls.items():
            if b['miss'] == self.GONE_FRAMES and f - s['start'] > 3 and b['age'] >= 5 and b['hist']:
                lp = b['hist'][-1]
                if self.occluded is not None and self.occluded[min(H - 1, max(0, int(lp[1]))), min(W - 1, max(0, int(lp[0])))]:
                    continue               # hidden under the player's arm or cue, not potted
                i = pocket_for_vanished(b['hist'])
                if i is not None:
                    if l == 'cue':
                        s['scratch'] = True
                    elif l not in s['potted']:
                        s['potted'].append(l)
                    s['pockets'][l] = i
        # still = no ball has moved over the last 5 frames (a 1-frame wobble of a resting ball's centre
        # by a pixel is detection noise, not motion)
        moving = any(self.drift(b) > 0.8 for b in self.balls.values())
        s['still'] = 0 if moving else s['still'] + 1
        if s['still'] >= self.STILL_FRAMES and f - s['start'] > 12:
            self.finish(f)

    def finish(self, f):
        s = self.shot
        if not s['potted'] and not s['scratch'] and s.get('cue_far', 0.0) < 2.5 * BALL_R:
            # nothing went down and the cue ball ended up where it was: the player nudged it, or the
            # tracker saw a wobble, not a stroke. No event.
            self.state, self.shot, self.cue_moving, self.cue_rest = 'idle', None, 0, 0
            return None
        self.shot_no += 1
        conf = 0.95
        if s['first'] is None and s['late']:
            path = s['cue_pts']
            s['first'] = min(s['late'], key=lambda l: path_dist(path, s['rest_pos'][l])[0])
            s['gap'], s['contact'] = path_dist(path, s['rest_pos'][s['first']])
            s['starters'] = s['late']
        if len(s['starters']) > 1:
            conf = 0.6                 # two balls started moving together: can't be sure which was hit first
        if s['first'] and s.get('gap', 0) > 3.5 * 12:
            conf = min(conf, 0.7)      # the cue ball's path never came close to that ball: maybe a missed frame
        vis = {l: [int(round(b['p'][0])), int(round(b['p'][1]))] for l, b in self.visible().items()
               if l not in s['potted'] and not (l == 'cue' and s['scratch'])}
        cue_end = POCKETS[s['pockets']['cue']] if s['scratch'] else vis.get('cue')
        path = [s['cue_start'], s['contact'] or s['cue_start'], cue_end or s['cue_start']]
        ev = {
            'shotNo': self.shot_no,
            'potted': [int(l) for l in s['potted']],
            'cueBallPotted': s['scratch'],
            'firstContact': int(s['first']) if s['first'] else None,
            'confidence': {'firstContact': conf} if s['first'] else {},
            'positions': vis,
            'cuePath': [[int(round(p[0])), int(round(p[1]))] for p in path],
            'pockets': {l: i for l, i in s['pockets'].items() if l != 'cue'},
            'frames': [s['start'], f],
        }
        for l in s['potted']:
            self.balls.pop(l, None)
            self.gone.add(l)
        if s['scratch']:
            self.balls.pop('cue', None)
        self.events.append(ev)
        self.state, self.shot, self.cue_moving, self.cue_rest = 'idle', None, 0, 0
        return ev


# ---------------------------------------------------------------- 4. delivery
def post_to_n8n(base, table, ev):
    q = urllib.parse.urlencode({'action': 'shot', 'table': table, 'event': json.dumps({k: v for k, v in ev.items() if k != 'frames'})})
    try:
        with urllib.request.urlopen(base.rstrip('/') + '/pool?' + q, timeout=10) as r:
            res = json.loads(r.read())
        t = next((x for x in res.get('tables', []) if x['id'] == table), {})
        g = t.get('game') or {}
        return ('ok' if res.get('ok') else 'refused: ' + res.get('error', '?')) + (f" · game {g.get('status')}" if g else '')
    except Exception as e:                       # keep watching even if n8n is down
        return f'n8n unreachable ({e})'


def compare(events, truth_path):
    truth = json.load(open(truth_path))['shots']
    rows, good = [], 0
    for i, t in enumerate(truth):
        e = events[i] if i < len(events) else None
        ok_p = e is not None and sorted(e['potted']) == sorted(t['potted'])
        ok_s = e is not None and e['cueBallPotted'] == t['cueBallPotted']
        ok_f = e is not None and e['firstContact'] == t['firstContact']
        err = None
        if e:
            common = [k for k in t['positions'] if k in e['positions']]
            err = np.mean([math.dist(t['positions'][k], e['positions'][k]) for k in common]) if common else None
        good += ok_p and ok_s and ok_f
        rows.append((i + 1, t['potted'], e and e['potted'], ok_p, t['firstContact'], e and e['firstContact'], ok_f, ok_s, err))
    print('\nshot  potted(truth/seen)        first contact   scratch  pos err')
    for r in rows:
        print(f"{r[0]:>4}  {str(r[1]):>8} / {str(r[2]):<9} {'ok ' if r[3] else 'XX '}  {str(r[4]):>3} / {str(r[5]):<4} {'ok ' if r[6] else 'XX '}  {'ok ' if r[7] else 'XX '}    {'' if r[8] is None else f'{r[8]:.1f}'}")
    print(f'\n{good}/{len(truth)} shots fully correct · {len(events)} shots detected')
    return good, len(truth)


# ---------------------------------------------------------------- main loop
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--source', required=True, help='video file, camera index (0) or RTSP URL')
    ap.add_argument('--corners', help='playing-surface corners in the camera image: "x,y;x,y;x,y;x,y" (TL;TR;BR;BL)')
    ap.add_argument('--cushion', type=float, default=15, help='cushion width in table units for auto calibration')
    ap.add_argument('--ball-radius', type=float, default=12)
    ap.add_argument('--n8n', help='n8n webhook base, e.g. http://localhost:5678/webhook')
    ap.add_argument('--table', default='T1')
    ap.add_argument('--out', help='write all shot events to this JSON file')
    ap.add_argument('--truth', help='compare with a ground-truth game file (demo_game.json)')
    ap.add_argument('--debug', help='write an annotated top-down video here')
    ap.add_argument('--clips', help='save a short clip of every shot in this folder (for foul reviews)')
    ap.add_argument('--palette', help='ball colours of this venue\'s set (JSON, see palettes/creglia.json); default: standard set')
    ap.add_argument('--dump-at', type=float, help='print the colour features of every ball seen at this second, then stop (to write a palette)')
    args = ap.parse_args()

    src = int(args.source) if args.source.isdigit() else args.source
    cap = cv2.VideoCapture(src)
    if not cap.isOpened():
        sys.exit(f'Could not open {args.source}')
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    ok, frame = cap.read()
    if not ok:
        sys.exit('No frames')
    if args.corners:
        corners = np.float32([[float(v) for v in p.split(',')] for p in args.corners.split(';')])
        bg = frame
    else:
        corners, bg = calibrate(src, frame, args.cushion)
        print('auto-calibrated corners:', '; '.join(f'{x:.0f},{y:.0f}' for x, y in corners))
    palette = json.load(open(args.palette)) if args.palette else None
    Hm = cv2.getPerspectiveTransform(np.float32(corners), np.float32([[0, 0], [W, 0], [W, H], [0, H]]))
    det, ref = Detector(args.ball_radius, palette), Referee(fps, sticky=palette is not None)
    det.learn_fixtures(cv2.warpPerspective(bg, Hm, (W, H)))
    if args.dump_at is not None:
        cap.set(cv2.CAP_PROP_POS_MSEC, args.dump_at * 1000)
        ok, frame = cap.read()
        top = cv2.warpPerspective(frame, Hm, (W, H))
        for lab, p, conf, alts in sorted(det.detect(top), key=lambda d: d[1]):
            ft = det.features(det.hsv, int(p[0]), int(p[1]))
            print(f"{lab:>4} at {p[0]:4.0f},{p[1]:4.0f}  " + '  '.join(f'{k} {v:.2f}' if v < 2 else f'{k} {v:.0f}' for k, v in ft.items()))
        return
    prev_small = None
    dbg = cv2.VideoWriter(args.debug, cv2.VideoWriter_fourcc(*'mp4v'), fps, (W, H)) if args.debug else None
    if args.clips:
        os.makedirs(args.clips, exist_ok=True)
    buf, clip = deque(maxlen=int(fps)), None
    f, t0 = 0, time.time()
    while ok:
        top = cv2.warpPerspective(frame, Hm, (W, H))
        small = cv2.cvtColor(cv2.resize(top, (100, 50), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(np.int16)
        cut = prev_small is not None and float(np.abs(small - prev_small).mean()) > 6   # edited video jumped
        prev_small = small
        if ref.state == 'idle' and (f % 60 == 0 or cut):
            det.learn_felt(cv2.cvtColor(top, cv2.COLOR_BGR2HSV), det.occluded)   # follow slow light changes
        dets = det.detect(top)
        before = len(ref.events)
        was_idle = ref.state == 'idle'
        ref.update(dets, f, det.occluded, cut)
        if args.clips:
            if was_idle and ref.state == 'shot':
                clip = list(buf)
            if clip is not None:
                clip.append(frame)
            buf.append(frame)
        if len(ref.events) > before:
            ev = ref.events[-1]
            ev['clip'] = f"{args.table.lower()}_shot{ev['shotNo']:02d}.mp4"
            if args.clips and clip:
                vw = cv2.VideoWriter(os.path.join(args.clips, ev['clip']), cv2.VideoWriter_fourcc(*'mp4v'), fps, (frame.shape[1], frame.shape[0]))
                for fr in clip:
                    vw.write(fr)
                vw.release(); clip = None
            msg = post_to_n8n(args.n8n, args.table, ev) if args.n8n else 'not sent (no --n8n)'
            fc = ev['firstContact']
            print(f"shot {ev['shotNo']:>2}: potted {ev['potted']}{' + SCRATCH' if ev['cueBallPotted'] else ''}, first contact {fc}"
                  f"{' (%d%%)' % round(ev['confidence']['firstContact'] * 100) if fc else ''} -> {msg}")
        if dbg is not None:
            vis = top.copy()
            vis[det.occluded] //= 2
            for lab, p, conf, _ in dets:
                cv2.circle(vis, (int(p[0]), int(p[1])), int(args.ball_radius) + 3, (255, 255, 255), 1, cv2.LINE_AA)
                cv2.putText(vis, lab, (int(p[0]) + 14, int(p[1]) - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
            cv2.putText(vis, f"{'SHOT IN PROGRESS' if ref.state == 'shot' else 'WAITING'} | shots scored: {ref.shot_no}", (12, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
            dbg.write(vis)
        ok, frame = cap.read()
        f += 1
    el = time.time() - t0
    print(f'\nprocessed {f} frames in {el:.1f} s ({f / el:.0f} fps, real time needs {fps:.0f})')
    if dbg is not None:
        dbg.release()
    if args.out:
        json.dump(ref.events, open(args.out, 'w'), indent=1)
    if args.truth:
        compare(ref.events, args.truth)


if __name__ == '__main__':
    main()
