// Enum / code → display-name translations.
// The DB stores English codes (PENDING_APPROVAL, OPEN, ROH, …) unchanged; only
// the *display* is mapped here. Keep this the single source of truth for how
// a code renders, so PR / PO / Invoice pages stay consistent.
//
// Unknown codes fall back to a humanised form (underscores → spaces).

import type { Lang } from './strings'

type CodeMap = Record<string, string>

// PR status
const PR_STATUS: CodeMap = {
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED:         'Approved',
  REJECTED:         'Rejected',
  CONVERTED:        'Converted to PO',
}

// PO status
const PO_STATUS: CodeMap = {
  OPEN:       'Open',
  PARTIAL_GR: 'Partial GR',
  FULLY_GR:   'Fully GR',
  CLOSED:     'Closed',
}

// Invoice status
const INVOICE_STATUS: CodeMap = {
  PENDING: 'Pending',
  MATCHED: 'Matched',
  PARTIAL: 'Partial',
  BLOCKED: 'Blocked',
  PAID:    'Paid',
}

// Audit finding severities
const SEVERITY: CodeMap = {
  critical: 'Critical',
  high:     'High',
  medium:   'Medium',
  low:      'Low',
  info:     'Info',
}

// Audit action tags (policy violations)
const AUDIT_ACTION: CodeMap = {
  COMPLIANCE_BLOCKED:    'Compliance Blocked',
  POLICY_BYPASS_ATTEMPT: 'Policy Bypass Attempt',
}

function humanise(code: string): string {
  return code.replace(/_/g, ' ')
}

function lookup(map: CodeMap, _lang: Lang, code: string): string {
  return map[code] ?? humanise(code)
}

export function prStatusLabel(lang: Lang, code: string): string {
  return lookup(PR_STATUS, lang, code)
}
export function poStatusLabel(lang: Lang, code: string): string {
  return lookup(PO_STATUS, lang, code)
}
export function invoiceStatusLabel(lang: Lang, code: string): string {
  return lookup(INVOICE_STATUS, lang, code)
}
export function severityLabel(lang: Lang, code: string): string {
  return lookup(SEVERITY, lang, code)
}
export function auditActionLabel(lang: Lang, code: string): string {
  return lookup(AUDIT_ACTION, lang, code)
}
