const W = 30

function probColor(p) {
  if (p >= 0.7) return '#ef4444'
  if (p >= 0.4) return '#f59e0b'
  return '#22c55e'
}

export default function ProbabilityPanel({ p_fire = 0, ready, bufLen = 0, votes = [] }) {
  const pct   = (p_fire * 100).toFixed(1)
  const color = probColor(p_fire)

  return (
    <div className="card prob-panel">
      <h3>ML Model Analysis</h3>

      {/* p_fire bar */}
      <div className="prob-row">
        <span className="prob-label">Fire probability</span>
        <div className="prob-bar-wrap">
          <div className="prob-bar" style={{ width: `${p_fire * 100}%`, background: color }} />
        </div>
        <span className="prob-val" style={{ color }}>{pct}%</span>
      </div>

      {/* window buffer dots */}
      <div className="prob-row">
        <span className="prob-label">Window buffer</span>
        <div className="buffer-dots">
          {Array.from({ length: W }).map((_, i) => (
            <div key={i} className={`dot ${i < bufLen ? 'filled' : ''}`} />
          ))}
        </div>
        <span className="prob-val" style={{ color: '#64748b' }}>{Math.min(bufLen, W)}/{W}</span>
      </div>

      {/* persistence votes */}
      <div className="prob-row">
        <span className="prob-label">Persistence (10)</span>
        <div className="buffer-dots">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className={`dot ${votes[i] ? 'filled' : ''}`}
                 style={votes[i] ? { background: '#ef4444' } : {}} />
          ))}
        </div>
        <span className="prob-val" style={{ color: '#64748b' }}>{votes.filter(Boolean).length}/10</span>
      </div>

      {!ready && (
        <p style={{ fontSize: '0.78rem', color: '#64748b', marginTop: 8 }}>
          ⏳ Waiting for 30 readings to fill the window…
        </p>
      )}
    </div>
  )
}
