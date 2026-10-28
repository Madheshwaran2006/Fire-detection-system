import { useState } from 'react'
import StreamDashboard from './StreamDashboard'

const API = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

// Simple IPv4 / hostname validator
function isValidIP(val) {
  const s = val.trim()
  if (!s) return false
  if (s.includes('://') || s.includes('/')) return false
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(s)
  if (ipv4) return s.split('.').every(n => Number(n) >= 0 && Number(n) <= 255)
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})*$/.test(s)
}

export default function LiveMode() {
  const [mode,      setMode]      = useState('wifi')
  const [espIp,     setEspIp]     = useState('10.202.9.205')
  const [port,      setPort]      = useState('COM3')
  const [baud,      setBaud]      = useState(115200)
  const [cam,       setCam]       = useState(0)
  const [every,     setEvery]     = useState(2)
  const [useCamera, setUseCamera] = useState(true)   // ← camera toggle
  const [running,   setRunning]   = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState('')
  const [connStr,   setConnStr]   = useState('')

  async function start() {
    setError('')

    if (mode === 'wifi' && !isValidIP(espIp)) {
      setError('Please enter a valid ESP8266 IP address (e.g. 10.202.9.205)')
      return
    }
    if (mode === 'serial' && !port.trim()) {
      setError('Please enter a serial port (e.g. COM3 or /dev/ttyUSB0)')
      return
    }

    setLoading(true)
    try {
      const body = mode === 'wifi'
        ? { mode: 'wifi',   esp_ip: espIp.trim(), cam: Number(cam), every: Number(every), use_camera: useCamera }
        : { mode: 'serial', port: port.trim(), baud: Number(baud), cam: Number(cam), every: Number(every), use_camera: useCamera }

      const res = await fetch(`${API}/live/start`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })

      let d
      try { d = await res.json() } catch { d = {} }

      if (!res.ok) {
        const msg = d?.detail || d?.error || `HTTP ${res.status}`
        setError(`Start failed: ${msg}`)
        return
      }

      setRunning(true)
      setConnStr(
        mode === 'wifi'
          ? `WiFi · ${espIp.trim()} · ${useCamera ? `CAM:${cam}` : 'No Camera'}`
          : `${port.trim()} @ ${baud} · ${useCamera ? `CAM:${cam}` : 'No Camera'}`
      )
    } catch (e) {
      setError(`Cannot reach backend — is api.py running? (${e.message})`)
    } finally {
      setLoading(false)
    }
  }

  async function stop() {
    setLoading(true)
    try {
      await fetch(`${API}/live/stop`, { method: 'POST' })
    } catch { /* ignore */ } finally {
      setLoading(false)
      setRunning(false)
      setConnStr('')
    }
  }

  return (
    <div className="live-mode">
      <div className="config-bar">
        <span className="config-title">ESP8266 + Camera Config</span>

        {/* Connection mode */}
        <div className="config-field">
          <label>Connection</label>
          <select value={mode} onChange={e => setMode(e.target.value)} disabled={running || loading}>
            <option value="wifi">WiFi (HTTP)</option>
            <option value="serial">Serial (USB)</option>
          </select>
        </div>

        {/* WiFi fields */}
        {mode === 'wifi' && (
          <div className="config-field">
            <label>ESP8266 IP</label>
            <input
              value={espIp}
              onChange={e => setEspIp(e.target.value)}
              disabled={running || loading}
              placeholder="10.202.9.205"
              style={{ width: '148px' }}
            />
          </div>
        )}

        {/* Serial fields */}
        {mode === 'serial' && (
          <>
            <div className="config-field">
              <label>Serial Port</label>
              <input
                value={port}
                onChange={e => setPort(e.target.value)}
                disabled={running || loading}
                placeholder="COM3"
              />
            </div>
            <div className="config-field">
              <label>Baud Rate</label>
              <select value={baud} onChange={e => setBaud(Number(e.target.value))} disabled={running || loading}>
                <option value={9600}>9600</option>
                <option value={115200}>115200</option>
              </select>
            </div>
          </>
        )}

        {/* Camera toggle */}
        <div className="config-field">
          <label>Camera</label>
          <button
            className={`btn camera-toggle-btn ${useCamera ? 'camera-toggle-on' : 'camera-toggle-off'}`}
            onClick={() => setUseCamera(v => !v)}
            disabled={running || loading}
            title={useCamera ? 'Click to disable camera' : 'Click to enable camera'}
          >
            <span className={`camera-toggle-dot ${useCamera ? 'camera-dot-on' : 'camera-dot-off'}`} />
            {useCamera ? 'ON' : 'OFF'}
          </button>
        </div>

        {/* Camera index — only shown when camera is enabled */}
        {useCamera && (
          <div className="config-field">
            <label>Cam Index</label>
            <input
              type="number" min={0} max={9} value={cam}
              onChange={e => setCam(Number(e.target.value))}
              disabled={running || loading}
              style={{ width: '64px' }}
            />
          </div>
        )}

        {useCamera && (
          <div className="config-field">
            <label>Every N Frames</label>
            <input
              type="number" min={1} max={10} value={every}
              onChange={e => setEvery(Number(e.target.value))}
              disabled={running || loading}
              style={{ width: '64px' }}
            />
          </div>
        )}

        {!running
          ? <button className="btn btn-primary" onClick={start} disabled={loading}>
              {loading ? 'Starting…' : 'Start Live'}
            </button>
          : <button className="btn btn-danger" onClick={stop} disabled={loading}>
              {loading ? 'Stopping…' : 'Stop'}
            </button>
        }

        {running && (
          <span className="live-pill">
            <span className="live-dot" /> Live · {connStr}
          </span>
        )}
      </div>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {running ? (
        <StreamDashboard mode="live" espIp={espIp} cameraEnabled={useCamera} />
      ) : (
        <div className="idle-hint card">
          <h2>Ready to connect</h2>
          <p>
            Select <strong>WiFi</strong>, confirm the ESP8266 IP, then press{' '}
            <strong>Start Live</strong>.
          </p>
          <ul>
            <li>WiFi mode polls <code>http://10.202.9.205/data</code> via the FastAPI backend</li>
            <li>Serial mode reads <code>temp,humidity,smoke,flame</code> CSV at 115200 baud</li>
            <li>Toggle <strong>Camera ON/OFF</strong> before starting — OFF skips webcam entirely</li>
            <li>Sensor ML needs 30 readings before predictions begin</li>
            <li>Pump requires an active flame signal from the ESP8266 hardware interlock</li>
          </ul>
        </div>
      )}
    </div>
  )
}
