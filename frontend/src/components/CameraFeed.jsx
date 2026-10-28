export default function CameraFeed({ frame_b64, boxes = [], cameraReady }) {
  const fireCount  = boxes.filter(b => b.name === 'fire').length
  const smokeCount = boxes.filter(b => b.name === 'smoke').length

  return (
    <div className="camera-feed">
      <div className="camera-header">
        <div className="panel-label" style={{ marginBottom: 0 }}>Camera · YOLO v8</div>
        <div className="camera-badges">
          {fireCount  > 0 && <span className="det-badge det-fire">Fire ×{fireCount}</span>}
          {smokeCount > 0 && <span className="det-badge det-smoke">Smoke ×{smokeCount}</span>}
          {fireCount === 0 && smokeCount === 0 && (
            <span className="det-badge det-clear">Clear</span>
          )}
        </div>
      </div>

      <div className="camera-frame-wrap">
        {frame_b64 ? (
          <img
            src={`data:image/jpeg;base64,${frame_b64}`}
            alt="live camera feed"
            className="camera-img"
          />
        ) : (
          <div className="camera-placeholder">
            <div className="camera-no-signal" />
            <p>
              {cameraReady === false
                ? 'No signal — check camera index'
                : 'Acquiring signal…'}
            </p>
            {cameraReady === false && (
              <p className="camera-sub">Set camera index in the config bar above</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
