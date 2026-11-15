"""Render a fake overhead-camera video of the demo game, so the vision service can be tested without a pool table.

The camera is slightly off-centre (perspective), with sensor noise, blur and uneven lighting.
Real footage is harder (glare, players leaning over the table, cue sticks, shadows), so treat
a pass here as "the logic works", not "the accuracy is proven".

    python make_test_video.py --out test_game.mp4
"""
import argparse
import json
import math
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
S = 2          # render scale (table units -> canvas pixels)
M = 96         # rail margin on the canvas, in canvas pixels
FPS = 30
CAM_W, CAM_H = 1280, 720
# Where the four corners of the playing surface land in the camera image (TL, TR, BR, BL).
CAM_CORNERS = np.float32([[150, 95], [1130, 85], [1185, 640], [95, 650]])
FELT = (71, 106, 29)
COLORS = {1: (15, 193, 242), 2: (208, 79, 31), 3: (42, 42, 212), 4: (158, 47, 106),
          5: (18, 119, 238), 6: (88, 157, 15), 7: (36, 31, 125), 8: (24, 24, 24)}


def ease(x):
    return 1 - (1 - x) ** 3


def lerp(a, b, x):
    return (a[0] + (b[0] - a[0]) * x, a[1] + (b[1] - a[1]) * x)


def frame_positions(frm, to, shot, x, pockets):
    """Same motion model as the web app: cue ball travels to the contact point, then object balls move."""
    pts = shot.get('cuePath')
    d = lambda a, b: math.hypot(a[0] - b[0], a[1] - b[1])
    tc = 0.0
    if pts and len(pts) == 3:
        tc = min(0.42, max(0.16, d(pts[0], pts[1]) / (d(pts[0], pts[1]) + d(pts[1], pts[2]) + 1) * 0.6))
    out = {}
    for b in set(frm) | set(to):
        if b == 'cue':
            if pts and len(pts) == 3:
                p = lerp(pts[0], pts[1], x / tc) if x < tc else lerp(pts[1], pts[2], ease((x - tc) / (1 - tc)))
            elif pts:
                p = lerp(pts[0], pts[1], ease(x))
            else:
                p = to.get('cue') or frm.get('cue')
            if 'cue' not in to and x > 0.9:
                continue                      # scratched: gone into the pocket
            out['cue'] = p
            continue
        a, c = frm.get(b), to.get(b)
        y = 0 if x < tc else ease((x - tc) / (1 - tc))
        if a and c:
            out[b] = lerp(a, c, y)
        elif a and not c:
            pk = pockets[shot['pockets'][b]] if b in shot.get('pockets', {}) else a
            if y < 0.88:
                out[b] = lerp(a, pk, y)
        elif c and x > 0.2:
            out[b] = c
    return out


def draw_ball(img, b, cx, cy, r):
    cx, cy = int(round(cx)), int(round(cy))
    if b == 'cue':
        cv2.circle(img, (cx, cy), r, (238, 240, 236), -1, cv2.LINE_AA)
    else:
        n = int(b)
        col = COLORS[n - 8 if n > 8 else n]
        if n > 8:
            cv2.circle(img, (cx, cy), r, (238, 240, 236), -1, cv2.LINE_AA)
            mask = np.zeros(img.shape[:2], np.uint8)
            cv2.circle(mask, (cx, cy), r, 255, -1, cv2.LINE_AA)
            band = np.zeros_like(mask)
            cv2.rectangle(band, (cx - r, int(cy - r * 0.56)), (cx + r, int(cy + r * 0.56)), 255, -1)
            img[(mask > 0) & (band > 0)] = col
        else:
            cv2.circle(img, (cx, cy), r, col, -1, cv2.LINE_AA)
        cv2.circle(img, (cx, cy), int(r * 0.5), (240, 240, 240), -1, cv2.LINE_AA)
    cv2.ellipse(img, (cx - int(r * .38), cy - int(r * .45)), (max(2, int(r * .3)), max(1, int(r * .18))), 0, 0, 360, (255, 255, 255), -1, cv2.LINE_AA)


def render_topdown(pos, table):
    W, H = table['W'], table['H']
    img = np.full((H * S + 2 * M, W * S + 2 * M, 3), (30, 47, 74), np.uint8)       # rail
    cv2.rectangle(img, (M - 30, M - 30), (M + W * S + 30, M + H * S + 30), (40, 70, 26), -1)  # cushion
    cv2.rectangle(img, (M, M), (M + W * S, M + H * S), FELT, -1)
    for px, py in table['pockets']:
        cv2.circle(img, (M + px * S, M + py * S), 23 * S, (12, 14, 13), -1, cv2.LINE_AA)
    r = (table['R'] + 1) * S
    for b, (x, y) in pos.items():
        draw_ball(img, b, M + x * S, M + y * S, r)
    return img


def to_camera(top, H_mat, rng, frame_no):
    cam = cv2.warpPerspective(top, H_mat, (CAM_W, CAM_H), borderValue=(22, 22, 22))
    yy, xx = np.mgrid[0:CAM_H, 0:CAM_W]
    light = 1.05 - 0.22 * (((xx - CAM_W * 0.45) / CAM_W) ** 2 + ((yy - CAM_H * 0.4) / CAM_H) ** 2) * 2.2
    cam = np.clip(cam.astype(np.float32) * light[..., None] + rng.normal(0, 3.2, cam.shape), 0, 255).astype(np.uint8)
    return cv2.GaussianBlur(cam, (3, 3), 0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--game', default=os.path.join(HERE, 'demo_game.json'))
    ap.add_argument('--out', default=os.path.join(HERE, 'test_game.mp4'))
    args = ap.parse_args()
    game = json.load(open(args.game))
    table = game['table']
    src = np.float32([[M, M], [M + table['W'] * S, M], [M + table['W'] * S, M + table['H'] * S], [M, M + table['H'] * S]])
    H_mat = cv2.getPerspectiveTransform(src, CAM_CORNERS)
    pockets = [tuple(p) for p in table['pockets']]
    vw = cv2.VideoWriter(args.out, cv2.VideoWriter_fourcc(*'mp4v'), FPS, (CAM_W, CAM_H))
    rng = np.random.default_rng(7)
    pos = {k: tuple(v) for k, v in game['rack'].items()}
    n = 0

    def still(p, seconds):
        nonlocal n
        top = render_topdown(p, table)
        for _ in range(int(seconds * FPS)):
            vw.write(to_camera(top, H_mat, rng, n)); n += 1

    still(pos, 1.2)
    for shot in game['shots']:
        to = {k: tuple(v) for k, v in shot['positions'].items()}
        frm = dict(pos)
        if shot.get('cuePath'):
            frm['cue'] = tuple(shot['cuePath'][0])       # ball in hand: the cue ball is placed first
            still(frm, 0.6)
        steps = int(1.5 * FPS)
        for i in range(steps + 1):
            p = frame_positions(frm, to, shot, i / steps, pockets)
            vw.write(to_camera(render_topdown(p, table), H_mat, rng, n)); n += 1
        pos = to
        still(pos, 0.9)
    vw.release()
    json.dump({'corners': CAM_CORNERS.tolist(), 'fps': FPS, 'frames': n}, open(os.path.splitext(args.out)[0] + '.camera.json', 'w'))
    print(f'wrote {args.out}: {n} frames ({n / FPS:.1f} s) at {CAM_W}x{CAM_H}')


if __name__ == '__main__':
    main()
