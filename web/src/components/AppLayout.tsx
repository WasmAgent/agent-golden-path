import { ReactNode, useState, useRef, useCallback, useEffect } from 'react'
import { ShoppingCart, Package, FileText, Shield, Activity, MessageSquare, PanelRightOpen, PanelRightClose, Maximize2, Settings } from 'lucide-react'
import type { Page } from '../App'
import CopilotChat from './CopilotChat'
import SettingsPanel from './SettingsPanel'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useT } from '../i18n/LanguageContext'

interface Props {
  page: Page
  onNavigate: (p: Page) => void
  children: ReactNode
}

const NAV_ITEMS: { id: Page; labelKey: string; icon: ReactNode }[] = [
  { id: 'prs',      labelKey: 'nav.prs',      icon: <ShoppingCart size={15} /> },
  { id: 'pos',      labelKey: 'nav.pos',      icon: <Package size={15} /> },
  { id: 'invoices', labelKey: 'nav.invoices', icon: <FileText size={15} /> },
  { id: 'audit',    labelKey: 'nav.audit',    icon: <Shield size={15} /> },
]

const CHAT_MIN = 300
const CHAT_MAX = 900
const CHAT_DEFAULT = 380

export default function AppLayout({ page, onNavigate, children }: Props) {
  const t = useT()
  const [chatOpen, setChatOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chatWidth, setChatWidth] = useState(() =>
    typeof window !== 'undefined' ? Math.round(window.innerWidth / 2) : CHAT_DEFAULT
  )
  const [chatFullWidth, setChatFullWidth] = useState(false)
  const isMobile = useMediaQuery('(max-width: 767px)')
  const dragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartW = useRef(0)

  // Drag-to-resize handle
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true
    dragStartX.current = e.clientX
    dragStartW.current = chatWidth
    e.preventDefault()
  }, [chatWidth])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const delta = dragStartX.current - e.clientX
      const next = Math.min(CHAT_MAX, Math.max(CHAT_MIN, dragStartW.current + delta))
      setChatWidth(next)
      setChatFullWidth(false)
    }
    const onUp = () => { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  const effectiveChatWidth = chatFullWidth ? undefined : chatWidth

  return (
    <div style={{ display: 'flex', height: '100dvh', overflow: 'hidden', flexDirection: 'column' }}>

      {/* ── Top header (all breakpoints) ─────────────────────────── */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 0,
        background: '#fff', borderBottom: '1px solid var(--color-border)',
        flexShrink: 0, zIndex: 20, height: 48,
      }}>
        {/* Logo */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '0 20px 0 16px', borderRight: '1px solid var(--color-border)',
          height: '100%', flexShrink: 0,
        }}>
          <Activity size={18} color="var(--color-primary)" />
          <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: 'nowrap' }}>Procurement Copilot</span>
        </div>

        {/* Desktop nav items */}
        {!isMobile && (
          <nav style={{ display: 'flex', alignItems: 'center', flex: 1, height: '100%', padding: '0 8px' }}>
            {NAV_ITEMS.map(item => (
              <button
                key={item.id}
                onClick={() => onNavigate(item.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '0 14px', height: '100%',
                  border: 'none', background: 'transparent',
                  color: page === item.id ? 'var(--color-primary)' : 'var(--color-text-muted)',
                  fontWeight: page === item.id ? 600 : 400,
                  fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap',
                  borderBottom: page === item.id ? '2px solid var(--color-primary)' : '2px solid transparent',
                  transition: 'color 0.15s, border-color 0.15s',
                }}
                onMouseEnter={e => { if (page !== item.id) e.currentTarget.style.color = 'var(--color-text)' }}
                onMouseLeave={e => { if (page !== item.id) e.currentTarget.style.color = 'var(--color-text-muted)' }}
              >
                {item.icon}
                {t(item.labelKey)}
              </button>
            ))}
          </nav>
        )}

        {/* Spacer on mobile */}
        {isMobile && <div style={{ flex: 1 }} />}

        {/* Copilot toggle — right side */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 12px', height: '100%', marginLeft: 'auto' }}>
          <button
            onClick={() => setSettingsOpen(true)}
            title={t('header.settings')}
            aria-label={t('header.settings')}
            style={{
              padding: 7, borderRadius: 6, border: '1px solid var(--color-border)',
              background: 'transparent', cursor: 'pointer',
              color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center',
            }}
          >
            <Settings size={14} />
          </button>
          {!isMobile && chatOpen && (
            <button
              onClick={() => { setChatFullWidth(v => !v); setChatOpen(true) }}
              title={chatFullWidth ? t('header.restoreWidth') : t('header.fullWidth')}
              style={{
                padding: 7, borderRadius: 6, border: '1px solid var(--color-border)',
                background: 'transparent', cursor: 'pointer',
                color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center',
              }}
            >
              <Maximize2 size={14} />
            </button>
          )}
          <button
            onClick={() => setChatOpen(o => !o)}
            title={chatOpen ? t('header.hideCopilot') : t('header.openCopilot')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: isMobile ? '6px 12px' : '6px 14px',
              borderRadius: 6, border: '1px solid var(--color-border)',
              background: '#5A2B8C',
              color: '#fff',
              fontSize: 13, fontWeight: 500, cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            {chatOpen
              ? <PanelRightClose size={15} />
              : <PanelRightOpen size={15} />}
            {!isMobile && <span>{t('header.copilot')}</span>}
          </button>
        </div>
      </header>

      {/* ── Main row ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Main content */}
        <main style={{
          flex: 1, overflow: 'auto', minWidth: 0,
          padding: isMobile ? '16px 12px' : '24px',
        }}>
          {children}
        </main>

        {/* Desktop chat panel with drag resize */}
        {!isMobile && chatOpen && (
          <>
            {/* Drag handle */}
            <div
              onMouseDown={onMouseDown}
              style={{
                width: 4, flexShrink: 0, cursor: 'col-resize',
                background: 'transparent',
                borderLeft: '1px solid var(--color-border)',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--color-primary)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            />
            <aside style={{
              width: chatFullWidth ? undefined : chatWidth,
              flex: chatFullWidth ? 1 : undefined,
              flexShrink: 0, background: '#fff',
              display: 'flex', flexDirection: 'column',
              overflow: 'hidden',
              transition: chatFullWidth ? 'none' : undefined,
            }}>
              <CopilotChat />
            </aside>
          </>
        )}
      </div>

      {/* ── Mobile bottom nav ────────────────────────────────────── */}
      {isMobile && (
        <nav style={{
          display: 'flex', background: '#fff',
          borderTop: '1px solid var(--color-border)',
          flexShrink: 0, zIndex: 10,
        }}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 3, padding: '10px 4px',
                border: 'none', background: 'transparent',
                color: page === item.id ? 'var(--color-primary)' : 'var(--color-text-muted)',
                fontSize: 10, fontWeight: page === item.id ? 600 : 400,
                cursor: 'pointer',
                borderTop: page === item.id ? '2px solid var(--color-primary)' : '2px solid transparent',
              }}
            >
              {item.icon}
              {t(item.labelKey)}
            </button>
          ))}
        </nav>
      )}

      {/* ── Mobile chat drawer ────────────────────────────────────── */}
      {isMobile && chatOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }}
            onClick={() => setChatOpen(false)}
          />
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: '85dvh',
            background: '#fff', borderRadius: '16px 16px 0 0',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 -4px 24px rgba(0,0,0,0.12)', overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 4px' }}>
              <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--color-border)' }} />
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <CopilotChat />
            </div>
          </div>
        </div>
      )}

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}
