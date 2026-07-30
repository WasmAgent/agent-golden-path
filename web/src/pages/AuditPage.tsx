import { useEffect, useState } from 'react'
import { FileText, BarChart2, RefreshCw, ExternalLink, ShieldAlert } from 'lucide-react'
import { useLanguage } from '../i18n/LanguageContext'
import { severityLabel, auditActionLabel } from '../i18n/enums'

interface TurnRow {
  turnRow: {
    turnId: string
    userId: string
    calledAt: string
    userMessage: string
    assistantMessage: string
  }
  toolCalls: ToolCall[]
}

interface ToolCall {
  toolName: string
  calledAt: string
  durationMs: number
  hasError: boolean
  errorMessage: string
  stateChanging: boolean
  outcome: string
}

interface Scores {
  easScore: number | null
  easGrade: string
  arsScore: number | null
  findings: Finding[]
}

interface Finding {
  severity: string
  title: string
  description: string
  recommendation: string
}

interface ViolationLog {
  id: string
  timestamp: string
  userId: string
  action: string
  entityType: string
  entityId: string
  details: string
  success: boolean
}

const SEV_COLORS: Record<string, { bg: string; color: string }> = {
  critical: { bg: '#fee2e2', color: '#b91c1c' },
  high:     { bg: '#ffedd5', color: '#c2410c' },
  medium:   { bg: '#fef3c7', color: '#b45309' },
  low:      { bg: '#f3f4f6', color: '#4b5563' },
  info:     { bg: '#f3f4f6', color: '#374151' },
}

// Colors per action tag; the display label comes from i18n enums (auditActionLabel).
const ACTION_COLORS: Record<string, { color: string; bg: string }> = {
  COMPLIANCE_BLOCKED:    { color: '#b45309', bg: '#fef3c7' },
  POLICY_BYPASS_ATTEMPT: { color: '#b91c1c', bg: '#fee2e2' },
}

export default function AuditPage() {
  const { t, lang, locale } = useLanguage()
  const [turns, setTurns] = useState<TurnRow[]>([])
  const [scores, setScores] = useState<Scores | null>(null)
  const [violations, setViolations] = useState<ViolationLog[]>([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  function load() {
    setLoading(true)
    const qs = new URLSearchParams()
    if (fromDate) qs.set('fromDate', fromDate)
    if (toDate)   qs.set('toDate', toDate)

    Promise.all([
      fetch(`/api/audit/turns?${qs}&limit=100`).then(r => r.json()),
      fetch(`/api/chat/audit?${qs}`).then(r => r.json()),
    ]).then(([turns, auditLog]) => {
      setTurns(turns.value || [])
      const allLogs: ViolationLog[] = auditLog.value || []
      setViolations(allLogs.filter(l => !l.success))
      setLoading(false)
    }).catch(() => setLoading(false))
  }

  function analyze() {
    setAnalyzing(true)
    const qs = new URLSearchParams()
    if (fromDate) qs.set('fromDate', fromDate)
    if (toDate)   qs.set('toDate', toDate)

    fetch(`/api/audit/analyze?${qs}`)
      .then(r => r.json())
      .then(d => { setScores(d); setAnalyzing(false) })
      .catch(() => setAnalyzing(false))
  }

  function openReport() {
    const qs = new URLSearchParams()
    if (fromDate) qs.set('fromDate', fromDate)
    if (toDate)   qs.set('toDate', toDate)
    qs.set('locale', lang)
    window.open(`/api/audit/report?${qs}`, '_blank')
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Compute tool stats from loaded turns
  const toolStats: Record<string, { count: number; errors: number; stateChanging: number }> = {}
  let totalCalls = 0, totalErrors = 0, totalWrites = 0
  for (const { toolCalls } of turns) {
    totalCalls += toolCalls.length
    for (const tc of toolCalls) {
      const s = toolStats[tc.toolName] || (toolStats[tc.toolName] = { count: 0, errors: 0, stateChanging: 0 })
      s.count++
      if (tc.hasError) { s.errors++; totalErrors++ }
      if (tc.stateChanging) { s.stateChanging++; totalWrites++ }
    }
  }

  const gradeColor = (g?: string) => ({ A:'#059669', B:'#16a34a', C:'#ca8a04', D:'#ea580c', F:'#dc2626' }[g||''] || '#6b7280')

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 16px', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>{t('audit.title')}</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{t('audit.subtitle')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={analyze} disabled={analyzing} style={{
            padding: '7px 14px', borderRadius: 6,
            border: '1px solid var(--color-primary)', background: 'var(--color-primary)',
            color: '#fff', fontSize: 13, cursor: analyzing ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6, opacity: analyzing ? 0.7 : 1,
          }}>
            <BarChart2 size={13} />
            {analyzing ? t('audit.scoring') : t('audit.runAnalysis')}
          </button>
          <button onClick={openReport} style={{
            padding: '7px 14px', borderRadius: 6,
            border: '1px solid var(--color-border)', background: '#fff',
            fontSize: 13, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <FileText size={13} />
            {t('audit.generateReport')}
            <ExternalLink size={11} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20, alignItems: 'center' }}>
        <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('audit.from')}</label>
        <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
          style={{ padding: '5px 8px', borderRadius: 5, border: '1px solid var(--color-border)', fontSize: 13, minWidth: 0 }} />
        <label style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{t('audit.to')}</label>
        <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
          style={{ padding: '5px 8px', borderRadius: 5, border: '1px solid var(--color-border)', fontSize: 13, minWidth: 0 }} />
        <button onClick={load} style={{
          padding: '5px 12px', borderRadius: 5,
          border: '1px solid var(--color-primary)', background: 'var(--color-primary)',
          color: '#fff', fontSize: 13, cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 5,
        }}>
          <RefreshCw size={12} /> {t('audit.load')}
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: t('audit.stat.turns'), value: turns.length, color: '#4f46e5' },
          { label: t('audit.stat.toolCalls'), value: totalCalls, color: '#4f46e5' },
          { label: t('audit.stat.writeOps'), value: totalWrites, color: '#b45309' },
          { label: t('audit.stat.errors'), value: totalErrors, color: '#dc2626' },
          { label: t('audit.stat.violations'), value: violations.length, color: violations.length > 0 ? '#b91c1c' : '#059669' },
          ...(scores ? [
            { label: `EAS · ${scores.easGrade}`, value: scores.easScore !== null ? Math.round(scores.easScore) : 'N/A', color: gradeColor(scores.easGrade) },
            { label: t('audit.stat.ars'), value: scores.arsScore !== null ? Math.round(scores.arsScore) : 'N/A', color: '#059669' },
            { label: t('audit.stat.findings'), value: scores.findings.length, color: scores.findings.length > 0 ? '#dc2626' : '#059669' },
          ] : []),
        ].map(({ label, value, color }) => (
          <div key={label} style={{
            border: '1px solid var(--color-border)', borderRadius: 10, padding: '14px 16px',
            borderLeft: `4px solid ${color}`, background: '#fff',
          }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', letterSpacing: '.3px' }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Policy Violations — always visible if any exist */}
      {violations.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <ShieldAlert size={16} color="#b91c1c" />
            {t('audit.violationsTitle')}
          </h2>
          <div style={{ overflowX: 'auto', borderRadius: 8, boxShadow: 'var(--shadow)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', minWidth: 700 }}>
              <thead>
                <tr style={{ background: '#fafafa', borderBottom: '1px solid var(--color-border)' }}>
                  {[
                    ['audit.vio.time', 'Time'], ['audit.vio.user', 'User'], ['audit.vio.type', 'Violation Type'],
                    ['audit.vio.entity', 'Entity'], ['audit.vio.detail', 'Detail'],
                  ].map(([k]) => (
                    <th key={k} style={{ padding: '9px 12px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'left', whiteSpace: 'nowrap' }}>{t(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {violations.map((v, i) => {
                  const tag = ACTION_COLORS[v.action] || { color: '#b45309', bg: '#fef3c7' }
                  let detail = ''
                  try {
                    const d = JSON.parse(v.details || '{}')
                    detail = d.blockedRules || d.description || d.rule || JSON.stringify(d)
                  } catch { detail = v.details || '' }
                  return (
                    <tr key={v.id} style={{
                      borderBottom: i < violations.length - 1 ? '1px solid var(--color-border)' : 'none',
                      background: '#fff9f9',
                    }}>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                        {v.timestamp ? new Date(v.timestamp).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 500 }}>{v.userId}</td>
                      <td style={{ padding: '9px 12px' }}>
                        <span style={{ background: tag.bg, color: tag.color, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {auditActionLabel(lang, v.action)}
                        </span>
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--color-text-muted)' }}>
                        {v.entityType} {v.entityId}
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 12, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {detail}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* OAA Findings */}
      {scores && scores.findings.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>{t('audit.findingsTitle')}</h2>
          <div style={{ overflowX: 'auto', borderRadius: 8, boxShadow: 'var(--shadow)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', minWidth: 600 }}>
              <thead>
                <tr style={{ background: '#fafafa', borderBottom: '1px solid var(--color-border)' }}>
                  {[
                    ['audit.find.severity', 'Severity'], ['audit.find.title', 'Title'],
                    ['audit.find.description', 'Description'], ['audit.find.recommendation', 'Recommendation'],
                  ].map(([k]) => (
                    <th key={k} style={{ padding: '9px 12px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'left' }}>{t(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {scores.findings.map((f, i) => {
                  const sc = SEV_COLORS[f.severity] || SEV_COLORS.info
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '9px 12px' }}>
                        <span style={{ ...sc, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700 }}>{severityLabel(lang, f.severity)}</span>
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 500 }}>{f.title}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--color-text-muted)' }}>{f.description}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12 }}>{f.recommendation}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tool stats */}
      {totalCalls > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>{t('audit.toolStatsTitle')}</h2>
          <div style={{ overflowX: 'auto', borderRadius: 8, boxShadow: 'var(--shadow)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', minWidth: 500 }}>
              <thead>
                <tr style={{ background: '#fafafa', borderBottom: '1px solid var(--color-border)' }}>
                  {[
                    ['audit.tool.tool', 'Tool'], ['audit.tool.calls', 'Calls'], ['audit.tool.errors', 'Errors'],
                    ['audit.tool.errorRate', 'Error Rate'], ['audit.tool.writeOps', 'Write Ops'],
                  ].map(([k]) => (
                    <th key={k} style={{ padding: '9px 12px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'left' }}>{t(k)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(toolStats).sort((a, b) => b[1].count - a[1].count).map(([tool, s]) => (
                  <tr key={tool} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '8px 12px', fontSize: 13 }}><code style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 3, fontSize: 12 }}>{tool}</code></td>
                    <td style={{ padding: '8px 12px', fontSize: 13 }}>{s.count}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13, color: s.errors > 0 ? '#dc2626' : 'inherit' }}>{s.errors}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13 }}>{s.errors > 0 ? (s.errors / s.count * 100).toFixed(1) + '%' : '—'}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13 }}>{s.stateChanging || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Turn log */}
      <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>{t('audit.turnLogTitle')}</h2>
      {loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>{t('common.loading')}</p>
      ) : turns.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🛡️</div>
          <p style={{ fontSize: 14 }}>{t('audit.turnLogEmpty')}</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 8, boxShadow: 'var(--shadow)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', minWidth: 700 }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid var(--color-border)' }}>
                {[
                  ['audit.turn.time', 'Time'], ['audit.turn.user', 'User'], ['audit.turn.tools', 'Tools'],
                  ['audit.turn.writes', 'Writes'], ['audit.turn.errors', 'Errors'], ['audit.turn.userMessage', 'User Message'],
                ].map(([k]) => (
                  <th key={k} style={{ padding: '9px 12px', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', textAlign: 'left', whiteSpace: 'nowrap' }}>{t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {turns.map(({ turnRow, toolCalls }, i) => {
                const writes = toolCalls.filter(tc => tc.stateChanging).length
                const errs = toolCalls.filter(tc => tc.hasError).length
                return (
                  <tr key={turnRow.turnId} style={{ borderBottom: i < turns.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                    <td style={{ padding: '9px 12px', fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                      {turnRow.calledAt ? new Date(turnRow.calledAt).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) : '—'}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: 13 }}>{turnRow.userId}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13 }}>{toolCalls.length}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: writes > 0 ? '#b45309' : 'inherit' }}>{writes || '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: 13, color: errs > 0 ? '#dc2626' : 'inherit' }}>{errs || '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: 12, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {turnRow.userMessage || '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
