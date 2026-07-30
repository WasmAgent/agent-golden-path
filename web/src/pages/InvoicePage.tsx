import { useEffect, useState } from 'react'
import { useDocument } from '../contexts/DocumentContext'
import { useLanguage } from '../i18n/LanguageContext'
import { invoiceStatusLabel } from '../i18n/enums'
import CopyToChat from '../components/CopyToChat'
import DocumentForm from '../components/DocumentForm'

interface Invoice {
  InvoiceId: string
  PONumber: string
  VendorId: string
  GrossAmount: number
  NetAmount: number
  Currency: string
  InvoiceDate: string
  Status: string
  MatchScore: number
  PaymentBlock: boolean
  TaxAmount: number
  PostingDate: string
  ExternalRef: string
  MatchDetail: string
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  PENDING:  { bg: '#FFF4E5', color: '#E76500' },
  MATCHED:  { bg: '#E8F5E9', color: '#188F47' },
  PARTIAL:  { bg: '#FFF9E6', color: '#B97B00' },
  BLOCKED:  { bg: '#FEECEB', color: '#C0392B' },
  PAID:     { bg: '#f0f2f5', color: '#6B7280' },
}

function fmtAmt(currency: string, amount: number, locale: string) {
  return `${currency} ${Number(amount).toLocaleString(locale, { minimumFractionDigits: 2 })}`
}

export default function InvoicePage() {
  const { state, dispatch } = useDocument()
  const { t, lang, locale } = useLanguage()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<Invoice | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    const filterParam = state.filters['Status']
      ? `?status=${state.filters['Status']}`
      : ''
    fetch(`/api/supplier-invoices${filterParam}`)
      .then(r => r.json())
      .then(d => { setInvoices(d.value || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [state.filters, state.listVersion])

  useEffect(() => {
    if (!state.detailOpen || state.detailMode === 'edit' || !state.selectedId) {
      setDetail(null)
      return
    }
    setDetailLoading(true)
    fetch(`/api/supplier-invoices/${encodeURIComponent(state.selectedId)}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: Invoice | null) => {
        setDetail(d ?? null)
        setDetailLoading(false)
      })
      .catch(() => setDetailLoading(false))
  }, [state.detailOpen, state.detailMode, state.selectedId, state.detailVersion])

  const isEditing = state.detailOpen && state.detailMode === 'edit'
  const recordOpen = state.detailOpen && (isEditing || !!state.selectedId)

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{t('inv.title')}</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{t('inv.subtitle')}</p>
      </div>

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>{t('common.loading')}</p>
      ) : invoices.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🧾</div>
          <p style={{ fontSize: 14 }}>{t('inv.empty')}</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 8, boxShadow: 'var(--shadow)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', minWidth: 760 }}>
          <thead>
            <tr style={{ background: '#fafafa', borderBottom: '1px solid var(--color-border)' }}>
              {[
                ['inv.col.id', 'Invoice ID'], ['inv.col.poNumber', 'PO Number'], ['inv.col.vendor', 'Vendor'],
                ['inv.col.grossAmount', 'Gross Amount'], ['inv.col.netAmount', 'Net Amount'], ['inv.col.invoiceDate', 'Invoice Date'],
                ['inv.col.matchScore', 'Match Score'], ['inv.col.payBlock', 'Pay Block'], ['inv.col.status', 'Status'],
              ].map(([k]) => (
                <th key={k} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{t(k)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv, i) => {
              const sc = STATUS_COLORS[inv.Status] || { bg: '#f0f2f5', color: '#555' }
              const score = Number(inv.MatchScore) || 0
              const isHighlighted = state.highlightedIds.includes(inv.InvoiceId)
              const isSelected = state.selectedId === inv.InvoiceId
              return (
                <tr
                  key={inv.InvoiceId}
                  onClick={() => dispatch({ type: 'OPEN_DETAIL', id: inv.InvoiceId })}
                  style={{
                    borderBottom: i < invoices.length - 1 ? '1px solid var(--color-border)' : 'none',
                    cursor: 'pointer',
                    borderLeft: isSelected ? '3px solid var(--jc-accent)' : '3px solid transparent',
                    background: isHighlighted ? 'rgba(var(--jc-accent-rgb),0.06)' : undefined,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (!isHighlighted) e.currentTarget.style.background = '#f5f8ff' }}
                  onMouseLeave={e => { e.currentTarget.style.background = isHighlighted ? 'rgba(var(--jc-accent-rgb),0.06)' : '' }}
                >
                  <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: 'var(--color-primary)' }}>
                    <CopyToChat value={inv.InvoiceId}>{inv.InvoiceId}</CopyToChat>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>
                    <CopyToChat value={inv.PONumber || ''}>{inv.PONumber || '—'}</CopyToChat>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>
                    <CopyToChat value={inv.VendorId}>{inv.VendorId}</CopyToChat>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>
                    <CopyToChat value={fmtAmt(inv.Currency, inv.GrossAmount, locale)}>{fmtAmt(inv.Currency, inv.GrossAmount, locale)}</CopyToChat>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>
                    <CopyToChat value={fmtAmt(inv.Currency, inv.NetAmount, locale)}>{fmtAmt(inv.Currency, inv.NetAmount, locale)}</CopyToChat>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>
                    <CopyToChat value={inv.InvoiceDate || ''}>{inv.InvoiceDate || '—'}</CopyToChat>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 44, height: 4, background: '#e0e2e5', borderRadius: 2 }}>
                        <div style={{ width: `${score}%`, height: '100%', background: score >= 75 ? 'var(--color-success)' : 'var(--color-warning)', borderRadius: 2 }} />
                      </div>
                      <span>{score}%</span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: 13 }}>
                    {inv.PaymentBlock
                      ? <span style={{ background: '#FEECEB', color: '#C0392B', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{t('inv.blocked')}</span>
                      : <span style={{ color: 'var(--color-text-muted)', fontSize: 11 }}>—</span>
                    }
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span style={{ ...sc, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{invoiceStatusLabel(lang, inv.Status)}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      )}

      {/* Inline record panel — read-only detail (view) or editable form (edit) */}
      {recordOpen && (
        <div style={{
          marginTop: 16,
          border: '1px solid var(--color-border)',
          borderRadius: 8,
          background: '#fff',
          boxShadow: 'var(--shadow)',
          overflow: 'hidden',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 16px',
            background: '#fafafa',
            borderBottom: '1px solid var(--color-border)',
          }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {isEditing ? t('inv.newDraft') : t('inv.detailTitle', { id: state.selectedId ?? '' })}
            </span>
            <button
              onClick={() => dispatch({ type: 'CLOSE_DETAIL' })}
              style={{
                padding: '4px 10px', borderRadius: 5,
                border: '1px solid var(--color-border)',
                background: '#fff', cursor: 'pointer', fontSize: 12,
              }}
            >
              {t('common.back')}
            </button>
          </div>

          <div style={{ padding: 16 }}>
            {isEditing ? (
              <DocumentForm />
            ) : detailLoading ? (
              <p style={{ color: 'var(--color-text-muted)' }}>{t('common.loadingDetail')}</p>
            ) : !detail ? (
              <p style={{ color: 'var(--color-text-muted)' }}>{t('common.notFound')}</p>
            ) : (
              <>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                <tbody>
                  {[
                    [t('inv.field.id'),          detail.InvoiceId],
                    [t('inv.field.poNumber'),    detail.PONumber || '—'],
                    [t('inv.field.vendor'),      detail.VendorId],
                    [t('inv.field.grossAmount'), fmtAmt(detail.Currency, detail.GrossAmount, locale)],
                    [t('inv.field.netAmount'),   fmtAmt(detail.Currency, detail.NetAmount, locale)],
                    ...(detail.TaxAmount ? [[t('inv.field.taxAmount'), fmtAmt(detail.Currency, detail.TaxAmount, locale)]] : []),
                    ...(detail.PostingDate ? [[t('inv.field.postingDate'), detail.PostingDate]] : []),
                    ...(detail.ExternalRef ? [[t('inv.field.externalRef'), detail.ExternalRef]] : []),
                    [t('inv.field.invoiceDate'), detail.InvoiceDate || '—'],
                    [t('inv.field.matchScore'),  `${Number(detail.MatchScore) || 0}%`],
                    [t('inv.field.payBlock'),    detail.PaymentBlock ? t('inv.blocked') : t('inv.payBlockNo')],
                    [t('inv.field.status'),      invoiceStatusLabel(lang, detail.Status)],
                  ].map(([label, value]) => (
                    <tr key={label} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '8px 14px', fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap', width: 160 }}>{label}</td>
                      <td style={{ padding: '8px 14px' }}>
                        <CopyToChat value={String(value)}>{value}</CopyToChat>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.MatchDetail && (() => {
                try {
                  const items: Array<{check: string; status: string; message: string}> = JSON.parse(detail.MatchDetail)
                  return (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 8 }}>{t('inv.field.matchDetail')}</div>
                      {items.map((item, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 4, fontSize: 12 }}>
                          <span style={{ color: item.status === 'PASS' ? '#188F47' : item.status === 'PARTIAL' ? '#B97B00' : '#C0392B', fontWeight: 700, minWidth: 36 }}>
                            {item.status === 'PASS' ? '✅' : item.status === 'PARTIAL' ? '⚠️' : '❌'}
                          </span>
                          <span style={{ color: 'var(--color-text-muted)', minWidth: 80 }}>{item.check}</span>
                          <span>{item.message}</span>
                        </div>
                      ))}
                    </div>
                  )
                } catch { return null }
              })()}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
