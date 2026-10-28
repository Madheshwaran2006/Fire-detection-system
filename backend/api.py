"""
Smart Fire Detection System - FastAPI backend
- Reads ESP8266 sensor data over Wi-Fi (/data) or optional serial CSV
- Runs the three-input Random Forest model on each incoming sensor reading
- Runs camera fire analysis (YOLO if available, otherwise a simple color heuristic)
- Combines sensor and camera probabilities
- Exposes SSE/dashboard endpoints and ESP8266 pump/servo controls

Run from the directory containing this file:
    python -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload

Important:
- Set ESP8266_IP below to the IP printed in Arduino Serial Monitor, or enter it
  in the Live Mode screen when starting Wi-Fi mode.
- MODEL_PATH below points to the latest tuned candidate in
  F:\\ML\\evaluation_below_90_v2. If that folder contains multiple model files,
  the newest .joblib/.pkl file is selected; set MODEL_PATH to the exact file
  if you want to avoid automatic selection.
- The model predicts the dataset's recorded flame-sensor state from MQ-2 smoke,
  temperature, and humidity; it is not independently validated fire detection.
"""

import asyncio
import base64
import json
import os
import pathlib
import threading
import time
from collections import deque
from typing import Optional

import cv2
import joblib
import numpy as np
import pandas as pd
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

# Optional serial support
try:
    import serial
    SERIAL_OK = True
except ImportError:
    serial = None
    SERIAL_OK = False

# -------------------- Configuration --------------------
MODEL_PATH = pathlib.Path(__file__).parent.parent / "models" / "efireguard_rf_moderate.joblib"
ESP8266_IP = "10.202.9.205"  # Change to the IP printed by your Arduino Serial Monitor.
ESP8266_BASE_URL = f"http://{ESP8266_IP}"

WINDOW = 30
MAX_SSE_INTERVAL = 0.5
# Classification cutoff for the sensor model's class-1 probability.
# Default 0.50 is a baseline, NOT a validated safety threshold.
# Override from the environment after evaluating on validation data:
# PowerShell: $env:SENSOR_THRESHOLD = "0.45"
SENSOR_THRESHOLD = float(os.getenv("SENSOR_THRESHOLD", "0.50"))
if not 0.0 <= SENSOR_THRESHOLD <= 1.0:
    raise ValueError("SENSOR_THRESHOLD must be between 0.0 and 1.0")

COLS = ["temperature", "humidity", "smoke", "flame"]

# -------------------- Load trained three-sensor model --------------------
if not MODEL_PATH.exists():
    raise FileNotFoundError(
        f"Trained model not found: {MODEL_PATH}\n"
        "Copy efireguard_rf_moderate.joblib into F:\\ML\\models\\, "
        "or update MODEL_PATH to the correct location."
    )

sensor_bundle = joblib.load(MODEL_PATH)
sensor_model = sensor_bundle["model"]
MODEL_FEATURES = sensor_bundle.get(
    "features", ["mq2_smoke", "temperature", "humidity"]
)
EXPECTED_FEATURES = ["mq2_smoke", "temperature", "humidity"]
if MODEL_FEATURES != EXPECTED_FEATURES:
    raise ValueError(
        f"Unexpected model features {MODEL_FEATURES}; expected {EXPECTED_FEATURES}."
    )

# -------------------- Shared live state --------------------
live_buf: deque = deque(maxlen=WINDOW)
# Initialize with a valid structure so /stream never sends bare {}
latest_result = {
    "time_s": 0,
    "sensor": {
        "temperature": 0, "humidity": 0, "smoke": 0, "flame": 0,
        "p_fire": 0, "predicted_target": None, "buf_len": 0, "ready": False,
    },
    "camera": {"p_fire": 0, "ready": False},
    "fusion": {"p_combined": 0, "level": "WARMING UP"},
    "boxes": [],
}
camera_frame = ""
camera_boxes = []

_live_running = False
_sensor_thread: Optional[threading.Thread] = None
_camera_thread: Optional[threading.Thread] = None
_cap: Optional[cv2.VideoCapture] = None

start_time = time.time()
current_esp_ip = ESP8266_IP
state_lock = threading.Lock()

# -------------------- Three-sensor model prediction --------------------
def predict_sensor(buf):
    """Predict the dataset's recorded flame state from the latest sensor row.

    The trained model uses MQ-2 smoke, temperature, and humidity. The live
    flame-sensor value is intentionally NOT passed to the model because the
    training target was derived from the flame-sensor state.
    """
    if not buf:
        return None, False, None

    row = buf[-1]
    try:
        sensor_input = pd.DataFrame([{
            "mq2_smoke": float(row["smoke"]),
            "temperature": float(row["temperature"]),
            "humidity": float(row["humidity"]),
        }], columns=MODEL_FEATURES)

        probabilities = sensor_model.predict_proba(sensor_input)[0]
        classes = list(sensor_model.classes_)
        if 1 not in classes:
            probability = 0.0
        else:
            probability = float(probabilities[classes.index(1)])

        # Apply the tuned decision threshold rather than the default 0.50.
        predicted_target = int(probability >= SENSOR_THRESHOLD)
        return probability, True, predicted_target
    except Exception as exc:
        print(f"[ML] Could not predict from sensor reading: {type(exc).__name__}: {exc}")
        return None, False, None


# -------------------- Camera integration --------------------
try:
    from ultralytics import YOLO

    YOLO_PATH = pathlib.Path(__file__).parent.parent / "camera" / "weights" / "best.pt"
    yolo_model = YOLO(str(YOLO_PATH)) if YOLO_PATH.exists() else None
except Exception:
    yolo_model = None


def analyse_frame(frame):
    """Return (fire_probability, bounding_boxes)."""
    if yolo_model is not None:
        results = yolo_model(frame, verbose=False)
        boxes = []
        max_confidence = 0.0

        for result in results:
            for box in result.boxes:
                confidence = float(box.conf[0])
                class_id = int(box.cls[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                boxes.append({
                    "x1": x1, "y1": y1, "x2": x2, "y2": y2,
                    "conf": confidence, "cls": class_id,
                })
                max_confidence = max(max_confidence, confidence)

        return max_confidence, boxes

    # Fallback heuristic; this is not a reliable fire detector.
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (0, 100, 100), (35, 255, 255))
    ratio = float(mask.sum()) / (mask.shape[0] * mask.shape[1] * 255)
    return min(1.0, ratio * 20), []


def frame_to_b64(frame):
    ok, encoded = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
    if not ok:
        return ""
    return base64.b64encode(encoded).decode("ascii")


# -------------------- Sensor/camera fusion --------------------
def fuse(p_sensor, p_camera):
    probability = 0.6 * p_sensor + 0.4 * p_camera
    if probability >= 0.75:
        return "ALERT", probability
    if probability >= 0.45:
        return "WARNING", probability
    return "SAFE", probability


def _update_result(row):
    global latest_result

    with state_lock:
        buffer_snapshot = list(live_buf)
        camera_data = latest_result.get("camera", {"p_fire": 0.0, "ready": False})
        boxes_snapshot = list(camera_boxes)

    p_sensor, ready, predicted_target = predict_sensor(buffer_snapshot)
    p_camera = float(camera_data.get("p_fire", 0.0))

    if ready:
        level, combined_probability = fuse(p_sensor, p_camera)
    else:
        level, combined_probability = "WARMING UP", 0.0

    result = {
        "time_s": round(time.time() - start_time, 1),
        "sensor": {
            "temperature": row["temperature"],
            "humidity": row["humidity"],
            "smoke": row["smoke"],
            "flame": row["flame"],
            "p_fire": round(p_sensor, 4) if ready else 0.0,
            "predicted_target": predicted_target if ready else None,
            "classification_threshold": SENSOR_THRESHOLD,
            "buf_len": len(buffer_snapshot),
            "ready": ready,
        },
        "camera": camera_data,
        "fusion": {
            "p_combined": round(combined_probability, 4),
            "level": level,
        },
        "boxes": boxes_snapshot,
    }

    with state_lock:
        latest_result = result


# -------------------- Sensor reader threads --------------------
def _wifi_reader(esp_ip: str):
    global _live_running, _last_sensor_ts

    url = f"http://{esp_ip}/data"
    print(f"[Wi-Fi] Polling ESP8266: {url}")

    while _live_running:
        try:
            response = requests.get(url, timeout=3)
            response.raise_for_status()
            data = response.json()

            # Map the ESP8266's actual JSON keys.
            row = {
                "temperature": float(data.get("temperature", data.get("temp", 0))),
                "humidity": float(data.get("humidity", 0)),
                # Prefer the analog MQ-2 value, falling back to digital smoke
                # only if the device does not expose mq2Analog.
                "smoke": float(data.get("mq2Analog", data.get("smoke", 0))),
                # Preserve the digital flame state for display/interlocks.
                "flame": float(data.get("flame", 0)),
            }

            with state_lock:
                live_buf.append(row)

            _update_result(row)
            _last_sensor_ts = time.time()

            print(
                f"[Wi-Fi] T={row['temperature']} C, "
                f"H={row['humidity']}%, "
                f"MQ2={row['smoke']}, "
                f"flame={row['flame']}, "
                f"buffer={len(live_buf)}/{WINDOW}"
            )

        except Exception as exc:
            print(f"[Wi-Fi] Sensor read error: {exc}")

        time.sleep(1)

def _serial_reader(port: str, baud: int):
    global _live_running

    if not SERIAL_OK:
        print("[Serial] pyserial is not installed. Run: pip install pyserial")
        return

    try:
        serial_port = serial.Serial(port, baud, timeout=2)
        print(f"[Serial] Opened {port} @ {baud}")
    except Exception as exc:
        print(f"[Serial] Cannot open {port}: {exc}")
        return

    try:
        while _live_running:
            try:
                line = serial_port.readline().decode(errors="ignore").strip()
                parts = line.split(",")
                if len(parts) < 4:
                    continue

                row = {
                    "temperature": float(parts[0]),
                    "humidity": float(parts[1]),
                    "smoke": float(parts[2]),
                    "flame": float(parts[3]),
                }
                with state_lock:
                    live_buf.append(row)
                _update_result(row)

            except (ValueError, Exception) as exc:
                print(f"[Serial] Parse/read error: {exc}")
    finally:
        serial_port.close()


def _camera_reader(cam_idx: int, every: int):
    global _cap, camera_frame, camera_boxes, latest_result, _live_running

    cap = cv2.VideoCapture(cam_idx)
    _cap = cap
    if not cap.isOpened():
        print(f"[Camera] Could not open camera index {cam_idx}")
        with state_lock:
            latest_result = {
                **latest_result,
                "camera": {"p_fire": 0.0, "ready": False},
            }
        return

    frame_count = 0
    try:
        while _live_running:
            ok, frame = cap.read()
            if not ok:
                time.sleep(0.05)
                continue

            frame_count += 1
            if frame_count % max(1, every) == 0:
                try:
                    p_camera, boxes = analyse_frame(frame)
                    encoded_frame = frame_to_b64(frame)
                    camera_data = {"p_fire": round(float(p_camera), 4), "ready": True}

                    with state_lock:
                        camera_boxes = boxes
                        camera_frame = encoded_frame
                        latest_result = {
                            **latest_result,
                            "camera": camera_data,
                            "boxes": boxes,
                        }

                    # Refresh fusion with the most recent sensor row if available.
                    with state_lock:
                        last_row = live_buf[-1] if live_buf else None
                    if last_row is not None:
                        _update_result(last_row)

                except Exception as exc:
                    print(f"[Camera] Analysis error: {exc}")

            time.sleep(0.03)
    finally:
        cap.release()
        _cap = None


# -------------------- FastAPI application --------------------
app = FastAPI(title="Smart Fire Detection API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restrict this to your frontend origin for deployment.
    allow_methods=["*"],
    allow_headers=["*"],
)


class StartRequest(BaseModel):
    mode: str = "wifi"          # "wifi" or "serial"
    esp_ip: str = ESP8266_IP
    port: str = "COM3"
    baud: int = 115200
    cam: int = 0
    every: int = 2
    use_camera: bool = True     # set False to skip camera thread entirely


@app.post("/live/start")
def live_start(req: StartRequest):
    global _live_running, _sensor_thread, _camera_thread, start_time, current_esp_ip, _last_sensor_ts

    if req.mode not in ("wifi", "serial"):
        raise HTTPException(status_code=400, detail="mode must be 'wifi' or 'serial'")

    if _live_running:
        return {"status": "already running"}

    if req.mode == "wifi":
        current_esp_ip = req.esp_ip.strip()
        if not current_esp_ip:
            raise HTTPException(status_code=400, detail="ESP8266 IP is required")

    _live_running = True
    start_time = time.time()
    _last_sensor_ts = 0.0

    with state_lock:
        live_buf.clear()
        latest_result.clear()
        latest_result.update({
            "time_s": 0,
            "sensor": {
                "temperature": 0, "humidity": 0, "smoke": 0, "flame": 0,
                "p_fire": 0, "predicted_target": None, "buf_len": 0, "ready": False,
            },
            "camera": {"p_fire": 0, "ready": False},
            "fusion": {"p_combined": 0, "level": "WARMING UP"},
            "boxes": [],
        })
        camera_boxes.clear()

    sensor_target = (
        _wifi_reader if req.mode == "wifi" else _serial_reader
    )
    sensor_args = (
        (current_esp_ip,) if req.mode == "wifi" else (req.port, req.baud)
    )

    _sensor_thread = threading.Thread(
        target=sensor_target, args=sensor_args, daemon=True
    )
    _sensor_thread.start()

    if req.use_camera:
        _camera_thread = threading.Thread(
            target=_camera_reader, args=(req.cam, max(1, req.every)), daemon=True
        )
        _camera_thread.start()
    else:
        # Ensure camera state is cleared so SSE shows camera as not ready
        with state_lock:
            latest_result["camera"] = {"p_fire": 0.0, "ready": False}

    return {"status": "live started", "mode": req.mode, "esp_ip": current_esp_ip, "camera": req.use_camera}


@app.post("/live/stop")
def live_stop():
    global _live_running
    _live_running = False
    return {"status": "stopped"}


@app.get("/stream")
def stream():
    """Server-Sent Events stream used by StreamDashboard.jsx."""
    def generate():
        while True:
            with state_lock:
                data = json.dumps(latest_result)
            yield f"data: {data}\n\n"
            time.sleep(MAX_SSE_INTERVAL)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/camera/frame")
def get_camera_frame():
    with state_lock:
        frame = camera_frame
    return JSONResponse({"frame": frame})


@app.get("/health")
def health():
    return {
        "status": "ok",
        "live_running": _live_running,
        "serial_available": SERIAL_OK,
        "yolo_available": yolo_model is not None,
        "sensor_threshold": SENSOR_THRESHOLD,
    }


@app.get("/debug")
def debug():
    """Live diagnostic — call this from browser to see exactly what is happening."""
    # Try a direct HTTP fetch from the backend to the ESP8266 right now
    esp_reachable = False
    esp_data = None
    esp_error = None
    try:
        r = requests.get(f"http://{current_esp_ip}/data", timeout=3)
        esp_reachable = r.ok
        esp_data = r.json() if r.ok else r.text
    except Exception as e:
        esp_error = str(e)

    with state_lock:
        buf_len    = len(live_buf)
        last_entry = list(live_buf)[-1] if live_buf else None
        result_snapshot = dict(latest_result)

    return {
        "model_config": {
            "sensor_threshold": SENSOR_THRESHOLD,
            "model_features": MODEL_FEATURES,
            "note": "Threshold affects sensor predicted_target only; p_fire remains the raw model probability, and fusion uses probabilities.",
        },
        "system": {
            "live_running":    _live_running,
            "esp_ip":          current_esp_ip,
            "buf_len":         buf_len,
            "last_sensor_ts":  round(_last_sensor_ts, 1),
            "seconds_since_last_reading": round(time.time() - _last_sensor_ts, 1) if _last_sensor_ts else None,
        },
        "esp8266_direct_test": {
            "url":        f"http://{current_esp_ip}/data",
            "reachable":  esp_reachable,
            "data":       esp_data,
            "error":      esp_error,
        },
        "last_buffer_entry": last_entry,
        "latest_result":     result_snapshot,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Device state — tracked by the backend
#
# NOTE: The current ESP8266 Arduino sketch only exposes GET /data (read-only).
# Pump control is wired exclusively to Blynk virtual pin V10; there is no HTTP
# pump/servo endpoint on the device.  These routes track the last-requested
# state and apply a safety interlock that mirrors the ESP8266 hardware logic:
# the pump will only be requested ON when the sensor reports a flame.
# ─────────────────────────────────────────────────────────────────────────────
_device_pump_on       : bool  = False
_device_servo_scanning: bool  = False  # start in manual mode; scanning is physical ESP8266 default
_device_servo_angle   : int   = 90
_last_sensor_ts       : float = 0.0    # epoch of last successful /data poll


def _get_flame_detected() -> bool:
    with state_lock:
        sensor = latest_result.get("sensor", {})
    val = sensor.get("flame", 4095)
    try:
        return float(val) <= 2000
    except (TypeError, ValueError):
        return False


# ── Pydantic models for device endpoints ──────────────────────────────────────
class ESPIPRequest(BaseModel):
    ip: str


class PumpRequest(BaseModel):
    on: bool


class ScanRequest(BaseModel):
    enabled: bool


class AngleRequest(BaseModel):
    angle: int = Field(ge=10, le=170)


# ── Helper kept for potential future use (forward to ESP if it gains endpoints)
def esp_request(path: str, payload=None):
    """Forward a request to the ESP8266.  Currently the device only has GET /data."""
    url = f"http://{current_esp_ip}{path}"
    try:
        if payload is None:
            resp = requests.get(url, timeout=3)
        else:
            resp = requests.post(url, json=payload, timeout=3)
        try:
            data = resp.json()
        except ValueError:
            data = {"message": resp.text}
        if not resp.ok:
            detail = data.get("error", data) if isinstance(data, dict) else data
            raise HTTPException(status_code=resp.status_code, detail=detail)
        return data
    except requests.RequestException as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Cannot reach ESP8266 at {url}: {exc}",
        )


# ── Device endpoints ──────────────────────────────────────────────────────────

@app.post("/api/device/ip")
def set_device_ip(req: ESPIPRequest):
    global current_esp_ip
    candidate = req.ip.strip()
    if not candidate or "/" in candidate or "://" in candidate or " " in candidate:
        raise HTTPException(status_code=400, detail="Provide a plain IP address (e.g. 10.202.9.205)")
    current_esp_ip = candidate
    return {"status": "updated", "esp_ip": current_esp_ip}


@app.get("/api/device/data")
def device_data():
    """
    Return the current device status tracked by the backend.
    Also forwards a live /data read from the ESP8266 for the raw sensor snapshot.
    """
    with state_lock:
        sensor = latest_result.get("sensor", {})

    flame_val = sensor.get("flame", 4095)
    smoke_val = sensor.get("smoke",     0)
    try:
        flame_detected = float(flame_val) <= 2000
    except (TypeError, ValueError):
        flame_detected = False
    try:
        smoke_detected = float(smoke_val) >= 2500
    except (TypeError, ValueError):
        smoke_detected = False

    return {
        "esp_ip":          current_esp_ip,
        "pump_on":         _device_pump_on,
        "servo_scanning":  _device_servo_scanning,
        "servo_angle":     _device_servo_angle,
        "flame_detected":  flame_detected,
        "smoke_detected":  smoke_detected,
        "sensor_ready":    sensor.get("ready", False),
        "last_update_ts":  round(_last_sensor_ts, 1),
        "buf_len":         sensor.get("buf_len", 0),
        "temperature":     sensor.get("temperature"),
        "humidity":        sensor.get("humidity"),
        "smoke":           sensor.get("smoke"),
        "flame":           sensor.get("flame"),
    }


@app.post("/api/device/pump")
def device_pump(req: PumpRequest):
    global _device_pump_on

    if req.on and not _get_flame_detected():
        return JSONResponse(
            status_code=409,
            content={
                "error": (
                    "Pump start rejected: no flame is currently detected by the sensor. "
                    "The ESP8266 hardware interlock requires an active flame signal."
                ),
                "pump_on": False,
            },
        )

    # Try forwarding to ESP8266 first
    try:
        result = esp_request("/pump", {"on": req.on})
        confirmed = result.get("pump_on", req.on)
        _device_pump_on = confirmed
        return {"status": "ok", "pump_on": confirmed, "source": "esp8266"}
    except HTTPException:
        pass  # ESP8266 doesn't have /pump yet — track in backend only

    _device_pump_on = req.on
    return {
        "status":  "ok",
        "pump_on": _device_pump_on,
        "source":  "backend",
        "note": "Add /pump to Arduino sketch for physical pump control.",
    }


@app.post("/api/device/servo/scan")
def device_servo_scan(req: ScanRequest):
    global _device_servo_scanning
    # Try forwarding to ESP8266 first; fall back to backend-only tracking
    try:
        result = esp_request("/servo/scan", {"enabled": req.enabled})
        scanning = result.get("servo_scanning", req.enabled)
        _device_servo_scanning = scanning
        return {"status": "ok", "servo_scanning": scanning, "source": "esp8266"}
    except HTTPException:
        pass  # ESP8266 doesn't have this endpoint yet — track in backend only

    _device_servo_scanning = req.enabled
    return {
        "status":          "ok",
        "servo_scanning":  _device_servo_scanning,
        "source":          "backend",
        "note": "Add /servo/scan to Arduino sketch for physical servo control.",
    }


@app.post("/api/device/servo/angle")
def device_servo_angle(req: AngleRequest):
    global _device_servo_angle
    if _device_servo_scanning:
        return JSONResponse(
            status_code=409,
            content={
                "error": "Stop scanning before setting a manual angle.",
                "servo_scanning": True,
            },
        )
    # Try forwarding to ESP8266 first
    try:
        result = esp_request("/servo/angle", {"angle": req.angle})
        confirmed = result.get("servo_angle", req.angle)
        _device_servo_angle = confirmed
        return {"status": "ok", "servo_angle": confirmed, "source": "esp8266"}
    except HTTPException:
        pass

    _device_servo_angle = req.angle
    return {
        "status":      "ok",
        "servo_angle": _device_servo_angle,
        "source":      "backend",
        "note": "Add /servo/angle to Arduino sketch for physical servo control.",
    }
