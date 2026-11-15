"""Score the camera referee on real footage against a hand-labelled truth file.

    python referee_vision.py --source real/creglia_drill08.mp4 --palette palettes/creglia.json --out ev08.json
    python eval_real.py ev08.json real/truth_drill08.json
    python eval_real.py ev10.json real/truth_drill10.json --count-only 120.6-244.3

Detected shots are matched to truth shots by time: a detected shot covers frames [start, end] / fps,
a truth shot covers [t_start, t_end]; pairs are matched one to one, largest overlap first. A detected
shot that overlaps no truth shot is "extra"; a truth shot with no partner is "missed".
On matched pairs: potted balls (exact numbers, and the count alone), scratch, and first contact
(truth "unsure" or null is left out). --count-only FROM-TO scores potted balls by count only inside that
time window (racks where numbers repeat, so the number cannot name the ball).
"""
import argparse
import json


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('events')
    ap.add_argument('truth')
    ap.add_argument('--fps', type=float, default=30.0)
    ap.add_argument('--count-only', help='time window FROM-TO (seconds) where potted is scored by count only')
    args = ap.parse_args()
    events = json.load(open(args.events))
    truth = json.load(open(args.truth))['shots']
    win = [float(v) for v in args.count_only.split('-')] if args.count_only else None

    spans = [(e['frames'][0] / args.fps, e['frames'][1] / args.fps) for e in events]
    pairs = []
    for i, t in enumerate(truth):
        for j, (a, b) in enumerate(spans):
            ov = min(b, t['t_end']) - max(a, t['t_start'])
            if ov > 0:
                pairs.append((ov, i, j))
    match, used = {}, set()
    for ov, i, j in sorted(pairs, reverse=True):
        if i not in match and j not in used:
            match[i] = j; used.add(j)

    n_p = n_pc = n_s = n_f = n_ft = full = 0
    print('truth shot     time           potted truth/seen     scratch  first contact truth/seen')
    for i, t in enumerate(truth):
        j = match.get(i)
        e = events[j] if j is not None else None
        count_only = win is not None and win[0] <= t['t_start'] < win[1]
        if e is None:
            print(f"{i + 1:>4}   {t['t_start']:7.2f}-{t['t_end']:7.2f}   {str(t['potted']):>8} / MISSED")
            continue
        seen = sorted(e['potted'])
        ok_c = len(seen) == len(t['potted'])
        ok_p = ok_c if count_only else seen == sorted(t['potted'])
        ok_s = e['cueBallPotted'] == bool(t['scratch'])
        fc = t.get('first_contact')
        has_f = isinstance(fc, int)
        ok_f = has_f and e['firstContact'] == fc
        n_p += ok_p; n_pc += ok_c; n_s += ok_s; n_ft += has_f; n_f += ok_f
        full += ok_p and ok_s and (ok_f or not has_f)
        a, b = spans[j]
        print(f"{i + 1:>4}   {t['t_start']:7.2f}-{t['t_end']:7.2f}   {str(t['potted']):>8} / {str(seen):<8} {'ok' if ok_p else 'XX'}{' (count)' if count_only else '        '}"
              f"  {'ok' if ok_s else 'XX'}      {str(fc):>6} / {str(e['firstContact']):<5} {'ok' if ok_f else ('--' if not has_f else 'XX')}"
              f"   seen {a:.2f}-{b:.2f} (#{e['shotNo']})")
    extra = [events[j] for j in range(len(events)) if j not in used]
    for e in extra:
        a, b = e['frames'][0] / args.fps, e['frames'][1] / args.fps
        print(f"extra  {a:7.2f}-{b:7.2f}   potted {e['potted']}{' + scratch' if e['cueBallPotted'] else ''}, first contact {e['firstContact']} (#{e['shotNo']})")
    m = len(match)
    pct = lambda x, n: f'{x}/{n} ({100 * x / n:.0f}%)' if n else '0/0'
    print(f"\nshots: {len(truth)} in truth, {len(events)} detected: {m} matched, {len(truth) - m} missed, {len(extra)} extra")
    print(f"on matched shots: potted correct {pct(n_p, m)} (count right {pct(n_pc, m)}), scratch correct {pct(n_s, m)}, "
          f"first contact correct {pct(n_f, n_ft)} (unsure/null left out)")
    print(f"truth shots fully correct (matched, potted, scratch, first contact): {pct(full, len(truth))}")


if __name__ == '__main__':
    main()
