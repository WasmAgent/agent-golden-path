import React, { useState } from 'react'
import { insertToChatAtCursor } from '../utils/chatInsert'

interface Props {
  value: string
  children: React.ReactNode
}

export default function CopyToChat({ value, children }: Props) {
  const [hovered, setHovered] = useState(false)

  return (
    <span
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {children}
      {hovered && (
        <button
          title={`Insert: ${value}`}
          onClick={e => { e.stopPropagation(); insertToChatAtCursor(value) }}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 18, height: 18, borderRadius: 4,
            background: 'var(--jc-accent)', border: 'none',
            color: 'white', fontSize: 10, cursor: 'pointer',
            flexShrink: 0, lineHeight: 1,
            boxShadow: '0 1px 4px rgba(var(--jc-accent-rgb),0.4)',
          }}
        >
          →
        </button>
      )}
    </span>
  )
}
