"""
Download a starter test set from Bing image search, then clean it.   pip install icrawler pillow

  python build_test_set.py --root testset --per_query 15      # download + clean
  python build_test_set.py --root testset --clean_only         # only (re)clean, e.g. after you added your own photos

The downloaded images are NOT verified. You must open the folders and delete wrong images
(cartoons, logos, a 'steam' photo that shows fire ...) before trusting any result.
Use them for private testing only; do not redistribute them (copyright belongs to the original owners).
Add your OWN camera photos to the same folders: they are the most valuable part of the test set.
"""
import argparse, hashlib
from pathlib import Path
from PIL import Image

QUERIES = {
    'fire': ['candle flame close up', 'small fire burning paper', 'campfire flames', 'lighter flame', 'house fire flames', 'burning wood flames'],
    'smoke': ['smoke rising from smouldering fire', 'wildfire smoke plume', 'burning cardboard smoke', 'smoke filled room fire'],
    'no_fire/red_light': ['red led lights', 'red traffic light night', 'red lamp glowing', 'red neon sign'],
    'no_fire/sunset': ['orange sunset sky', 'sunrise orange sky clouds'],
    'no_fire/steam': ['kettle steam', 'boiling water steam', 'morning mist fog'],
    'no_fire/lights': ['orange street lights night', 'glowing light bulb', 'sunlight through window room'],
    'no_fire/incense': ['incense stick smoke'],
    'no_fire/room': ['living room interior', 'kitchen interior', 'office room interior'],
}

def crawl(root: Path, per_query: int):
    from icrawler.builtin import BingImageCrawler
    for folder, queries in QUERIES.items():
        d = root / folder; d.mkdir(parents=True, exist_ok=True)
        for q in queries:
            print(f'[{folder}] {q}')
            BingImageCrawler(storage={'root_dir': str(d)}, downloader_threads=4).crawl(keyword=q, max_num=per_query, file_idx_offset='auto')

def clean(root: Path, min_side=128):
    """Remove unreadable files, tiny images and exact duplicates (also across folders)."""
    seen, removed = {}, {'unreadable': 0, 'tiny': 0, 'duplicate': 0}
    for p in sorted(root.rglob('*')):
        if not p.is_file() or p.suffix.lower() not in {'.jpg', '.jpeg', '.png', '.bmp', '.webp'}: continue
        try:
            with Image.open(p) as im: im.verify()
            with Image.open(p) as im: w, h = im.size
        except Exception:
            p.unlink(); removed['unreadable'] += 1; continue
        if min(w, h) < min_side: p.unlink(); removed['tiny'] += 1; continue
        h5 = hashlib.md5(p.read_bytes()).hexdigest()
        if h5 in seen: p.unlink(); removed['duplicate'] += 1; continue
        seen[h5] = p
    print('removed:', removed)
    for d in sorted({p.parent for p in root.rglob('*') if p.is_file()}):
        print(f'  {str(d.relative_to(root)):<24} {sum(1 for f in d.iterdir() if f.is_file()):>4} images')

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default='testset'); ap.add_argument('--per_query', type=int, default=15)
    ap.add_argument('--clean_only', action='store_true')
    a = ap.parse_args(); root = Path(a.root); root.mkdir(exist_ok=True)
    if not a.clean_only: crawl(root, a.per_query)
    clean(root)
    print('\nNEXT: open each folder and delete wrong images, add your own photos, then run folder_test.py')