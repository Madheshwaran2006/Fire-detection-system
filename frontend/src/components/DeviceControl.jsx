/**
 * DeviceControl.jsx
 *
 * Device control panel for the Smart Fire Detection System.
 * Displays ESP8266 connection status, pump control, and servo control.
 *
 * IMPORTANT — hardware reality:
 *   The current ESP8266 Arduino sketch only exposes GET /data.
 *   Pump is controlled by Blynk virtual pin V10; there is no HTTP pump/servo
 *   endpoint on the device.  The backend tracks requested states and enforces
 *   the hardware safety interlock (pump requires active flame detection).
 *   Controls here reflect the *last confirmed backend state*, not direct
 *   physical device state.
 */

import { useState, useEffect, useRef, useCallback } from 'react'

const API           = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
const POLL_INTERVAL = 2000   // ms between /api/device/data fetches

// ── Helper: format seconds-since-epoch as a relative string ─────────────────
function formatLastSeen(ts) {
  if (!ts || ts === 0) return 'Never'
  const elapsed = Math.round(Date.now() / 1000 - ts)
  if (elapsed <   5) return 'Just now'
  if (elapsed <  60) return `${elapsed}s ago`
  if (elapsed < 120) return '1 min ago'
  return `${Math.floor(elapsed / 60)} min ago`
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ConnectionStatus({ device, lastSeen }) {
  const online    = device?.sensor_ready ?? false
  const ip        = device?.esp_ip       || '—'
  const dotStyle  = { background: online ? 'var(--safe)' : 'var(--text-dim)' }

  return (
    <div className="dc-section">
      <div className="dc-section-title">ESP8266 Connection</div>
      <div className="dc-row">
        <span className="dc-dot" style={dotStyle} />
        <span className="dc-status-text" style={{ color: online ? 'var(--safe)' : 'var(--text-mid)' }}>
          {online ? 'Online' : 'Offline / Warming up'}
        </span>
      </div>
      <div className="dc-meta-row">
        <span className="dc-meta-label">IP</span>
        <code className="dc-meta-value">{ip}</code>
      </div>
      <div className="dc-meta-row">
        <span className="dc-meta-label">Last update</span>
        <span className="dc-meta-value">{lastSeen}</span>
      </div>
      {device?.buf_len !== undefined && (
        <div className="dc-meta-row">
          <span className="dc-meta-label">Buffer</span>
          <span className="dc-meta-value">{device.buf_len} / 30 readings</span>
        </div>
      )}
    </div>
  )
}

function PumpControl({ device, onAction }) {
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')

  const pumpOn       = device?.pump_on        ?? false
  const flameActive  = device?.flame_detected ?? false

  async function sendPump(on) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/device/pump`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ on }),
      })
      const d = await res.json()
      if (!res.ok) {
        setError(d?.error || d?.detail || `Error ${res.status}`)
      } else {
        await onAction()   // refresh device data
      }
    } catch (e) {
      setError(`Network error: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dc-section">
      <div className="dc-section-title">Pump Control</div>

      <div className="dc-indicator-row">
        <div className={`dc-indicator ${pumpOn ? 'dc-indicator-on' : 'dc-indicator-off'}`}>
          <span className="dc-indicator-dot" />
          <span className="dc-indicator-label">{pumpOn ? 'PUMP ON' : 'PUMP OFF'}</span>
        </div>
        {flameActive && (
          <span className="dc-badge dc-badge-alert">Flame detected</span>
        )}
      </div>

      <div className="dc-btn-row">
        <button
          className="btn btn-primary dc-btn"
          disabled={busy || pumpOn || !flameActive}
          onClick={() => sendPump(true)}
          title={!flameActive ? 'No flame detected — hardware interlock prevents pump activation' : ''}
        >
          {busy && !pumpOn ? 'Starting…' : 'Start Pump'}
        </button>
        <button
          className="btn btn-danger dc-btn"
          disabled={busy || !pumpOn}
          onClick={() => sendPump(false)}
        >
          {busy && pumpOn ? 'Stopping…' : 'Stop Pump'}
        </button>
      </div>

      {!flameActive && !pumpOn && (
        <p className="dc-hint">
          Pump activation requires an active flame signal (ADC ≤ 2000) from the sensor.
          This matches the ESP8266 hardware interlock.
        </p>
      )}

      {error && <div className="dc-error">{error}</div>}

      <p className="dc-note">
        Physical pump is controlled by the ESP8266 Blynk interlock (V10).
        This panel tracks the requested state.
      </p>
    </div>
  )
}

function ServoControl({ device, onAction }) {
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState('')
  const [sliderAngle, setSliderAngle] = useState(device?.servo_angle ?? 90)

  const scanning = device?.servo_scanning ?? true
  const angle    = device?.servo_angle    ?? 90

  // Reset slider to confirmed angle whenever scanning stops
  const prevScanRef = useRef(scanning)
  if (prevScanRef.current !== scanning) {
    prevScanRef.current = scanning
    if (!scanning) setSliderAngle(angle)
  }

  async function sendScan(enabled) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/device/servo/scan`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ enabled }),
      })
      const d = await res.json()
      if (!res.ok) {
        setError(d?.error || d?.detail || `Error ${res.status}`)
      } else {
        await onAction()
      }
    } catch (e) {
      setError(`Network error: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  async function sendAngle() {
    if (scanning) {
      setError('Stop scanning before setting a manual angle.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${API}/api/device/servo/angle`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ angle: sliderAngle }),
      })
      const d = await res.json()
      if (!res.ok) {
        setError(d?.error || d?.detail || `Error ${res.status}`)
      } else {
        await onAction()
      }
    } catch (e) {
      setError(`Network error: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dc-section">
      <div className="dc-section-title">Servo Control</div>

      <div className="dc-indicator-row">
        <div className={`dc-indicator ${scanning ? 'dc-indicator-scan' : 'dc-indicator-off'}`}>
          <span className="dc-indicator-dot" />
          <span className="dc-indicator-label">{scanning ? 'SCANNING' : 'MANUAL'}</span>
        </div>
        <span className="dc-angle-display">{angle}°</span>
      </div>

      <div className="dc-btn-row">
        <button
          className="btn btn-primary dc-btn"
          disabled={busy || scanning}
          onClick={() => sendScan(true)}
        >
          Start Scanning
        </button>
        <button
          className="btn btn-secondary dc-btn"
          disabled={busy || !scanning}
          onClick={() => sendScan(false)}
        >
          Stop Scanning
        </button>
      </div>

      <div className="dc-slider-row">
        <label className="dc-slider-label" htmlFor="servo-angle-slider">
          Manual Angle: <strong>{sliderAngle}°</strong>
        </label>
        <input
          id="servo-angle-slider"
          type="range"
          min={10}
          max={170}
          step={1}
          value={sliderAngle}
          onChange={e => setSliderAngle(Number(e.target.value))}
          disabled={scanning || busy}
          className="dc-slider"
        />
        <button
          className="btn btn-secondary dc-btn"
          disabled={scanning || busy}
          onClick={sendAngle}
        >
          {busy ? 'Moving…' : 'Move Servo'}
        </button>
      </div>

      {scanning && (
        <p className="dc-hint">Stop scanning to set a manual angle.</p>
      )}

      {error && <div className="dc-error">{error}</div>}

      <p className="dc-note">
        Servo angle is tracked by the backend. Physical servo is controlled by
        the ESP8266 (add /servo endpoints to the Arduino sketch for HTTP control).
      </p>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DeviceControl({ espIp: _espIp }) {
  const [device,   setDevice]   = useState(null)
  const [fetchErr, setFetchErr] = useState('')
  const [lastSeen, setLastSeen] = useState('Never')
  const pollRef    = useRef(null)
  const inFlight   = useRef(false)

  const fetchDevice = useCallback(async () => {
    if (inFlight.current) return   // skip if previous request still running
    inFlight.current = true
    try {
      const res = await fetch(`${API}/api/device/data`)
      if (!res.ok) {
        setFetchErr(`Device data error: HTTP ${res.status}`)
        return
      }
      const d = await res.json()
      setDevice(d)
      setFetchErr('')
      if (d.last_update_ts) {
        setLastSeen(formatLastSeen(d.last_update_ts))
      }
    } catch (e) {
      setFetchErr(`Cannot reach backend (${e.message})`)
    } finally {
      inFlight.current = false
    }
  }, [])

  // Update "last seen" label every second without re-polling the backend
  useEffect(() => {
    const id = setInterval(() => {
      if (device?.last_update_ts) {
        setLastSeen(formatLastSeen(device.last_update_ts))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [device?.last_update_ts])

  // Poll /api/device/data every 2 s — fetchDevice is a data-fetch, setState is expected
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => {
    fetchDevice()
    pollRef.current = setInterval(fetchDevice, POLL_INTERVAL)
    return () => clearInterval(pollRef.current)
  }, [fetchDevice])

  return (
    <div className="card device-control-card">
      <div className="panel-label">Device Control · ESP8266</div>

      {fetchErr && (
        <div className="dc-error dc-error-top" role="alert">{fetchErr}</div>
      )}

      <div className="dc-grid">
        <ConnectionStatus device={device} lastSeen={lastSeen} />
        <PumpControl      device={device} onAction={fetchDevice} />
        <ServoControl     device={device} onAction={fetchDevice} />
      </div>
    </div>
  )
}
