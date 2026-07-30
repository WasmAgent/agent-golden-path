import { useEffect, useState } from 'react'
import { useDocument } from '../contexts/DocumentContext'
import { useLanguage } from '../i18n/LanguageContext'
import { prStatusLabel } from '../i18n/enums'
import CopyToChat from '../components/CopyToChat'
import InlineDetail from '../components/InlineDetail'
import DocumentForm from '../components/DocumentForm'

interface PR {
  PRNumber: string
  Description: string
  Quantity: number
  Unit: string
  EstimatedPrice: number
  Currency: string
  CostCenterId: string
  VendorId: string
  Status: string
  CreatedAt: string
  CreatedBy: string
  SubmittedAt: string
  RequiredDate: string
  RejectReason: string
  PONumber: string
  S4PRNumber: string
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  PENDING_APPROVAL: { bg: '#FFF4E5', color: '#E76500' },
  APPROVED:         { bg: '#E8F5E9', color: '#188F47' },
  REJECTED:         { bg: '#FEECEB', color: '#C0392B' },
  CONVERTED:        { bg: '#EBF3FF', color: '#0070F2' },
}

function fmtPrice(currency: string, price: number, locale: string) {
  return `${currency} ${Number(price).toLocaleString(locale, { minimumFractionDigits: 2 })}`
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
      <p style={{ fontSize: 14 }}>{message}</p>
    </div>
  )
}

export default function PRListPage() {
  const { state, dispatch } = useDocument()
  const { t, lang, locale } = useLanguage()
  const [prs, setPRs] = useState<PR[]>([])
  const [loading, setLoading] = useState(true)
  const [localStatus, setLocalStatus] = useState('ALL')
  const [detail, setDetail] = useState<PR | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const statusFilter = state.filters['Status'] ?? localStatus

  const refreshList = () => {
    setLoading(true)
    const filter = statusFilter !== 'ALL' ? `?status=${statusFilter}` : ''
    fetch(`/api/purchase-requisitions${filter}`)
      .then(r => r.json())
      .then(d => { setPRs(d.value || []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  const handleApprove = async (prNumber: string) => {
    await fetch(`/api/prs/${prNumber}/approve`, { method: 'POST' })
    dispatch({ type: 'OPEN_DETAIL', id: prNumber })
    refreshList()
  }

  const handleReject = async (prNumber: string) => {
    const reason = window.prompt(t('pr.rejectPrompt')) || t('pr.rejectDefault')
    await fetch(`/api/prs/${prNumber}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    dispatch({ type: 'OPEN_DETAIL', id: prNumber })
    refreshList()
  }

  useEffect(() => {
    setLoading(true)
    const filter = statusFilter !== 'ALL' ? `?status=${statusFilter}` : ''
    fetch(`/api/purchase-requisitions${filter}`)
      .then(r => r.json())
      .then(d => { setPRs(d.value || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [statusFilter, state.filters, state.listVersion])

  useEffect(() => {
    if (!state.detailOpen || state.detailMode === 'edit' || !state.selectedId) {
      setDetail(null)
      return
    }
    setDetailLoading(true)
    fetch(`/api/purchase-requisitions/${encodeURIComponent(state.selectedId)}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: PR | null) => {
        setDetail(d ?? null)
        setDetailLoading(false)
      })
      .catch(() => setDetailLoading(false))
  }, [state.detailOpen, state.detailMode, state.selectedId, state.detailVersion])

  const isEditing = state.detailOpen && state.detailMode === 'edit'
  // Detail view needs a selected id; form (edit) mode can open without one.
  const detailOpen = state.detailOpen && (isEditing || !!state.selectedId)

  const listContent = (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 16px', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>{t('pr.title')}</h1>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{t('pr.subtitle')}</p>
        </div>
        <select
          value={statusFilter}
          onChange={e => { setLocalStatus(e.target.value); dispatch({ type: 'CLEAR_FILTERS' }) }}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)', fontSize: 13, background: '#fff', flexShrink: 0 }}
        >
          <option value="ALL">{t('common.filter.allStatuses')}</option>
          <option value="PENDING_APPROVAL">{prStatusLabel(lang, 'PENDING_APPROVAL')}</option>
          <option value="APPROVED">{prStatusLabel(lang, 'APPROVED')}</option>
          <option value="REJECTED">{prStatusLabel(lang, 'REJECTED')}</option>
          <option value="CONVERTED">{prStatusLabel(lang, 'CONVERTED')}</option>
        </select>
      </div>

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>{t('common.loading')}</p>
      ) : prs.length === 0 ? (
        <EmptyState message={t('pr.empty')} />
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 8, boxShadow: 'var(--shadow)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', minWidth: 640 }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid var(--color-border)' }}>
                {[
                  ['pr.col.number', 'PR Number'], ['pr.col.description', 'Description'], ['pr.col.qty', 'Qty'],
                  ['pr.col.estPrice', 'Est. Price'], ['pr.col.costCentre', 'Cost Centre'],
                  ['pr.col.vendor', 'Vendor'],
                  ['pr.col.requiredDate', 'Required Date'], ['pr.col.status', 'Status'],
                ].map(([k]) => (
                  <th key={k} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {prs.map((pr, i) => {
                const sc = STATUS_COLORS[pr.Status] || { bg: '#f0f2f5', color: '#555' }
                const isHighlighted = state.highlightedIds.includes(pr.PRNumber)
                const isSelected = state.selectedId === pr.PRNumber
                return (
                  <tr
                    key={pr.PRNumber}
                    onClick={() => dispatch({ type: 'OPEN_DETAIL', id: pr.PRNumber })}
                    style={{
                      borderBottom: i < prs.length - 1 ? '1px solid var(--color-border)' : 'none',
                      cursor: 'pointer',
                      borderLeft: isSelected ? '3px solid var(--jc-accent)' : '3px solid transparent',
                      background: isHighlighted ? 'rgba(var(--jc-accent-rgb),0.06)' : undefined,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!isHighlighted) e.currentTarget.style.background = '#f5f8ff' }}
                    onMouseLeave={e => { e.currentTarget.style.background = isHighlighted ? 'rgba(var(--jc-accent-rgb),0.06)' : '' }}
                  >
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: 'var(--color-primary)' }}>
                      <CopyToChat value={pr.PRNumber}>{pr.PRNumber}</CopyToChat>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13 }}>
                      <CopyToChat value={pr.Description || ''}>{pr.Description || '—'}</CopyToChat>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13 }}>
                      <CopyToChat value={`${pr.Quantity} ${pr.Unit}`}>{pr.Quantity} {pr.Unit}</CopyToChat>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13 }}>
                      <CopyToChat value={fmtPrice(pr.Currency, pr.EstimatedPrice, locale)}>{fmtPrice(pr.Currency, pr.EstimatedPrice, locale)}</CopyToChat>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13 }}>
                      <CopyToChat value={pr.CostCenterId}>{pr.CostCenterId}</CopyToChat>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13 }}>
                      <CopyToChat value={pr.VendorId || ''}>{pr.VendorId || '—'}</CopyToChat>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13 }}>
                      <CopyToChat value={pr.RequiredDate || ''}>{pr.RequiredDate || '—'}</CopyToChat>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ ...sc, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
                        {pr.Status ? prStatusLabel(lang, pr.Status) : '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )

  const detailContent = (
    <>
      {detailLoading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>{t('common.loadingDetail')}</p>
      ) : !detail ? (
        <p style={{ color: 'var(--color-text-muted)' }}>{t('common.notFound')}</p>
      ) : (
        <>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <tbody>
              {([
                [t('pr.field.number'),         detail.PRNumber],
                [t('pr.field.description'),    detail.Description],
                [t('pr.field.quantity'),       `${detail.Quantity} ${detail.Unit}`],
                [t('pr.field.estimatedPrice'), fmtPrice(detail.Currency, detail.EstimatedPrice, locale)],
                [t('pr.field.costCentre'),     detail.CostCenterId],
                [t('pr.field.vendor'),         detail.VendorId || '—'],
                [t('pr.field.status'),         prStatusLabel(lang, detail.Status)],
                [t('pr.field.requiredDate'),   detail.RequiredDate || '—'],
                [t('pr.field.createdAt'),      detail.CreatedAt || '—'],
                ...(detail.SubmittedAt ? [[t('pr.field.submittedAt'), detail.SubmittedAt]] : []),
                ...(detail.PONumber ? [[t('pr.field.poNumber'), detail.PONumber]] : []),
                ...(detail.RejectReason ? [[t('pr.field.rejectReason'), detail.RejectReason]] : []),
                ...(detail.S4PRNumber ? [[t('pr.field.s4Number'), detail.S4PRNumber]] : []),
              ] as [string, string][]).map(([label, value]) => (
                <tr key={label} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td style={{ padding: '8px 14px', fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', width: 160 }}>{label}</td>
                  <td style={{ padding: '8px 14px' }}>
                    <CopyToChat value={value}>{value}</CopyToChat>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {detail.S4PRNumber && (
            <div style={{ marginTop: 14 }}>
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                  background: '#0070F2', color: '#fff',
                }}
              >
                {t('common.openInErp')}
              </span>
            </div>
          )}

          {detail.Status === 'PENDING_APPROVAL' && (
            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              <button
                onClick={() => handleApprove(detail.PRNumber)}
                style={{
                  padding: '6px 18px', borderRadius: 6, border: 'none',
                  background: '#188F47', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {t('pr.approve')}
              </button>
              <button
                onClick={() => handleReject(detail.PRNumber)}
                style={{
                  padding: '6px 18px', borderRadius: 6, border: 'none',
                  background: '#C0392B', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                {t('pr.reject')}
              </button>
            </div>
          )}
        </>
      )}
    </>
  )

  return (
    <InlineDetail
      open={detailOpen}
      title={isEditing ? t('pr.newDraft') : t('pr.detailTitle', { id: state.selectedId ?? '' })}
      onClose={() => dispatch({ type: 'CLOSE_DETAIL' })}
      list={listContent}
    >
      {isEditing ? <DocumentForm /> : detailContent}
    </InlineDetail>
  )
}
