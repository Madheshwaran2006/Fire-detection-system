import { useState, useEffect } from 'react'
import StreamDashboard from './StreamDashboard'

const API = 'http://localhost:8000'

export default function ReplayMode() {
  const [sessions, setSessions] = useState([])
  const [selSid,   setSelSid]   = useState('')
  const [speed,    setSpeed]    = useState(5)
  const [running,  setRunning]  = useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    fetch(`${API}/sessions`)
      .then(r => r.json())
      .then(d => { setSessions(d); setSelSid(String(d[0]?.session_id ?? '')) })
      .catch(() => setError('Cannot load sessions — is api.py running?'))
  }, [])

  async function start() {
    setError('')
    try {
      const res = await fetch(`${API}/replay/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: Number(selSid), speed: Number(speed) }),
      })
      const d = await res.json()
      if (d.status !== 'started') { setError(`API error: ${JSON.stringify(d)}`); return }
      setRunning(true)
    } catch (e) {
      setError(`Cannot reach API — is api.py running? (${e.message})`)
    }
  }

  async function stop() {
    await fetch(`${API}/replay/stop`, { method: 'POST' }).catch(() => {})
    setRunning(false)
  }

  const scenario = sessions.find(s => String(s.session_id) === selSid)?.scenario ?? ''

  return (
    <div className="replay-mode">
      <div className="config-bar">
        <span className="config-title">Replay Session</span>

        <div className="config-field">
          <label>Session</label>
          <select value={selSid} onChange={e => setSelSid(e.target.value)} disabled={running}>
            {sessions.map(s => (
              <option key={s.session_id} value={s.session_id}>
                #{s.session_id} · {s.scenario}
              </option>
            ))}
          </select>
        </div>

        <div className="config-field">
          <label>Speed: {speed}×</label>
          <input type="range" min={1} max={20} value={speed}
                 onChange={e => setSpeed(Number(e.target.value))}
                 disabled={running} className="speed-slider" />
        </div>

        {!running
          ? <button className="btn btn-primary" onClick={start} disabled={!selSid}>Start Replay</button>
          : <button className="btn btn-danger"  onClick={stop}>Stop</button>
        }

        {scenario && <span className="tag">{scenario}</span>}
        {running  && <span className="replay-pill">{speed}x playback</span>}
      </div>

      {error && <div className="error-banner">{error}</div>}

      {running ? (
        <StreamDashboard mode="replay" />
      ) : (
        <div className="idle-hint card">
          <h2>Replay a session</h2>
          <p>Select a recorded session and press Start Replay.</p>
          <ul>
            <li>Sessions loaded from <code>hardware_raw.csv</code></li>
            <li>Speed 1x = real-time, 20x = 20 seconds per second</li>
            <li>Camera feed is not available in replay mode</li>
          </ul>
        </div>
      )}
    </div>
  )
}
