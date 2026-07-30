import { useEffect, useState } from 'react'
import { useDocument } from '../contexts/DocumentContext'
import { useLanguage } from '../i18n/LanguageContext'
import { poStatusLabel } from '../i18n/enums'
import CopyToChat from '../components/CopyToChat'
import InlineDetail from '../components/InlineDetail'
import DocumentForm from '../components/DocumentForm'

interface PO {
  PONumber: string
  PRNumber: string
  VendorId: string
  Description: string
  OrderedQty: number
  Unit: string
  NetPrice: number
  Currency: string
  Status: string
  OrderDate: string
  DeliveryDate: string
  GRQty: number
  InvoicedAmt: number
  S4PONumber: string
}

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  OPEN:       { bg: '#EBF3FF', color: '#0070F2' },
  PARTIAL_GR: { bg: '#FFF4E5', color: '#E76500' },
  FULLY_GR:   { bg: '#E8F5E9', color: '#188F47' },
  CLOSED:     { bg: '#f0f2f5', color: '#6B7280' },
}

function fmtPrice(currency: string, price: number, locale: string) {
  return `${currency} ${Number(price).toLocaleString(locale, { minimumFractionDigits: 2 })}`
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-text-muted)' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>📦</div>
      <p style={{ fontSize: 14 }}>{message}</p>
    </div>
  )
}

export default function POListPage() {
  const { state, dispatch } = useDocument()
  const { t, lang, locale } = useLanguage()
  const [pos, setPOs] = useState<PO[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<PO | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    const filterParam = state.filters['Status']
      ? `?status=${state.filters['Status']}`
      : ''
    fetch(`/api/purchase-orders${filterParam}`)
      .then(r => r.json())
      .then(d => { setPOs(d.value || []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [state.filters, state.listVersion])

  useEffect(() => {
    if (!state.detailOpen || state.detailMode === 'edit' || !state.selectedId) {
      setDetail(null)
      return
    }
    setDetailLoading(true)
    fetch(`/api/purchase-orders/${encodeURIComponent(state.selectedId)}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: PO | null) => {
        setDetail(d ?? null)
        setDetailLoading(false)
      })
      .catch(() => setDetailLoading(false))
  }, [state.detailOpen, state.detailMode, state.selectedId, state.detailVersion])

  const isEditing = state.detailOpen && state.detailMode === 'edit'
  const detailOpen = state.detailOpen && (isEditing || !!state.selectedId)

  const listContent = (
    <>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{t('po.title')}</h1>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{t('po.subtitle')}</p>
      </div>

      {loading ? (
        <p style={{ color: 'var(--color-text-muted)' }}>{t('common.loading')}</p>
      ) : pos.length === 0 ? (
        <EmptyState message={t('po.empty')} />
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: 8, boxShadow: 'var(--shadow)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', minWidth: 720 }}>
            <thead>
              <tr style={{ background: '#fafafa', borderBottom: '1px solid var(--color-border)' }}>
                {[
                  ['po.col.number', 'PO Number'], ['po.col.sourcePr', 'Source PR'], ['po.col.vendor', 'Vendor'],
                  ['po.col.description', 'Description'], ['po.col.ordered', 'Ordered'], ['po.col.grQty', 'GR Qty'],
                  ['po.col.netPrice', 'Net Price'], ['po.col.deliveryDate', 'Delivery Date'], ['po.col.status', 'Status'],
                ].map(([k]) => (
                  <th key={k} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{t(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pos.map((po, i) => {
                const sc = STATUS_COLORS[po.Status] || { bg: '#f0f2f5', color: '#555' }
                const grPct = po.OrderedQty > 0 ? Math.round((po.GRQty / po.OrderedQty) * 100) : 0
                const isHighlighted = state.highlightedIds.includes(po.PONumber)
                const isSelected = state.selectedId === po.PONumber
                return (
                  <tr
                    key={po.PONumber}
                    onClick={() => dispatch({ type: 'OPEN_DETAIL', id: po.PONumber })}
                    style={{
                      borderBottom: i < pos.length - 1 ? '1px solid var(--color-border)' : 'none',
                      cursor: 'pointer',
                      borderLeft: isSelected ? '3px solid var(--jc-accent)' : '3px solid transparent',
                      background: isHighlighted ? 'rgba(var(--jc-accent-rgb),0.06)' : undefined,
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => { if (!isHighlighted) e.currentTarget.style.background = '#f5f8ff' }}
                    onMouseLeave={e => { e.currentTarget.style.background = isHighlighted ? 'rgba(var(--jc-accent-rgb),0.06)' : '' }}
                  >
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600, color: 'var(--color-primary)' }}>
                      <CopyToChat value={po.PONumber}>{po.PONumber}</CopyToChat>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13 }}>
                      <CopyToChat value={po.PRNumber || ''}>{po.PRNumber || '—'}</CopyToChat>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13 }}>
                      <CopyToChat value={po.VendorId}>{po.VendorId}</CopyToChat>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13 }}>
                      <CopyToChat value={po.Description || ''}>{po.Description || '—'}</CopyToChat>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13 }}>
                      <CopyToChat value={`${po.OrderedQty} ${po.Unit}`}>{po.OrderedQty} {po.Unit}</CopyToChat>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 50, height: 4, background: '#e0e2e5', borderRadius: 2 }}>
                          <div style={{ width: `${grPct}%`, height: '100%', background: grPct >= 100 ? 'var(--color-success)' : 'var(--color-warning)', borderRadius: 2 }} />
                        </div>
                        <span>{po.GRQty}/{po.OrderedQty}</span>
                      </div>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13 }}>
                      <CopyToChat value={fmtPrice(po.Currency, po.NetPrice, locale)}>{fmtPrice(po.Currency, po.NetPrice, locale)}</CopyToChat>
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 13 }}>
                      <CopyToChat value={po.DeliveryDate || ''}>{po.DeliveryDate || '—'}</CopyToChat>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ ...sc, padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>
                        {po.Status ? poStatusLabel(lang, po.Status) : '—'}
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
                [t('po.field.number'),       detail.PONumber],
                [t('po.field.sourcePr'),     detail.PRNumber || '—'],
                [t('po.field.vendor'),       detail.VendorId],
                [t('po.field.description'),  detail.Description || '—'],
                [t('po.field.orderedQty'),   `${detail.OrderedQty} ${detail.Unit}`],
                [t('po.field.grQty'),        String(detail.GRQty)],
                [t('po.field.invoicedAmt'),  fmtPrice(detail.Currency, detail.InvoicedAmt || 0, locale)],
                [t('po.field.netPrice'),     fmtPrice(detail.Currency, detail.NetPrice, locale)],
                [t('po.field.status'),       poStatusLabel(lang, detail.Status)],
                [t('po.field.orderDate'),    detail.OrderDate || '—'],
                [t('po.field.deliveryDate'), detail.DeliveryDate || '—'],
                ...(detail.S4PONumber ? [[t('po.field.s4Number'), detail.S4PONumber]] : []),
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

          {/* GR progress bar */}
          {detail.OrderedQty > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', marginBottom: 4 }}>
                {t('po.grProgress')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, height: 6, background: '#e0e2e5', borderRadius: 3 }}>
                  <div style={{
                    width: `${Math.min(Math.round((detail.GRQty / detail.OrderedQty) * 100), 100)}%`,
                    height: '100%',
                    background: detail.GRQty >= detail.OrderedQty ? 'var(--color-success)' : 'var(--color-warning)',
                    borderRadius: 3,
                  }} />
                </div>
                <span style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                  {detail.GRQty} / {detail.OrderedQty} {detail.Unit}
                </span>
              </div>
            </div>
          )}

          {detail.S4PONumber && (
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
        </>
      )}
    </>
  )

  return (
    <InlineDetail
      open={detailOpen}
      title={isEditing ? t('po.newDraft') : t('po.detailTitle', { id: state.selectedId ?? '' })}
      onClose={() => dispatch({ type: 'CLOSE_DETAIL' })}
      list={listContent}
    >
      {isEditing ? <DocumentForm /> : detailContent}
    </InlineDetail>
  )
}
