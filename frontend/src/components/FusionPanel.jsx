
const SENSOR_DISPLAY_FACTOR = 0.62

function pColor(p) {
  if (p >= 0.60) return 'var(--danger)'
  if (p >= 0.35) return 'var(--warn)'
  return 'var(--safe)'
}

function Bar({ value = 0, color }) {
  const numericValue = Number(value)

  const safeValue = Number.isFinite(numericValue)
    ? Math.max(0, Math.min(1, numericValue))
    : 0

  return (
    <div className="fp-bar-wrap">
      <div
        className="fp-bar"
        style={{
          width: `${safeValue * 100}%`,
          background: color,
        }}
      />
    </div>
  )
}

function Branch({
  label,
  weight,
  p_fire = 0,
  p_smoke,
  alert: isAlert,
  ready,
  displayFactor = 1,
  displayNote,
}) {
  const rawProbability = Number(p_fire)

  const validProbability =
    Number.isFinite(rawProbability) &&
    rawProbability >= 0 &&
    rawProbability <= 1

  const displayedProbability = validProbability
    ? Math.max(
        0,
        Math.min(1, rawProbability * displayFactor)
      )
    : 0

  const col = pColor(displayedProbability)

  return (
    <div className="fp-branch">
      <div className="fp-branch-header">
        <span className="fp-branch-label">
          {label}
        </span>

        <span className="fp-weight">
          weight {weight}
        </span>

        {isAlert && (
          <span className="fp-alert-dot">
            Alert
          </span>
        )}
      </div>

      <div className="fp-row">
        <span className="fp-metric">
          Fire score
        </span>

        <Bar
          value={displayedProbability}
          color={col}
        />

        <span
          className="fp-val"
          style={{ color: col }}
        >
          {validProbability
            ? `${(displayedProbability * 100).toFixed(1)}%`
            : '--'}
        </span>
      </div>

      {displayNote && (
        <p className="fp-not-ready">
          {displayNote}
        </p>
      )}

      {p_smoke !== undefined && p_smoke !== null && (
        <div className="fp-row">
          <span className="fp-metric">
            Smoke
          </span>

          <Bar
            value={p_smoke}
            color="var(--c-smoke)"
          />

          <span
            className="fp-val"
            style={{ color: 'var(--c-smoke)' }}
          >
            {(Number(p_smoke) * 100).toFixed(1)}%
          </span>
        </div>
      )}

      {!ready && (
        <p className="fp-not-ready">
          Warming up…
        </p>
      )}
    </div>
  )
}

const LEVEL_COLOR = {
  SAFE: 'var(--safe)',
  WARNING: 'var(--warn)',
  ALERT: 'var(--danger)',
  'WARMING UP': 'var(--warn)',
}

export default function FusionPanel({
  sensor = {},
  camera = {},
  fusion = {},
}) {
  const level = fusion.level ?? 'WARMING UP'

  // Keep the original backend probabilities for fusion display.
  const rawSensorProbability = Number(sensor.p_fire ?? 0)
  const cameraProbability = Number(camera.p_fire ?? 0)
  const fusedProbability = Number(fusion.p_combined ?? 0)

  const col = LEVEL_COLOR[level] ?? 'var(--safe)'

  return (
    <div className="card fusion-panel">
      <div className="panel-label">
        ML Fusion Analysis
      </div>

      <div className="fp-branches">
        {/* SENSOR BRANCH */}
        <Branch
          label="Sensor branch"
          weight="0.6"
          p_fire={rawSensorProbability}
          displayFactor={SENSOR_DISPLAY_FACTOR}
          displayNote="Adjusted display score only; raw model probability is unchanged."
          alert={sensor.alert}
          ready={sensor.ready}
        />

        <div className="fp-divider" />

        {/* CAMERA BRANCH — unchanged */}
        <Branch
          label="Camera branch"
          weight="0.4"
          p_fire={cameraProbability}
          p_smoke={camera.p_smoke}
          alert={camera.alert}
          ready={camera.ready}
        />
      </div>

      {/* FUSION RESULT — unchanged backend result */}
      <div className="fp-fusion-result">
        <div className="fp-fusion-bar-row">
          <div
            className="fp-row"
            style={{ marginBottom: 0 }}
          >
            <span className="fp-metric">
              Fused
            </span>

            <Bar
              value={fusedProbability}
              color={col}
            />

            <span
              className="fp-val"
              style={{ color: col }}
            >
              {(fusedProbability * 100).toFixed(1)}%
            </span>
          </div>

          <div className="fp-formula">
            0.6 × raw sensor probability + 0.4 × camera probability
          </div>
        </div>

        <span
          className="fp-fusion-level"
          style={{ color: col }}
        >
          {level}
        </span>
      </div>
    </div>
  )
}
