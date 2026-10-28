
import { useState, useEffect, useRef } from 'react'

import SensorGauges from './SensorGauges'
import CameraFeed from './CameraFeed'
import FusionPanel from './FusionPanel'
import LiveCharts from './LiveCharts'
import EventLog from './EventLog'
import DeviceControl from './DeviceControl'

const API = (
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'
).replace(/\/+$/, '')

const MAX_HISTORY = 120
const FRAME_POLL_MS = 1000

function DiagnosticsBar({ sseStatus, lastSseMsg, bufLen, tick }) {
  const sseColor =
    sseStatus === 'connected'
      ? 'var(--safe)'
      : sseStatus === 'connecting'
        ? 'var(--amber)'
        : 'var(--danger)'

  return (
    <div className="diag-bar">
      <span className="diag-item">
        <span className="diag-dot" style={{ background: sseColor }} />
        SSE {sseStatus}
      </span>

      <span className="diag-sep">·</span>

      <span className="diag-item">
        Backend: <code>{API}</code>
      </span>

      <span className="diag-sep">·</span>
      <span className="diag-item">Buffer: {bufLen}/30</span>

      <span className="diag-sep">·</span>
      <span className="diag-item">t = {Math.round(tick)}s</span>

      {lastSseMsg && (
        <>
          <span className="diag-sep">·</span>
          <span className="diag-item diag-last">
            Last message {lastSseMsg}
          </span>
        </>
      )}

      <a
        href={`${API}/debug`}
        target="_blank"
        rel="noreferrer"
        className="diag-link"
      >
        Debug ↗
      </a>
    </div>
  )
}

function StatusBanner({
  fusion = {},
  sensor = {},
  camera = {},
  bufLen = 0,
  tick = 0,
}) {
  const level = fusion.level ?? 'WARMING UP'
  const probability = fusion.p_combined
  const p = Number.isFinite(probability) ? probability : null

  const bannerConfig = {
    SAFE: { cls: 'safe', title: 'All Clear' },
    WARNING: { cls: 'warning', title: 'Elevated Risk' },
    ALERT: { cls: 'fire', title: 'Fire Alert' },
    'WARMING UP': { cls: 'safe', title: 'Warming Up' },
  }

  const meta = bannerConfig[level] ?? {
    cls: 'safe',
    title: level,
  }

  const sensorReady = sensor.ready === true
  const warming = !sensorReady || level === 'WARMING UP'

  if (warming) {
    return (
      <div className="alert-banner safe">
        <div className="alert-rail" />

        <div className="alert-body">
          <div className="alert-indicator">
            <span className="warming-ring" />
          </div>

          <div className="alert-text">
            <div
              className="alert-title"
              style={{ color: 'var(--text-mid)' }}
            >
              Warming Up
            </div>

            <div className="alert-sub">
              Collecting sensor readings — {bufLen}/30
              {' · '}t = {Math.round(tick)}s
            </div>
          </div>
        </div>

        <div className="alert-p-display">
          <div
            className="alert-p-value"
            style={{ color: 'var(--text-dim)' }}
          >
            —
          </div>
          <div className="alert-p-label">P Combined</div>
        </div>
      </div>
    )
  }

  const sensorProbability = Number.isFinite(sensor.p_fire)
    ? sensor.p_fire
    : null

  const cameraProbability = Number.isFinite(camera.p_fire)
    ? camera.p_fire
    : null

  const pct = value =>
    value == null
      ? '—'
      : `${(Math.min(1, Math.max(0, value)) * 100).toFixed(1)}%`

  return (
    <div className={`alert-banner ${meta.cls}`}>
      <div className="alert-rail" />

      <div className="alert-body">
        <div className={`alert-indicator alert-dot-${meta.cls}`} />

        <div className="alert-text">
          <div className="alert-title">{meta.title}</div>

          <div className="alert-sub">
            Sensor {pct(sensorProbability)}
            {' · '}
            Camera {camera.ready === false ? 'Unavailable' : pct(cameraProbability)}
            {' · '}t = {Math.round(tick)}s
          </div>
        </div>
      </div>

      <div className="alert-p-display">
        <div className="alert-p-value">
          {p == null
            ? '—'
            : (Math.min(1, Math.max(0, p)) * 100).toFixed(1)}

          {p != null && (
            <span style={{ fontSize: '1.1rem', fontWeight: 400 }}>
              %
            </span>
          )}
        </div>

        <div className="alert-p-label">P Combined</div>
      </div>
    </div>
  )
}

export default function StreamDashboard({
  mode,
  espIp,
  cameraEnabled = true,
}) {
  const [latest, setLatest] = useState(null)
  const [history, setHistory] = useState([])
  const [logs, setLogs] = useState([])
  const [tick, setTick] = useState(0)
  const [frame, setFrame] = useState('')
  const [cameraError, setCameraError] = useState(false)
  const [sseStatus, setSseStatus] = useState('connecting')
  const [lastSseMsg, setLastSseMsg] = useState('')

  const esRef = useRef(null)
  const frameTimer = useRef(null)
  const lastLevelRef = useRef(null)

  // Tracks whether the previous live update was already in ALERT state.
  const previousFireRef = useRef(false)

  // Live fire popup: trigger only on a new confirmed ALERT transition.
  useEffect(() => {
    const fireDetected =
      latest?.sensor?.ready === true &&
      latest?.fusion?.level === 'ALERT'

    if (fireDetected && !previousFireRef.current) {
      window.alert(
        '🔥 FIRE ALERT!\n\n' +
        'The system has raised a fire alert. ' +
        'Please check the area immediately.'
      )
    }

    previousFireRef.current = fireDetected
  }, [latest])

  // Live telemetry stream.
  useEffect(() => {
    const es = new EventSource(`${API}/stream`)
    esRef.current = es

    setSseStatus('connecting')

    es.onopen = () => setSseStatus('connected')

    es.onmessage = event => {
      let data

      try {
        data = JSON.parse(event.data)
      } catch {
        console.warn('[SSE] Received invalid JSON')
        return
      }

      if (!data || typeof data !== 'object') return

      setSseStatus('connected')
      setLastSseMsg(
        new Date().toLocaleTimeString('en-GB', {
          hour12: false,
        })
      )

      setLatest(data)
      setTick(Number.isFinite(data.time_s) ? data.time_s : 0)

      const sensor = data.sensor ?? {}
      const camera = data.camera ?? {}
      const fusion = data.fusion ?? {}

      // Keep unavailable measurements null rather than plotting fake zeros.
      setHistory(previous => {
        const point = {
          t: Number.isFinite(data.time_s)
            ? Math.round(data.time_s)
            : previous.length,

          temperature: Number.isFinite(sensor.temperature)
            ? sensor.temperature
            : null,

          humidity: Number.isFinite(sensor.humidity)
            ? sensor.humidity
            : null,

          smoke: Number.isFinite(sensor.smoke)
            ? sensor.smoke
            : null,

          flame: Number.isFinite(sensor.flame)
            ? sensor.flame
            : null,

          sensor_p: Number.isFinite(sensor.p_fire)
            ? sensor.p_fire
            : null,

          camera_p: Number.isFinite(camera.p_fire)
            ? camera.p_fire
            : null,

          fusion_p: Number.isFinite(fusion.p_combined)
            ? fusion.p_combined
            : null,
        }

        return [...previous, point].slice(-MAX_HISTORY)
      })

      // Record only status transitions.
      const level = fusion.level ?? 'WARMING UP'

      if (lastLevelRef.current !== level) {
        setLogs(previous => [
          ...previous,
          {
            t: Number.isFinite(data.time_s)
              ? Math.round(data.time_s)
              : 0,

            level,
            scenario: data.scenario ?? '',
            sensor_p: sensor.p_fire ?? null,
            camera_p: camera.p_fire ?? null,
            fusion_p: fusion.p_combined ?? null,
            temperature: sensor.temperature ?? null,
            humidity: sensor.humidity ?? null,
            smoke: sensor.smoke ?? null,
            flame: sensor.flame ?? null,
          },
        ].slice(-200))

        lastLevelRef.current = level
      }
    }

    es.onerror = () => {
      setSseStatus('error — retrying')
    }

    return () => {
      es.close()
      if (esRef.current === es) {
        esRef.current = null
      }
    }
  }, [mode])

  // Camera frame polling: one request per second.
  useEffect(() => {
    if (mode !== 'live' || !cameraEnabled) {
      setFrame('')
      setCameraError(false)
      return
    }

    let cancelled = false
    let busy = false

    const fetchFrame = async () => {
      if (busy || cancelled) return
      busy = true

      try {
        const response = await fetch(`${API}/camera/frame`)

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }

        const result = await response.json()
        if (cancelled) return

        if (result.frame) {
          setFrame(result.frame)
          setCameraError(false)
        } else {
          setCameraError(true)
        }
      } catch {
        if (!cancelled) setCameraError(true)
      } finally {
        busy = false
      }
    }

    fetchFrame()
    frameTimer.current = setInterval(fetchFrame, FRAME_POLL_MS)

    return () => {
      cancelled = true
      clearInterval(frameTimer.current)
      frameTimer.current = null
    }
  }, [mode, cameraEnabled])

  const sensor = latest?.sensor ?? {}
  const camera = latest?.camera ?? {}
  const fusion = latest?.fusion ?? {}
  const boxes = latest?.boxes ?? []
  const bufLen = sensor.buf_len ?? 0

  const cameraReady =
    camera.ready === false || cameraError
      ? false
      : camera.ready === true
        ? true
        : null

  // Give the gauge the backend's fused status rather than
  // interpreting raw flame ADC 0 as a fire by itself.
  const gaugeData = {
    ...sensor,
    fireDetected:
      fusion.level === 'ALERT'
        ? true
        : ['SAFE', 'WARNING'].includes(fusion.level)
          ? false
          : undefined,
  }

  return (
    <div className="stream-dashboard">
      <DiagnosticsBar
        sseStatus={sseStatus}
        lastSseMsg={lastSseMsg}
        bufLen={bufLen}
        tick={tick}
      />

      {sseStatus !== 'connected' && (
        <div className="dc-error" role="status">
          {sseStatus === 'connecting'
            ? 'Connecting to the backend telemetry stream…'
            : 'Backend stream disconnected. Attempting to reconnect…'}
        </div>
      )}

      <StatusBanner
        fusion={fusion}
        sensor={sensor}
        camera={camera}
        bufLen={bufLen}
        tick={tick}
      />

      <div className="sd-row">
        <SensorGauges data={gaugeData} />

        {mode === 'live' && cameraEnabled && (
          <CameraFeed
            frame_b64={frame}
            boxes={boxes}
            cameraReady={cameraReady}
          />
        )}
      </div>

      {mode === 'live' && <DeviceControl espIp={espIp} />}

      <FusionPanel
        sensor={sensor}
        camera={camera}
        fusion={fusion}
      />

      <LiveCharts history={history} mode={mode} />
      <EventLog logs={logs} />
    </div>
  )
}
