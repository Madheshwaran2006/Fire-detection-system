"""Train a YOLO fire/smoke detector.  python train_yolo.py --data data_fire.yaml --epochs 50"""
import argparse
from ultralytics import YOLO

ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True)
ap.add_argument('--model', default='yolov8n.pt', help='yolov8n.pt (fast, small) or yolov8s.pt (more accurate)')
ap.add_argument('--epochs', type=int, default=50); ap.add_argument('--imgsz', type=int, default=640)
ap.add_argument('--batch', type=int, default=16); ap.add_argument('--device', default=None, help='0 for GPU, cpu for CPU')
ap.add_argument('--project', default='runs'); ap.add_argument('--name', default='fire_smoke')
ap.add_argument('--patience', type=int, default=15, help='stop early if val mAP does not improve for this many epochs')
a = ap.parse_args()

model = YOLO(a.model)
model.train(data=a.data, epochs=a.epochs, imgsz=a.imgsz, batch=a.batch, device=a.device,
            project=a.project, name=a.name, patience=a.patience, seed=0,
            hsv_h=0.010,          # keep hue changes small: colour is the main cue for fire
            exist_ok=True)
print('best weights:', f'{a.project}/{a.name}/weights/best.pt')