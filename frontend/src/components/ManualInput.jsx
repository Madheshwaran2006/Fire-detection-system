
import { useState, useEffect, useRef } from 'react'
import AlertBanner from './AlertBanner'
import ProbabilityPanel from './ProbabilityPanel'
import SensorGauges from './SensorGauges'

const API = 'http://localhost:8000'

const DEFAULTS = {
  temperature: 30.2,
  humidity: 77.5,
  smoke: 640,
  flame: 4095,
}

export default function ManualInput() {
  const [form, setForm] = useState(DEFAULTS)
  const [result, setResult] = useState(null)
  const [count, setCount] = useState(0)
  const [votes, setVotes] = useState([])
  const [err, setErr] = useState('')

  // Prevent repeated popups while the same fire event remains active.
  const previousFireState = useRef(false)

  useEffect(() => {
    const fireDetected =
      result?.ready === true &&
      (
        result.fire === true ||
        result.fire === 1 ||
        result.fire === '1' ||
        result.fire === 'true'
      )

    if (fireDetected && !previousFireState.current) {
      window.alert(
        '🔥 FIRE DETECTED!\n\n' +
        'The model has detected a possible fire. ' +
        'Please check the area immediately.'
      )
    }

    previousFireState.current = fireDetected
  }, [result])

  async function send() {
    setErr('')

    try {
      const res = await fetch(`${API}/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      })

      if (!res.ok) {
        throw new Error(`API returned ${res.status}`)
      }

      const d = await res.json()

      setResult(d)
      setCount(c => c + 1)

      if (d.ready) {
        setVotes(prev => [...prev, d.fire].slice(-10))
      }
    } catch (error) {
      console.error('Prediction error:', error)

      setErr(
        'Cannot reach API — make sure the backend is running on port 8000.'
      )
    }
  }

  async function reset() {
    setErr('')

    try {
      const res = await fetch(`${API}/reset`, {
        method: 'POST',
      })

      if (!res.ok) {
        throw new Error(`Reset returned ${res.status}`)
      }
    } catch (error) {
      console.error('Reset error:', error)
      setErr('Could not reset the backend session.')
    }

    setForm(DEFAULTS)
    setResult(null)
    setCount(0)
    setVotes([])
    previousFireState.current = false
  }

  function change(key, value) {
    setForm(current => ({
      ...current,
      [key]: value === '' ? '' : Number(value),
    }))
  }

  const fields = [
    {
      key: 'temperature',
      label: 'Temperature (°C)',
      min: 0,
      max: 60,
      step: 0.1,
    },
    {
      key: 'humidity',
      label: 'Humidity (%)',
      min: 0,
      max: 100,
      step: 0.1,
    },
    {
      key: 'smoke',
      label: 'Smoke ADC (MQ2)',
      min: 0,
      max: 4095,
      step: 1,
    },
    {
      key: 'flame',
      label: 'Flame sensor reading',
      min: 0,
      max: 4095,
      step: 1,
    },
  ]

  return (
    <div className="manual-wrap">
      <div className="card">
        <h3>Enter Sensor Reading #{count + 1}</h3>

        <br />

        <div className="input-grid">
          {fields.map(field => (
            <div className="input-group" key={field.key}>
              <label>{field.label}</label>

              <input
                type="number"
                value={form[field.key]}
                min={field.min}
                max={field.max}
                step={field.step}
                onChange={event =>
                  change(field.key, event.target.value)
                }
              />
            </div>
          ))}
        </div>

        <br />

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="btn btn-primary"
            onClick={send}
          >
            Send Reading
          </button>

          <button
            className="btn btn-secondary"
            onClick={reset}
          >
            Reset Session
          </button>
        </div>

        {err && (
          <p
            style={{
              color: '#f87171',
              fontSize: '0.82rem',
              marginTop: 10,
            }}
          >
            {err}
          </p>
        )}
      </div>

      {/* Gauges from the latest manual input */}
      {result && (
        <SensorGauges
          data={{
            ...form,
            fireDetected:
              result.ready === true
                ? (
                    result.fire === true ||
                    result.fire === 1 ||
                    result.fire === '1' ||
                    result.fire === 'true'
                  )
                : undefined,
          }}
        />
      )}

      {/* Model alert and probability */}
      {result && (
        <>
          <AlertBanner
            ready={result.ready}
            fire={result.fire}
            alert={result.alert}
            p_fire={result.p_fire ?? 0}
            bufLen={count}
            W={30}
          />

          <ProbabilityPanel
            p_fire={result.p_fire ?? 0}
            ready={result.ready}
            bufLen={Math.min(count, 30)}
            votes={votes}
          />
        </>
      )}

      {!result && (
        <div
          className="card"
          style={{
            color: '#475569',
            fontSize: '0.85rem',
          }}
        >
          Enter readings one per second. The model needs{' '}
          <strong style={{ color: '#94a3b8' }}>
            30 readings
          </strong>{' '}
          before it starts predicting.
        </div>
      )}
    </div>
  )
}
