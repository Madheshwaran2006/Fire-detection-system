"""
Check a YOLO-format fire/smoke dataset and (optionally) create the splits you are missing.

  python prepare_dataset.py --yaml path/to/data.yaml                     # just inspect + write data_fire.yaml
  python prepare_dataset.py --yaml data.yaml --make_val 0.15             # carve 15% of train into val (MOVES files)
  python prepare_dataset.py --yaml data.yaml --make_val 0.15 --make_test 0.10

Works with both common layouts:  root/images/train + root/labels/train   and   root/train/images + root/train/labels.
Class ids are read from the yaml names, nothing is hard-coded.
"""
import argparse, random, shutil, yaml
from pathlib import Path
from collections import Counter

IMG_EXT = {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}

def label_dir_for(img_dir: Path) -> Path:
    parts = list(img_dir.parts)
    for i in range(len(parts) - 1, -1, -1):          # same rule ultralytics uses: last 'images' -> 'labels'
        if parts[i] == 'images':
            parts[i] = 'labels'; return Path(*parts)
    raise ValueError(f'no "images" folder in path: {img_dir}')

def images_in(d: Path):
    return sorted(p for p in d.iterdir() if p.suffix.lower() in IMG_EXT) if d.exists() else []

def inspect_split(name, img_dir: Path, names):
    imgs = images_in(img_dir); lab_dir = label_dir_for(img_dir)
    boxes, empty, missing, bad = Counter(), 0, 0, 0
    for im in imgs:
        lf = lab_dir / (im.stem + '.txt')
        if not lf.exists():
            missing += 1; continue
        lines = [l.split() for l in lf.read_text().splitlines() if l.strip()]
        if not lines: empty += 1
        for l in lines:
            try:
                c = int(float(l[0])); xywh = list(map(float, l[1:5]))
                if c not in names or len(l) < 5 or any(v < 0 or v > 1 for v in xywh): bad += 1
                else: boxes[c] += 1
            except Exception:
                bad += 1
    print(f'  {name:<5} images={len(imgs):>6}  background(no-object)={empty + missing:>5}  '
          f'missing-label-file={missing:>4}  bad-lines={bad:>4}  boxes=' +
          ', '.join(f'{names[c]}:{n}' for c, n in sorted(boxes.items())))
    return imgs

def carve(root, train_dir: Path, new_name, frac, seed=0):
    """Move a random fraction of train image+label pairs into a new split folder (no copies -> no leakage)."""
    parts = list(train_dir.parts)
    idx = [i for i, p in enumerate(parts) if p == 'train']
    if not idx: raise SystemExit('could not find a "train" folder in the path to carve from')
    parts[idx[-1]] = new_name; new_img = Path(*parts); new_lab = label_dir_for(new_img)
    new_img.mkdir(parents=True, exist_ok=True); new_lab.mkdir(parents=True, exist_ok=True)
    imgs = images_in(train_dir); random.Random(seed).shuffle(imgs)
    k = int(len(imgs) * frac); lab_dir = label_dir_for(train_dir)
    for im in imgs[:k]:
        shutil.move(str(im), new_img / im.name)
        lf = lab_dir / (im.stem + '.txt')
        if lf.exists(): shutil.move(str(lf), new_lab / lf.name)
    print(f'  moved {k} train images -> {new_name}'); return new_img

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--yaml', required=True); ap.add_argument('--make_val', type=float, default=0)
    ap.add_argument('--make_test', type=float, default=0); ap.add_argument('--seed', type=int, default=0)
    a = ap.parse_args()

    ypath = Path(a.yaml).resolve(); cfg = yaml.safe_load(ypath.read_text())
    root = Path(cfg.get('path', ypath.parent)); root = root if root.is_absolute() else (ypath.parent / root).resolve()
    names = cfg['names']; names = dict(enumerate(names)) if isinstance(names, list) else {int(k): v for k, v in names.items()}
    print('classes:', names)
    dirs = {s: (root / cfg[s]).resolve() for s in ('train', 'val', 'test') if cfg.get(s)}
    if 'train' not in dirs: raise SystemExit('yaml has no train split')
    if a.make_val and 'val' not in dirs: dirs['val'] = carve(root, dirs['train'], 'val', a.make_val, a.seed)
    if a.make_test and 'test' not in dirs: dirs['test'] = carve(root, dirs['train'], 'test', a.make_test, a.seed)

    print('\nsplit summary:')
    for s, d in dirs.items(): inspect_split(s, d, names)
    for s in ('val', 'test'):
        if s not in dirs: print(f'  WARNING: no {s} split. Use --make_{s} 0.1 (val 0.15 / test 0.10 is a good start).')

    out = ypath.parent / 'data_fire.yaml'
    out.write_text(yaml.safe_dump({'path': str(root), **{s: str(d) for s, d in dirs.items()}, 'names': names}, sort_keys=False))
    print('\nwrote', out)