"""
Live fire/smoke test with your webcam (or a video file).

  python live_camera.py --weights weights\best.pt
  python live_camera.py --weights weights\best.pt --conditions "baseline,red_object,lighter_30cm,lighter_60cm" --out_video demo.mp4

Keys:  q = quit   s = save snapshot   1..9 = switch the condition label (see --conditions)   0 = 'none'
The log (session_log.csv) has a timestamp per processed frame, so it can be lined up with the sensor log later.
At exit it prints a per-condition summary: % of frames with fire, max p_fire, seconds until first detection.
"""
import argparse, os, time, datetime
import cv2, pandas as pd
from pathlib import Path
from camera_model import FireCameraDetector

FONT = cv2.FONT_HERSHEY_SIMPLEX
COL = {'fire': (0, 0, 255), 'smoke': (210, 210, 210)}

def draw(frame, res):
    for b in res['boxes']:
        x1, y1, x2, y2 = b['xyxy']; c = COL.get(b['name'].lower(), (0, 255, 0))
        cv2.rectangle(frame, (x1, y1), (x2, y2), c, 2)
        cv2.putText(frame, f"{b['name']} {b['conf']:.2f}", (x1, max(18, y1 - 6)), FONT, 0.6, c, 2)

def banner(frame, res, fps, cond):
    if res['alert']: text, col = 'FIRE ALERT', (0, 0, 255)
    elif res['fire']: text, col = 'fire seen - confirming', (0, 165, 255)
    elif res['smoke']: text, col = 'smoke seen', (0, 215, 255)
    else: text, col = 'no fire', (0, 180, 0)
    cv2.rectangle(frame, (0, 0), (frame.shape[1], 62), (0, 0, 0), -1)
    cv2.putText(frame, text, (10, 28), FONT, 0.9, col, 2)
    cv2.putText(frame, f"p_fire {res['p_fire']:.2f}  p_smoke {res['p_smoke']:.2f}  {fps:4.1f} fps  condition: {cond}",
                (10, 54), FONT, 0.55, (255, 255, 255), 1)

def summarize(df):
    """One row per consecutive stretch of the same condition."""
    seg = (df.condition != df.condition.shift()).cumsum(); rows = []
    for _, g in df.groupby(seg, sort=True):
        t0 = g.t_s.iloc[0]; ff = g[g.fire == 1]; fa = g[g.alert == 1]
        rows.append(dict(condition=g.condition.iloc[0], seconds=round(g.t_s.iloc[-1] - t0, 1), frames=len(g),
                         fire_frames_pct=round(100 * g.fire.mean(), 1), smoke_frames_pct=round(100 * g.smoke.mean(), 1),
                         alert_frames_pct=round(100 * g.alert.mean(), 1), max_p_fire=round(g.p_fire.max(), 3),
                         first_fire_after_s=round(ff.t_s.iloc[0] - t0, 1) if len(ff) else None,
                         first_alert_after_s=round(fa.t_s.iloc[0] - t0, 1) if len(fa) else None))
    return pd.DataFrame(rows)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--weights', required=True); ap.add_argument('--source', default='0', help='webcam index (0, 1 ...) or a video file')
    ap.add_argument('--conf', type=float, default=0.25); ap.add_argument('--imgsz', type=int, default=640, help='try 416 if it is too slow')
    ap.add_argument('--every', type=int, default=2, help='run the model on every Nth frame')
    ap.add_argument('--conditions', default='baseline,test_a,test_b,test_c', help='labels for keys 1..9, comma separated')
    ap.add_argument('--log', default='session_log.csv'); ap.add_argument('--snap_dir', default='snapshots')
    ap.add_argument('--out_video', default=None); ap.add_argument('--nogui', action='store_true')
    ap.add_argument('--max_seconds', type=float, default=0, help='stop after this many seconds (0 = until you press q)')
    a = ap.parse_args()

    conds = [c.strip() for c in a.conditions.split(',') if c.strip()][:9]; cond = 'none'
    src = int(a.source) if a.source.isdigit() else a.source
    cap = cv2.VideoCapture(src, cv2.CAP_DSHOW) if (isinstance(src, int) and os.name == 'nt') else cv2.VideoCapture(src)
    if not cap.isOpened(): raise SystemExit(f'cannot open source {a.source}. Close other apps using the camera, or try --source 1')
    det = FireCameraDetector(a.weights, conf=a.conf, imgsz=a.imgsz)
    Path(a.snap_dir).mkdir(exist_ok=True); writer = None; res = None; rows = []; i = 0
    t_start = time.time(); t_prev = t_start; fps = 0.0
    print('running. keys: q quit | s snapshot | 1..9 condition |', {k + 1: c for k, c in enumerate(conds)})
    while True:
        ok, frame = cap.read()
        if not ok: break
        now = time.time()
        if i % a.every == 0 or res is None:
            res = det.detect(frame); dt = now - t_prev; t_prev = now
            fps = (1 / dt * a.every) if dt > 0 and i else fps
            rows.append(dict(timestamp=datetime.datetime.now().isoformat(timespec='milliseconds'), t_s=round(now - t_start, 3),
                             frame=i, condition=cond, p_fire=res['p_fire'], p_smoke=res['p_smoke'],
                             fire=int(res['fire']), smoke=int(res['smoke']), alert=int(res['alert'])))
        draw(frame, res); banner(frame, res, fps, cond)
        if a.out_video:
            if writer is None:
                h, w = frame.shape[:2]
                writer = cv2.VideoWriter(a.out_video, cv2.VideoWriter_fourcc(*'mp4v'), cap.get(cv2.CAP_PROP_FPS) or 20, (w, h))
            writer.write(frame)
        if not a.nogui:
            cv2.imshow('fire / smoke test  (q = quit)', frame); k = cv2.waitKey(1) & 0xFF
            if k == ord('q'): break
            if k == ord('s'): cv2.imwrite(str(Path(a.snap_dir) / f'snap_{int(now)}_{cond}.jpg'), frame); print('snapshot saved')
            if k == ord('0'): cond = 'none'
            if ord('1') <= k <= ord('9') and k - ord('1') < len(conds): cond = conds[k - ord('1')]; print('condition ->', cond)
        if a.max_seconds and now - t_start >= a.max_seconds: break
        i += 1
    cap.release(); writer and writer.release(); cv2.destroyAllWindows()
    if rows:
        df = pd.DataFrame(rows); df.to_csv(a.log, index=False); pd.set_option('display.width', 220)
        print(f'\nlog saved: {a.log}  ({len(df)} processed frames)\n'); print(summarize(df).to_string(index=False))