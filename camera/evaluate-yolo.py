"""
Evaluate the trained detector three ways.
  python evaluate_yolo.py --weights runs/fire_smoke/weights/best.pt --data data_fire.yaml \
        [--own path/to/own_frames/images] [--hardneg path/to/images_with_no_fire]

 1. Box level on the test split: precision, recall, mAP50, mAP50-95 (overall and per class).
 2. Image level on the test split: "does this frame contain fire / smoke?" at several confidence thresholds.
    This is the number the fusion step uses, so it matters more than mAP for your project.
 3. Your own camera frames (--own) and a no-fire folder (--hardneg): false alarms on red lights, sunsets, steam, etc.
"""
import argparse, numpy as np, pandas as pd, yaml
from pathlib import Path
from ultralytics import YOLO
from prepare_dataset import images_in, label_dir_for

THRS = [0.1, 0.2, 0.25, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]

def class_ids(names, key):
    return [i for i, n in names.items() if str(n).lower() == key]

def max_conf(model, imgs, imgsz, batch=16):
    """Highest fire / smoke confidence per image (run once at a low conf, threshold later)."""
    names = model.names; fire, smoke = class_ids(names, 'fire'), class_ids(names, 'smoke')
    rows = []
    for i in range(0, len(imgs), batch):
        chunk = [str(p) for p in imgs[i:i + batch]]
        for p, r in zip(chunk, model.predict(chunk, conf=0.05, imgsz=imgsz, verbose=False)):
            cls, cf = r.boxes.cls.cpu().numpy().astype(int), r.boxes.conf.cpu().numpy()
            rows.append(dict(path=p, p_fire=cf[np.isin(cls, fire)].max() if np.isin(cls, fire).any() else 0.0,
                             p_smoke=cf[np.isin(cls, smoke)].max() if np.isin(cls, smoke).any() else 0.0))
    return pd.DataFrame(rows)

def truth(imgs, lab_dir, names):
    fire, smoke = class_ids(names, 'fire'), class_ids(names, 'smoke'); out = []
    for im in imgs:
        ids = set()
        if lab_dir is not None and (lab_dir / (im.stem + '.txt')).exists():
            ids = {int(float(l.split()[0])) for l in (lab_dir / (im.stem + '.txt')).read_text().splitlines() if l.strip()}
        out.append(dict(has_fire=bool(ids & set(fire)), has_smoke=bool(ids & set(smoke))))
    return pd.DataFrame(out)

def image_level(df, tag):
    rows = []
    for target in ('fire', 'smoke'):
        y, s = df['has_' + target].values, df['p_' + target].values
        for t in THRS:
            p = s >= t; tp, fp, fn = (p & y).sum(), (p & ~y).sum(), (~p & y).sum(); tn = (~p & ~y).sum()
            rec = tp / (tp + fn) if tp + fn else np.nan; pre = tp / (tp + fp) if tp + fp else np.nan
            f1 = 2 * pre * rec / (pre + rec) if tp else 0.0
            if y.sum() == 0: pre = f1 = np.nan      # no positives in this set (e.g. hard negatives): only false-alarm rate is meaningful
            rows.append(dict(set=tag, target=target, conf=t, images=len(df), positives=int(y.sum()), recall=rec,
                             precision=pre, f1=f1, false_alarm_rate=fp / (fp + tn) if fp + tn else np.nan))
    return pd.DataFrame(rows)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--weights', required=True); ap.add_argument('--data', default=None, help='data yaml; optional if you only evaluate --own / --hardneg')
    ap.add_argument('--own', default=None, help='images dir of your own labelled camera frames (labels in sibling labels dir)')
    ap.add_argument('--hardneg', default=None, help='folder of images that contain NO fire or smoke')
    ap.add_argument('--imgsz', type=int, default=640); ap.add_argument('--out', default='eval_out')
    a = ap.parse_args(); out = Path(a.out); out.mkdir(exist_ok=True)
    model = YOLO(a.weights); names = model.names
    pd.set_option('display.width', 220); reports = []
    if not (a.data or a.own or a.hardneg): raise SystemExit('give at least one of --data, --own, --hardneg')

    if a.data:
        cfg = yaml.safe_load(Path(a.data).read_text())
        # 1. box level
        split = 'test' if cfg.get('test') else 'val'
        m = model.val(data=a.data, split=split, imgsz=a.imgsz, verbose=False)
        box = [dict(cls='ALL', precision=m.box.mp, recall=m.box.mr, mAP50=m.box.map50, mAP50_95=m.box.map)]
        for j, c in enumerate(m.box.ap_class_index):
            box.append(dict(cls=names[int(c)], precision=m.box.p[j], recall=m.box.r[j], mAP50=m.box.ap50[j], mAP50_95=m.box.ap[j]))
        B = pd.DataFrame(box).round(3); B.to_csv(out / 'box_metrics.csv', index=False)
        print(f'\n1) BOX LEVEL on {split} split'); print(B.to_string(index=False))

        # 2. image level on test split
        root = Path(cfg.get('path', '.')); img_dir = (root / cfg[split]).resolve(); imgs = images_in(img_dir)
        df = pd.concat([max_conf(model, imgs, a.imgsz), truth(imgs, label_dir_for(img_dir), names)], axis=1)
        df.to_csv(out / f'scores_{split}.csv', index=False); reports.append(image_level(df, split))

    # 3. own frames and no-fire folder
    if a.own:
        d = Path(a.own); imgs = images_in(d)
        df = pd.concat([max_conf(model, imgs, a.imgsz), truth(imgs, label_dir_for(d), names)], axis=1)
        df.to_csv(out / 'scores_own.csv', index=False); reports.append(image_level(df, 'own'))
    if a.hardneg:
        imgs = images_in(Path(a.hardneg))
        df = pd.concat([max_conf(model, imgs, a.imgsz), truth(imgs, None, names)], axis=1)
        df.to_csv(out / 'scores_hardneg.csv', index=False); reports.append(image_level(df, 'hardneg'))
        print('\n   highest-scoring FALSE alarms in hardneg folder:')
        print(df.sort_values('p_fire', ascending=False).head(5)[['path', 'p_fire', 'p_smoke']].to_string(index=False))

    R = pd.concat(reports).round(3); R.to_csv(out / 'image_level.csv', index=False)
    print('\n2/3) IMAGE LEVEL (fire target)'); print(R[R.target == 'fire'].drop(columns='target').to_string(index=False))
    print('\nsmoke target is in', out / 'image_level.csv')