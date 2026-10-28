import { useState, useEffect, useRef } from 'react'
import AlertBanner    from './AlertBanner'
import SensorGauges   from './SensorGauges'
import ProbabilityPanel from './ProbabilityPanel'
import LiveCharts     from './LiveCharts'
import EventLog       from './EventLog'

const API = 'http://localhost:8000'
const MAX_HISTORY = 120

export default function Dashboard() {
  const [sessions, setSessions]   = useState([])
  const [selSid,   setSelSid]     = useState('')
  const [speed,    setSpeed]      = useState(5)
  const [running,  setRunning]    = useState(false)
  const [latest,   setLatest]     = useState(null)
  const [history,  setHistory]    = useState([])
  const [logs,     setLogs]       = useState([])
  const [bufLen,   setBufLen]     = useState(0)
  const [votes,    setVotes]      = useState([])
  const esSrc = useRef(null)

  // load sessions on mount
  useEffect(() => {
    fetch(`${API}/sessions`)
      .then(r => r.json())
      .then(d => { setSessions(d); setSelSid(String(d[0]?.session_id ?? '')) })
      .catch(() => {})
  }, [])

  function stop() {
    esSrc.current?.close()
    esSrc.current = null
    setRunning(false)
  }

  function start() {
    stop()
    setHistory([]); setLogs([]); setLatest(null); setBufLen(0); setVotes([])
    const es = new EventSource(`${API}/replay/${selSid}?speed=${speed}`)
    esSrc.current = es
    setRunning(true)
    let t = 0

    es.onmessage = e => {
      const d = JSON.parse(e.data)
      if (d.done) { stop(); return }

      t += 1
      if (!d.ready) { setBufLen(t); return }

      setLatest(d)
      setBufLen(30)

      // track persistence votes (last 10 fire decisions)
      setVotes(prev => {
        const next = [...prev, d.fire].slice(-10)
        return next
      })

      setHistory(prev => {
        const next = [...prev, { t, ...d }]
        return next.length > MAX_HISTORY ? next.slice(-MAX_HISTORY) : next
      })

      // log only state changes
      setLogs(prev => {
        const last = prev[prev.length - 1]
        const changed = !last || last.alert !== d.alert || last.fire !== d.fire
        if (!changed) return prev
        return [...prev, { t, ...d }]
      })
    }
    es.onerror = () => stop()
  }

  const scenario = sessions.find(s => String(s.session_id) === selSid)?.scenario ?? ''

  return (
    <div className="dashboard">

      {/* controls */}
      <div className="card controls-bar">
        <label>Session:</label>
        <select value={selSid} onChange={e => setSelSid(e.target.value)} disabled={running}>
          {sessions.map(s => (
            <option key={s.session_id} value={s.session_id}>
              #{s.session_id} — {s.scenario}
            </option>
          ))}
        </select>

        <label>Speed: {speed}×</label>
        <input type="range" min="1" max="20" value={speed}
               onChange={e => setSpeed(Number(e.target.value))} disabled={running} />

        {!running
          ? <button className="btn btn-primary" onClick={start} disabled={!selSid}>▶ Start Replay</button>
          : <button className="btn btn-danger"  onClick={stop}>⏹ Stop</button>
        }
        {scenario && <span className="tag">scenario: {scenario}</span>}
      </div>

      {/* alert banner */}
      <AlertBanner
        ready={latest?.ready ?? false}
        fire={latest?.fire ?? false}
        alert={latest?.alert ?? false}
        p_fire={latest?.p_fire ?? 0}
        bufLen={bufLen}
        W={30}
      />

      {/* gauges + probability side by side */}
      <div className="row">
        <div style={{ flex: 2 }}>
          <SensorGauges data={latest} />
        </div>
        <div style={{ flex: 1 }}>
          <ProbabilityPanel
            p_fire={latest?.p_fire ?? 0}
            ready={latest?.ready ?? false}
            bufLen={bufLen}
            votes={votes}
          />
        </div>
      </div>

      {/* live charts */}
      <LiveCharts history={history} />

      {/* event log */}
      <EventLog logs={logs} />
    </div>
  )
}
