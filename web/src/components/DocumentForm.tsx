import { useState } from 'react'
import { useDocument } from '../contexts/DocumentContext'
import { dirtyFieldKeys, getPanelSessionId } from '../contexts/documentModel'
import { useT, type TFn } from '../i18n/LanguageContext'

// DocumentForm — the editable (mode='edit') face of the record view.
// It renders the live formFields the agent populates via ui_action OPEN_FORM /
// SET_FORM_FIELDS. Fields stay editable; a user edit marks the field dirty
// (value diverges from formBaseline). The Save button appears ONLY when there
// are unsaved edits. Both the agent (save_pr_draft) and the user (this button →
// /form/save) can persist the draft; either path aligns the baseline, clearing
// the dirty marks.
//
// The field set is generic (label + value) so the same component serves PR / PO
// / invoice drafts — the agent decides which keys to send.

// The agent commonly sends these PR draft keys; each maps to a `form.field.<key>`
// i18n string. Unknown keys fall back to a de-camelCased label so nothing is
// ever hidden.
const KNOWN_FIELD_KEYS = new Set([
  'materialId', 'description', 'quantity', 'unit', 'estimatedPrice',
  'currency', 'costCenterId', 'vendorId', 'requiredBy', 'requiredDate',
])

// Preferred display order; any extra keys are appended alphabetically.
const FIELD_ORDER = [
  'materialId', 'description', 'quantity', 'unit', 'estimatedPrice',
  'currency', 'costCenterId', 'vendorId', 'requiredBy', 'requiredDate',
]

function labelFor(t: TFn, key: string): string {
  if (KNOWN_FIELD_KEYS.has(key)) return t(`form.field.${key}`)
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())
}

function orderedKeys(fields: Record<string, unknown>): string[] {
  const keys = Object.keys(fields)
  const known = FIELD_ORDER.filter(k => keys.includes(k))
  const extra = keys.filter(k => !FIELD_ORDER.includes(k)).sort()
  return [...known, ...extra]
}

const KIND_KEY: Record<string, string> = { pr: 'form.kind.pr', po: 'form.kind.po', invoice: 'form.kind.invoice' }

export default function DocumentForm() {
  const { state, dispatch } = useDocument()
  const t = useT()
  const { formFields, formDraftId, detailKind } = state
  const keys = orderedKeys(formFields)
  const dirty = new Set(dirtyFieldKeys(state))
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  // User edit → EDIT_FORM_FIELD (marks dirty; baseline unchanged).
  const onChange = (key: string, value: string) => {
    setSavedMsg(null)
    dispatch({ type: 'EDIT_FORM_FIELD', key, value })
  }

  const onSave = async () => {
    setSaving(true)
    setSavedMsg(null)
    try {
      const res = await fetch(`/api/panel/${encodeURIComponent(getPanelSessionId())}/form/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Panel-Source': 'browser-save' },
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)
      // Server pushes the committed state via SSE (baseline aligned → dirty cleared).
      // Also commit locally so the button hides instantly without waiting for SSE.
      dispatch({ type: 'COMMIT_FORM', draftId: data.draftId })
      setSavedMsg(t('form.saved', { id: data.draftId }))
    } catch (e) {
      setSavedMsg(`⚠️ ${e instanceof Error ? e.message : t('form.saveFailed')}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: 'var(--jc-accent)', background: 'rgba(var(--jc-accent-rgb),0.08)',
          padding: '2px 8px', borderRadius: 6,
        }}>
          {t('form.draftEditing')}
        </span>
        {formDraftId && (
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{formDraftId}</span>
        )}
        {dirty.size > 0 && (
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--jc-amber, #B7791F)' }}>
            {t(dirty.size > 1 ? 'form.unsavedChanges' : 'form.unsavedChange', { n: dirty.size })}
          </span>
        )}
      </div>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 16 }}>
        {t('form.draftHint', { kind: t(KIND_KEY[detailKind ?? 'pr'] ?? 'form.kind.document') })}
      </p>

      {keys.length === 0 ? (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
          {t('form.noFields')}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {keys.map(key => {
            const isDirty = dirty.has(key)
            return (
              <label key={key} style={{ display: 'grid', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {labelFor(t, key)}
                  {isDirty && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--jc-amber, #B7791F)' }}>{t('form.modified')}</span>
                  )}
                </span>
                <input
                  value={String(formFields[key] ?? '')}
                  onChange={e => onChange(key, e.target.value)}
                  style={{
                    padding: '8px 12px', borderRadius: 6, fontSize: 13,
                    border: `1px solid ${isDirty ? 'var(--jc-amber, #B7791F)' : 'var(--color-border)'}`,
                    background: isDirty ? 'rgba(183,121,31,0.05)' : '#fff',
                  }}
                />
              </label>
            )
          })}
        </div>
      )}

      {/* Save row — button shown ONLY when there are unsaved edits. */}
      {(dirty.size > 0 || savedMsg) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
          {dirty.size > 0 && (
            <button
              onClick={onSave}
              disabled={saving}
              style={{
                padding: '8px 20px', borderRadius: 6, border: 'none',
                background: saving ? 'var(--color-border)' : 'var(--jc-accent)',
                color: '#fff', fontSize: 13, fontWeight: 600,
                cursor: saving ? 'default' : 'pointer',
              }}
            >
              {saving ? t('form.saving') : t('form.save')}
            </button>
          )}
          {savedMsg && (
            <span style={{ fontSize: 12, color: savedMsg.startsWith('⚠️') ? 'var(--jc-red, #C0392B)' : 'var(--color-text-muted)' }}>
              {savedMsg}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
