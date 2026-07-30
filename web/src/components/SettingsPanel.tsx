import { useEffect, useState, useCallback } from 'react'
import { X, Wifi, WifiOff, Loader2, AlertTriangle } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'

type Mode = 'offline' | 'online' | 'auto'

interface ModeStatus {
  mode: Mode
  configured: boolean
  hasCredentials: boolean
}

interface Props {
  onClose: () => void
}

// Settings drawer — currently exposes the ERP connection mode (offline vs online).
// Offline uses the local SQLite demo data so the left panel and Copilot always agree;
// online queries the live ERP (only selectable when credentials are configured).
export default function SettingsPanel({ onClose }: Props) {
  const { t } = useLanguage()
  const [status, setStatus] = useState<ModeStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/chat/mode')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setStatus(await res.json())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.loadError'))
    }
  }, [t])

  useEffect(() => { load() }, [load])

  async function changeMode(mode: Mode) {
    if (busy || status?.mode === mode) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/chat/mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setStatus(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.changeError'))
      await load()
    } finally {
      setBusy(false)
    }
  }

  const mode = status?.mode
  const onlineDisabled = !status?.hasCredentials

  const options: { id: Mode; label: string; desc: string; icon: typeof Wifi; disabled?: boolean }[] = [
    { id: 'offline', label: t('settings.offline.label'), desc: t('settings.offline.desc'), icon: WifiOff },
    { id: 'online',  label: t('settings.online.label'),  desc: onlineDisabled ? t('settings.online.descDisabled') : t('settings.online.descEnabled'), icon: Wifi, disabled: onlineDisabled },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
      <div role="dialog" aria-label={t('settings.title')} style={{
        position: 'relative', width: 380, maxWidth: '90vw', height: '100%',
        background: '#fff', boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: '1px solid var(--color-border)',
        }}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{t('settings.title')}</span>
          <button onClick={onClose} aria-label={t('settings.close')} style={{
            padding: 6, borderRadius: 6, border: '1px solid var(--color-border)',
            background: 'transparent', cursor: 'pointer', color: 'var(--color-text-muted)',
            display: 'flex', alignItems: 'center',
          }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '20px', overflow: 'auto', flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>
            {t('settings.erpMode')}
          </div>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', margin: '0 0 14px' }}>
            {t('settings.erpModeDesc')}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {options.map(opt => {
              const active = mode === opt.id
              const Icon = opt.icon
              return (
                <button
                  key={opt.id}
                  onClick={() => !opt.disabled && changeMode(opt.id)}
                  disabled={opt.disabled || busy}
                  style={{
                    textAlign: 'left', padding: '12px 14px', borderRadius: 10,
                    border: active ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                    background: active ? 'rgba(90,43,140,0.05)' : '#fff',
                    cursor: opt.disabled ? 'not-allowed' : 'pointer',
                    opacity: opt.disabled ? 0.55 : 1,
                    display: 'flex', gap: 12, alignItems: 'flex-start',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <Icon size={18} color={active ? 'var(--color-primary)' : 'var(--color-text-muted)'} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 600, color: 'var(--color-text)' }}>
                      {opt.label}
                      {active && <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-primary)', border: '1px solid var(--color-primary)', borderRadius: 4, padding: '1px 5px' }}>{t('settings.active')}</span>}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'var(--color-text-muted)', lineHeight: 1.4 }}>{opt.desc}</span>
                  </span>
                </button>
              )
            })}
          </div>

          {busy && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, fontSize: 12, color: 'var(--color-text-muted)' }}>
              <Loader2 size={14} style={{ animation: 'spin 0.8s linear infinite' }} /> {t('settings.switching')}
            </div>
          )}

          {error && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 14, fontSize: 12, color: '#b42318', background: 'rgba(180,35,24,0.06)', padding: '8px 10px', borderRadius: 8 }}>
              <AlertTriangle size={14} style={{ marginTop: 1, flexShrink: 0 }} /> {error}
            </div>
          )}

          {!status?.hasCredentials && (
            <p style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 16, lineHeight: 1.5 }}>
              {t('settings.noCredentials')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
