import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'

const SENSOR_CHARTS = [
  { key: 'temperature', label: 'TEMP (°C)',     color: 'var(--c-temp)',  domain: [0, 80]   },
  { key: 'humidity',    label: 'HUMIDITY (%)',  color: 'var(--c-humid)', domain: [0, 100]  },
  { key: 'smoke',       label: 'SMOKE (ADC)',   color: 'var(--c-smoke)', domain: [0, 4095] },
  { key: 'flame',       label: 'FLAME IR (ADC)',color: 'var(--c-flame)', domain: [0, 4095] },
]

const Tip = ({ active, payload }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="chart-tip">
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color }}>
          {p.name}&nbsp;&nbsp;<strong>{Number(p.value).toFixed(3)}</strong>
        </div>
      ))}
    </div>
  )
}

const axisStyle = { fontSize: 9, fill: 'var(--text-dim)', fontFamily: 'Share Tech Mono, monospace' }

export default function LiveCharts({ history = [], mode = 'live' }) {
  if (!history.length) {
    return (
      <div className="card">
        <div className="panel-label">Live Charts</div>
        <p style={{ color: 'var(--text-dim)', fontFamily: 'var(--mono)', fontSize: '0.75rem' }}>
          / WAITING FOR DATA
        </p>
      </div>
    )
  }

  return (
    <div className="charts-section">
      <div className="section-title">/ TELEMETRY · LIVE CHARTS</div>

      {/* sensor readings — 2×2 grid */}
      <div className="charts-grid">
        {SENSOR_CHARTS.map(c => (
          <div className="chart-card" key={c.key}>
            <h4>{c.label}</h4>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={history} margin={{ top: 2, right: 4, bottom: 0, left: -24 }}>
                <XAxis dataKey="t" tick={axisStyle} tickLine={false} axisLine={false} />
                <YAxis domain={c.domain} tick={axisStyle} tickLine={false} axisLine={false} />
                <Tooltip content={<Tip />} />
                <Line
                  type="monotone" dataKey={c.key} stroke={c.color}
                  dot={false} strokeWidth={1.5} name={c.label}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>

      {/* probability overlay chart */}
      <div className="chart-card chart-card-wide">
        <h4>FIRE PROBABILITY — SENSOR · CAMERA · FUSION</h4>
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={history} margin={{ top: 4, right: 16, bottom: 0, left: -24 }}>
            <XAxis dataKey="t" tick={axisStyle} tickLine={false} axisLine={false} />
            <YAxis domain={[0, 1]} tick={axisStyle} tickLine={false} axisLine={false} tickCount={5} />
            <Tooltip content={<Tip />} />
            <Legend
              wrapperStyle={{ fontFamily: 'Share Tech Mono, monospace', fontSize: '0.65rem', paddingTop: 8 }}
              iconType="plainline"
            />

            {/* threshold reference lines */}
            <ReferenceLine y={0.35} stroke="var(--warn)"  strokeDasharray="6 3" strokeOpacity={0.5} />
            <ReferenceLine y={0.60} stroke="var(--alert)" strokeDasharray="6 3" strokeOpacity={0.5} />

            <Line type="monotone" dataKey="sensor_p" stroke="var(--c-sensor)"
                  dot={false} strokeWidth={1.5} name="SENSOR"
                  isAnimationActive={false} />
            {mode === 'live' && (
              <Line type="monotone" dataKey="camera_p" stroke="var(--c-camera)"
                    dot={false} strokeWidth={1.5} name="CAMERA"
                    isAnimationActive={false} />
            )}
            <Line type="monotone" dataKey="fusion_p" stroke="var(--c-fusion)"
                  dot={false} strokeWidth={2} name="FUSION"
                  strokeDasharray="6 2" isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
        <div className="chart-legend-hint">
          <span style={{ color: 'var(--warn)' }}>─ ─  0.35 WARNING</span>
          <span style={{ color: 'var(--alert)' }}>─ ─  0.60 ALERT</span>
        </div>
      </div>
    </div>
  )
}
