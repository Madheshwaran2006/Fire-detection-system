"""
Camera branch: wraps the trained YOLO model and gives the fusion step two numbers per frame.
  p_fire   highest 'fire'  confidence in the frame (0 if none)
  p_smoke  highest 'smoke' confidence in the frame (0 if none)
Persistence rule (same idea as the sensor branch): alert only if fire is seen in >= k of the last n frames.

  python camera_model.py --weights best.pt --image frame.jpg
  python camera_model.py --weights best.pt --video clip.mp4 --every 5
"""
import argparse, collections

class FireCameraDetector:
    def __init__(self, weights, conf=0.25, imgsz=640, persist_n=5, persist_k=3):
        from ultralytics import YOLO
        self.model, self.conf, self.imgsz = YOLO(weights), conf, imgsz
        n = self.model.names
        self.fire = [i for i, v in n.items() if str(v).lower() == 'fire']
        self.smoke = [i for i, v in n.items() if str(v).lower() == 'smoke']
        self.votes = collections.deque(maxlen=persist_n); self.k, self.n = persist_k, persist_n

    def detect(self, frame):
        """frame: image path or a numpy BGR array (e.g. from cv2). Call once per processed frame."""
        r = self.model.predict(frame, conf=0.05, imgsz=self.imgsz, verbose=False)[0]
        cls, cf = r.boxes.cls.cpu().numpy().astype(int), r.boxes.conf.cpu().numpy()
        best = lambda ids: max([c for k, c in zip(cls, cf) if k in ids], default=0.0)
        p_fire, p_smoke = float(best(self.fire)), float(best(self.smoke))
        fire = p_fire >= self.conf; self.votes.append(fire)
        alert = len(self.votes) == self.n and sum(self.votes) >= self.k
        return dict(p_fire=round(p_fire, 3), p_smoke=round(p_smoke, 3), fire=bool(fire),
                    smoke=bool(p_smoke >= self.conf), alert=bool(alert),
                    p_camera=round(p_fire, 3))   # fusion input; refine when we tune the fusion

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--weights', required=True); ap.add_argument('--image'); ap.add_argument('--video')
    ap.add_argument('--every', type=int, default=5, help='process every Nth video frame'); ap.add_argument('--conf', type=float, default=0.25)
    a = ap.parse_args(); det = FireCameraDetector(a.weights, conf=a.conf)
    if a.image:
        print(det.detect(a.image))
    elif a.video:
        import cv2
        cap = cv2.VideoCapture(a.video); i = 0
        while True:
            ok, frame = cap.read()
            if not ok: break
            if i % a.every == 0: print(i, det.detect(frame))
            i += 1