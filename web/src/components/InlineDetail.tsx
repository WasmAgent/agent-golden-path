import React from 'react'
import { useT } from '../i18n/LanguageContext'

interface Props {
  open: boolean
  title: string
  onClose: () => void
  children: React.ReactNode
  list: React.ReactNode
}

export default function InlineDetail({ open, title, onClose, children, list }: Props) {
  const t = useT()
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {open ? (
        <>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 0 12px', flexShrink: 0,
            borderBottom: '1px solid var(--color-border)',
            marginBottom: 16,
          }}>
            <button
              onClick={onClose}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--color-primary)', fontWeight: 500, fontSize: 13,
                padding: '2px 6px', borderRadius: 4,
              }}
            >
              {t('common.back')}
            </button>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {children}
          </div>
        </>
      ) : (
        <>{list}</>
      )}
    </div>
  )
}
