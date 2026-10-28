
/**
 * SensorGauges.jsx
 *
 * Displays temperature, humidity, smoke and flame sensor values.
 * Does not assume that a raw flame value of 0 means fire.
 * Uses an explicit fire status when one is supplied.
 */

const ANALOG_SENSORS = [
  {
    key: 'temperature',
    label: 'TEMP',
    unit: '°C',
    color: 'var(--c-temp)',
    cls: 'c-temp',
    min: 15,
    max: 80,
    decimals: 1,
    warnFn: v => v >= 34,
  },
  {
    key: 'humidity',
    label: 'HUMIDITY',
    unit: '%',
    color: 'var(--c-humid)',
    cls: 'c-humid',
    min: 0,
    max: 100,
    decimals: 1,
    warnFn: () => false,
  },
  {
    key: 'smoke',
    label: 'SMOKE',
    unit: 'ADC',
    color: 'var(--c-smoke)',
    cls: 'c-smoke',
    min: 0,
    max: 4095,
    decimals: 0,
    warnFn: v => v >= 2500,
  },
]

function AnalogGauge({ sensor, value }) {
  const val =
    typeof value === 'number' && Number.isFinite(value)
      ? value
      : null

  const pct =
    val !== null
      ? Math.min(
          100,
          Math.max(
            0,
            ((val - sensor.min) / (sensor.max - sensor.min)) * 100
          )
        )
      : 0

  const warn = val !== null && sensor.warnFn(val)
  const color = warn ? 'var(--warn)' : sensor.color

  return (
    <div className={`gauge-card ${sensor.cls}`}>
      <div className="gauge-label">{sensor.label}</div>

      <div className="gauge-value" style={{ color }}>
        {val !== null ? val.toFixed(sensor.decimals) : '—'}
      </div>

      <div className="gauge-unit">{sensor.unit}</div>

      <div className="gauge-bar-wrap">
        <div
          className="gauge-bar"
          style={{
            width: `${pct}%`,
            background: color,
          }}
        />
      </div>
    </div>
  )
}

// The raw sensor reading is not enough to determine fire reliably.
// Prefer an explicit status supplied by the backend.
function FlameGauge({ rawVal, fireDetected }) {
  const val =
    typeof rawVal === 'number' && Number.isFinite(rawVal)
      ? rawVal
      : null

  const hasFireStatus = typeof fireDetected === 'boolean'

  const statusText = !hasFireStatus
    ? 'STATUS PENDING'
    : fireDetected
      ? 'FIRE DETECTED'
      : 'NO FIRE'

  const statusColor = !hasFireStatus
    ? 'var(--text-dim)'
    : fireDetected
      ? 'var(--danger)'
      : 'var(--safe)'

  return (
    <div className="gauge-card c-flame">
      <div className="gauge-label">FLAME IR</div>

      <div
        className="gauge-value"
        style={{
          color: statusColor,
          fontSize: '1.05rem',
          fontWeight: 700,
          letterSpacing: '0.02em',
        }}
      >
        {statusText}
      </div>

      <div
        className="gauge-unit"
        style={{
          color: 'var(--text-dim)',
          fontSize: '0.62rem',
        }}
      >
        {val !== null ? `Reading: ${val}` : 'Waiting for data'}
      </div>

      <div className="gauge-bar-wrap">
        <div
          className="gauge-bar"
          style={{
            width: fireDetected === true ? '100%' : '0%',
            background: statusColor,
            transition: 'width 0.4s ease, background 0.4s',
          }}
        />
      </div>
    </div>
  )
}

export default function SensorGauges({ data }) {
  // Only trust an explicit boolean fire status.
  // Do not infer fire from flame === 0.
  const fireDetected =
    typeof data?.fireDetected === 'boolean'
      ? data.fireDetected
      : typeof data?.fire_detected === 'boolean'
        ? data.fire_detected
        : typeof data?.risk === 'string'
          ? ['ALERT', 'FIRE', 'FIRE DETECTED'].includes(
              data.risk.toUpperCase()
            )
          : undefined

  return (
    <div className="gauges">
      {ANALOG_SENSORS.map(sensor => (
        <AnalogGauge
          key={sensor.key}
          sensor={sensor}
          value={data?.[sensor.key] ?? null}
        />
      ))}

      <FlameGauge
        rawVal={data?.flame ?? null}
        fireDetected={fireDetected}
      />
    </div>
  )
}
