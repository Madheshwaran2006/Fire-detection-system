import { useState, useEffect } from 'react'
import LiveMode   from './components/LiveMode'
import ReplayMode from './components/ReplayMode'
import './App.css'

function Clock() {
  const [t, setT] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="sys-clock">
      {t.toLocaleTimeString('en-GB', { hour12: false })}
    </span>
  )
}

export default function App() {
  const [tab, setTab] = useState('live')

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="sys-id">
            <span className="sys-id-primary">Fire Detection System</span>
            <span className="sys-id-secondary">Dual-branch ML · Sensor + Camera · Real-time fusion</span>
          </div>
        </div>

        <nav className="tabs">
          <button className={tab === 'live'   ? 'active' : ''} onClick={() => setTab('live')}>
            Live · ESP32 + Camera
          </button>
          <button className={tab === 'replay' ? 'active' : ''} onClick={() => setTab('replay')}>
            Replay Sessions
          </button>
        </nav>

        <Clock />
      </header>

      <main>
        {tab === 'live'   && <LiveMode />}
        {tab === 'replay' && <ReplayMode />}
      </main>
    </div>
  )
}
