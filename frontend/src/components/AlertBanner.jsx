export default function AlertBanner({ ready, fire, alert: alertFlag, p_fire, bufLen, W }) {
  if (!ready) {
    return (
      <div className="alert-banner safe">
        <span className="alert-icon">⏳</span>
        <div>
          <div className="alert-title" style={{ color: '#94a3b8' }}>Buffering…</div>
          <div className="alert-sub">Collecting readings — {bufLen ?? 0} / {W ?? 30} seconds</div>
        </div>
      </div>
    )
  }

  if (alertFlag) {
    return (
      <div className="alert-banner fire">
        <span className="alert-icon">🔥</span>
        <div>
          <div className="alert-title">FIRE ALERT</div>
          <div className="alert-sub">Persistent fire signal detected — p_fire = {(p_fire * 100).toFixed(1)}%</div>
        </div>
      </div>
    )
  }

  if (fire) {
    return (
      <div className="alert-banner warning">
        <span className="alert-icon">⚠️</span>
        <div>
          <div className="alert-title">WARNING — Fire Likely</div>
          <div className="alert-sub">Single window triggered — p_fire = {(p_fire * 100).toFixed(1)}%</div>
        </div>
      </div>
    )
  }

  return (
    <div className="alert-banner safe">
      <span className="alert-icon">✅</span>
      <div>
        <div className="alert-title">SAFE</div>
        <div className="alert-sub">No fire detected — p_fire = {(p_fire * 100).toFixed(1)}%</div>
      </div>
    </div>
  )
}
