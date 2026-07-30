import React, { useMemo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const REMARK_PLUGINS = [remarkGfm]

const COMPONENTS: Components = {
  pre: ({ children }) => (
    <pre style={{
      background: 'var(--jc-code-bg)', color: 'var(--jc-code-text)',
      border: `1px solid var(--jc-border-warm)`,
      borderRadius: 6, padding: '10px 12px',
      overflowX: 'auto', fontSize: 12, lineHeight: 1.55, margin: '6px 0',
    }}>
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = !!className
    return isBlock ? (
      <code className={className} {...props}>{children}</code>
    ) : (
      <code style={{
        background: `rgba(var(--jc-accent-rgb),0.10)`, color: 'var(--jc-accent)',
        padding: '1px 5px', borderRadius: 4,
        fontSize: '0.88em', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace',
      }} {...props}>{children}</code>
    )
  },
  table: ({ children }) => (
    <div style={{ overflowX: 'auto', margin: '8px 0', maxWidth: '100%' }}>
      <table style={{
        width: 'max-content', minWidth: '100%', borderCollapse: 'collapse', fontSize: 12,
        border: `1px solid rgba(var(--jc-accent-rgb),0.18)`, borderRadius: 8, overflow: 'hidden',
      }}>{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th style={{
      border: 'none', borderBottom: `2px solid rgba(var(--jc-accent-rgb),0.25)`,
      padding: '6px 12px',
      background: `linear-gradient(135deg,rgba(var(--jc-accent-rgb),0.10),rgba(var(--jc-blue-rgb),0.06))`,
      fontWeight: 700, fontSize: 11, textAlign: 'left', whiteSpace: 'nowrap',
      color: 'var(--jc-accent)', letterSpacing: '0.02em', textTransform: 'uppercase',
    }}>{children}</th>
  ),
  td: ({ children }) => (
    <td style={{
      borderTop: `1px solid var(--jc-table-divider)`,
      padding: '5px 12px', verticalAlign: 'top',
    }}>
      {children}
    </td>
  ),
  blockquote: ({ children }) => (
    <blockquote style={{
      borderLeft: `3px solid var(--jc-accent)`, margin: '6px 0', paddingLeft: 10,
      color: 'var(--jc-text-secondary)', background: `rgba(var(--jc-accent-rgb),0.05)`,
      borderRadius: '0 4px 4px 0',
    }}>{children}</blockquote>
  ),
  p: ({ children }) => <p style={{ margin: '4px 0', lineHeight: 1.6 }}>{children}</p>,
  h1: ({ children }) => <h1 style={{ fontSize: 16, margin: '8px 0 4px', fontWeight: 600 }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ fontSize: 14, margin: '8px 0 4px', fontWeight: 600 }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ fontSize: 13, margin: '6px 0 2px', fontWeight: 600 }}>{children}</h3>,
  ul: ({ children }) => <ul style={{ margin: '4px 0', paddingLeft: 20 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '4px 0', paddingLeft: 20 }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '2px 0', lineHeight: 1.55 }}>{children}</li>,
  a: ({ href, children }) => (
    <a href={/^https?:\/\//i.test(href ?? '') ? href : '#'} target="_blank" rel="noopener noreferrer"
      style={{ color: 'var(--jc-blue)', textDecoration: 'underline', textDecorationStyle: 'dotted' }}>
      {children}
    </a>
  ),
  hr: () => <hr style={{ border: 'none', borderTop: `1px solid var(--jc-border-warm)`, margin: '8px 0' }} />,
  strong: ({ children }) => <strong style={{ fontWeight: 700, color: 'var(--jc-text)' }}>{children}</strong>,
}

export const MarkdownMessage: React.FC<{ content: string }> = React.memo(({ content }) => {
  const rendered = useMemo(() => content, [content])
  return (
    <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--jc-text)' }}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {rendered}
      </ReactMarkdown>
    </div>
  )
})
