"""
Test the fire/smoke detector on a folder-based test set (no label files needed).

  testset/
    fire/                 photos that clearly show flame
    smoke/                photos with smoke but no flame
    no_fire/<category>/   hard negatives, one sub-folder per category: red_light, sunset, steam, incense, room ...

  python folder_test.py --weights weights/best.pt --root testset [--conf 0.25]

Reports, at several confidence thresholds:
  fire recall   (fire/ images where the model says fire)           -> missed fires
  false alarms  (non-fire images where the model says fire/smoke)  -> per category, with 95% confidence intervals
Saves the missed fires and the false alarms with the boxes drawn, so you can look at WHY it was wrong.
"""
import argparse, numpy as np, pandas as pd
from pathlib import Path
from PIL import Image
from ultralytics import YOLO
from evaluate_yolo import max_conf, THRS
from prepare_dataset import images_in

def wilson(k, n, z=1.96):
    if n == 0: return (np.nan, np.nan)
    p = k / n; d = 1 + z * z / n; c = p + z * z / (2 * n); h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n))
    return ((c - h) / d, (c + h) / d)

def fmt(k, n):
    if n == 0: return '   n/a'
    lo, hi = wilson(k, n); return f'{k / n:5.1%} [{lo:4.0%}-{hi:4.0%}] n={n}'

def scan(root: Path):
    rows = []
    for grp in ('fire', 'smoke'):
        for p in images_in(root / grp): rows.append((p, grp, grp))
    neg = root / 'no_fire'
    for p in images_in(neg): rows.append((p, 'negative', 'no_fire'))
    if neg.exists():
        for sub in sorted(d for d in neg.iterdir() if d.is_dir()):
            for p in images_in(sub): rows.append((p, 'negative', sub.name))
    return pd.DataFrame(rows, columns=['path', 'group', 'category'])

def save_annotated(model, path, out, conf, imgsz):
    r = model.predict(str(path), conf=conf, imgsz=imgsz, verbose=False)[0]
    out.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(r.plot()[..., ::-1]).save(out)          # plot() is BGR -> RGB

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--weights', required=True); ap.add_argument('--root', required=True)
    ap.add_argument('--conf', type=float, default=0.25, help='threshold used for the per-category table and error images')
    ap.add_argument('--imgsz', type=int, default=640); ap.add_argument('--out', default='eval_out'); ap.add_argument('--max_err', type=int, default=30)
    a = ap.parse_args(); out = Path(a.out); out.mkdir(exist_ok=True)

    df = scan(Path(a.root))
    if df.empty: raise SystemExit(f'no images found under {a.root} (expected fire/, smoke/, no_fire/<category>/)')
    print('images found:', df.groupby(['group', 'category']).size().to_dict())
    for g in ('fire', 'smoke', 'negative'):
        n = (df.group == g).sum()
        if n == 0: print(f'WARNING: no images in group "{g}"')
        elif n < 30: print(f'WARNING: only {n} images in "{g}" -> results for it are rough (see the confidence intervals)')

    model = YOLO(a.weights)
    sc = max_conf(model, [Path(p) for p in df.path], a.imgsz)
    df = pd.concat([df.reset_index(drop=True), sc[['p_fire', 'p_smoke']]], axis=1); df.to_csv(out / 'folder_scores.csv', index=False)

    F, S, N = (df[df.group == g] for g in ('fire', 'smoke', 'negative'))
    rows = []
    for t in THRS:
        rows.append(dict(conf=t, fire_recall=(F.p_fire >= t).mean() if len(F) else np.nan,
                         smoke_recall=(S.p_smoke >= t).mean() if len(S) else np.nan,
                         fire_false_alarm_on_smoke_imgs=(S.p_fire >= t).mean() if len(S) else np.nan,
                         fire_false_alarm_on_negatives=(N.p_fire >= t).mean() if len(N) else np.nan,
                         smoke_false_alarm_on_negatives=(N.p_smoke >= t).mean() if len(N) else np.nan))
    T = pd.DataFrame(rows).round(3); T.to_csv(out / 'folder_summary.csv', index=False)
    pd.set_option('display.width', 220)
    print('\nTHRESHOLD SWEEP'); print(T.to_string(index=False))

    t = a.conf
    print(f'\nAT conf={t}  (rate [95% interval] n)')
    if len(F): print('  fire recall               ', fmt(int((F.p_fire >= t).sum()), len(F)))
    if len(S): print('  smoke recall              ', fmt(int((S.p_smoke >= t).sum()), len(S)))
    if len(S): print('  fire alarm on smoke images', fmt(int((S.p_fire >= t).sum()), len(S)))
    cat = []
    for c, g in N.groupby('category'):
        cat.append(dict(category=c, n=len(g), fire_false_alarm=(g.p_fire >= t).mean(), smoke_false_alarm=(g.p_smoke >= t).mean()))
        print(f'  {c:<18} fire FA', fmt(int((g.p_fire >= t).sum()), len(g)), '| smoke FA', fmt(int((g.p_smoke >= t).sum()), len(g)))
    pd.DataFrame(cat).round(3).to_csv(out / 'folder_by_category.csv', index=False)

    missed = F[F.p_fire < t].sort_values('p_fire').head(a.max_err)
    fa = pd.concat([S, N])[lambda d: d.p_fire >= t].sort_values('p_fire', ascending=False).head(a.max_err)
    for _, r in missed.iterrows(): save_annotated(model, r.path, out / 'errors' / 'missed_fire' / Path(r.path).name, t, a.imgsz)
    for _, r in fa.iterrows(): save_annotated(model, r.path, out / 'errors' / 'false_fire_alarm' / f'{r.category}_{Path(r.path).name}', t, a.imgsz)
    print(f'\nsaved: {len(missed)} missed-fire and {len(fa)} false-alarm images -> {out / "errors"}')
    print('look at them: wrong labels in your folders also show up here.')