const LEVEL = {
  SAFE:    { cls: 'safe',    label: 'Safe'    },
  WARNING: { cls: 'warning', label: 'Warning' },
  ALERT:   { cls: 'fire',    label: 'Alert'   },
}

export default function EventLog({ logs = [] }) {
  return (
    <div className="card">
      <div className="panel-label">
        Event Log
        {logs.length > 0 && <span className="log-count">{logs.length} events</span>}
      </div>

      {!logs.length ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
          No state changes yet. Events are recorded each time the fusion level changes.
        </p>
      ) : (
        <div className="log-scroll">
          <table className="log-table">
            <thead>
              <tr>
                <th>Time (s)</th>
                <th>Status</th>
                <th>P Fused</th>
                <th>P Sensor</th>
                <th>P Camera</th>
                <th>Temp</th>
                <th>Humidity</th>
                <th>Smoke</th>
                <th>Flame</th>
                <th>Scenario</th>
              </tr>
            </thead>
            <tbody>
              {[...logs].reverse().map((r, i) => {
                const { cls, label } = LEVEL[r.level] ?? LEVEL.SAFE
                return (
                  <tr key={i} className={`log-row-${cls}`}>
                    <td>{r.t}</td>
                    <td><span className={`badge badge-${cls}`}>{label}</span></td>
                    <td>
                      <strong style={{ color: cls === 'fire' ? 'var(--danger)' : cls === 'warning' ? 'var(--warn)' : 'var(--safe)' }}>
                        {(r.fusion_p * 100).toFixed(1)}%
                      </strong>
                    </td>
                    <td style={{ color: 'var(--c-sensor)' }}>{(r.sensor_p * 100).toFixed(1)}%</td>
                    <td style={{ color: 'var(--c-camera)' }}>{(r.camera_p * 100).toFixed(1)}%</td>
                    <td>{r.temperature?.toFixed(1)}</td>
                    <td>{r.humidity?.toFixed(1)}</td>
                    <td style={{ color: r.smoke >= 2500 ? 'var(--danger)' : 'var(--safe)', fontWeight: 600 }}>
                      {r.smoke != null ? (r.smoke >= 2500 ? 'DETECTED' : 'CLEAR') : '—'}
                    </td>
                    <td style={{ color: r.flame <= 2000 ? 'var(--danger)' : 'var(--safe)', fontWeight: 600 }}>
                      {r.flame != null ? (r.flame <= 2000 ? 'DETECTED' : 'CLEAR') : '—'}
                    </td>
                    <td style={{ color: 'var(--text-dim)' }}>{r.scenario || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
