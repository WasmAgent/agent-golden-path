// Tool implementations — the procurement domain logic the agent calls.
//
// Every function reads and writes the in-memory store (src/store.ts). They run
// fully offline against seed data, which is all the golden path needs to
// demonstrate the evidence chain end to end. Swap the store for a real ERP
// client without touching the agent/evidence chain that consumes these tools.

import * as store from '../store'
import { logEvent } from '../audit'

const log = console

let _draftSeq = 1
function _newDraftId(): string {
  return `DR-${String(Date.now()).slice(-6)}${String(_draftSeq++).padStart(2, '0')}`
}

function _fiscalYear(): string {
  return String(new Date().getFullYear())
}

interface ToolCtx { userId?: string; ip?: string }

export async function executeTool(name: string, args: Record<string, any>, ctx: ToolCtx = {}): Promise<{ result: any }> {
  const userId = ctx.userId || 'demo_user'
  try {
    switch (name) {
      case 'search_materials':           return _searchMaterials(args)
      case 'search_vendors':             return _searchVendors(args)
      case 'get_cost_centre':            return _getCostCentre(args)
      case 'check_budget':               return _checkBudget(args)
      case 'save_pr_draft':              return _savePrDraft(args, userId)
      case 'get_pr_draft':               return _getPrDraft(args)
      case 'suggest_pr_fields':          return _suggestPrFields(args)
      case 'run_compliance_checks':      return _runComplianceChecks(args, userId)
      case 'submit_pr':                  return _submitPr(args, userId, ctx.ip)
      case 'list_purchase_requisitions': return _listPRs(args)
      case 'get_pr_detail':              return _getPRDetail(args)
      case 'list_purchase_orders':       return _listPOs(args)
      case 'get_po_detail':              return _getPODetail(args)
      case 'list_invoices':              return _listInvoices(args)
      case 'run_invoice_match':          return _runInvoiceMatch(args, userId)
      case 'convert_pr_to_po':           return _convertPrToPo(args, userId, ctx.ip)
      case 'get_audit_log':              return _getAuditLog(args)
      case 'search_catalog_price':       return _searchCatalogPrice(args)
      default:
        return { result: { error: `Unknown tool: ${name}` } }
    }
  } catch (e: any) {
    log.error(`[tool] ${name} error:`, e.message)
    return { result: { error: e.message } }
  }
}

function _like(hay: string | undefined, needle: string): boolean {
  return (hay || '').toLowerCase().includes(needle.toLowerCase())
}

async function _searchMaterials({ query }: any) {
  const q = String(query || '')
  const materials = store.materials().filter(m => _like(m.Description, q) || _like(m.MaterialId, q)).slice(0, 10)
  return { result: { source: 'local', materials } }
}

async function _searchVendors({ query }: any) {
  const q = String(query || '')
  const vendors = store.vendors().filter(v => !v.IsDeleted && (_like(v.Name, q) || _like(v.VendorId, q))).slice(0, 10)
  return { result: { source: 'local', vendors } }
}

async function _getCostCentre({ costCentreId }: any) {
  const row = store.findCostCenter(costCentreId)
  if (!row) return { result: { found: false, costCentreId } }
  const today = new Date().toISOString().slice(0, 10)
  const expired = !!(row.ValidTo && row.ValidTo < today)
  return { result: { found: true, ...row, expired } }
}

async function _checkBudget({ costCentreId, estimatedAmount }: any) {
  const row = store.findBudget(costCentreId, _fiscalYear())
  if (!row) return { result: { found: false, costCentreId, message: 'No budget record found for this cost centre / fiscal year.' } }
  const remaining = row.TotalBudget - row.UsedBudget
  const utilizationPct = row.TotalBudget > 0 ? Number(((row.UsedBudget / row.TotalBudget) * 100).toFixed(1)) : 0
  const wouldExceed = estimatedAmount != null && estimatedAmount > remaining
  const nearLimit = !wouldExceed && estimatedAmount != null && (row.UsedBudget + estimatedAmount) / row.TotalBudget > 0.8
  return { result: { found: true, costCentreId, fiscalYear: row.FiscalYear, totalBudget: row.TotalBudget, usedBudget: row.UsedBudget, remaining, currency: row.Currency, utilizationPct, estimatedAmount: estimatedAmount || null, wouldExceed, nearLimit, status: wouldExceed ? 'EXCEEDED' : nearLimit ? 'NEAR_LIMIT' : 'OK' } }
}

async function _savePrDraft(args: any, userId: string) {
  const now = new Date().toISOString()
  const existing = args.draftId ? store.findDraft(args.draftId) : null

  let resolvedDescription = args.description || existing?.Description
  if (!resolvedDescription) {
    const matId = args.materialId || existing?.MaterialId
    if (matId) {
      const mat = store.findMaterial(matId)
      if (mat) resolvedDescription = mat.Description
    }
  }

  const fields = {
    MaterialId:     args.materialId     || existing?.MaterialId,
    Description:    resolvedDescription,
    Quantity:       args.quantity       ?? existing?.Quantity,
    Unit:           args.unit           || existing?.Unit,
    EstimatedPrice: args.estimatedPrice ?? existing?.EstimatedPrice,
    Currency:       args.currency       || existing?.Currency || 'USD',
    CostCenterId:   args.costCentreId   || existing?.CostCenterId,
    VendorId:       args.vendorId       || existing?.VendorId,
    RequiredDate:   args.requiredDate   || existing?.RequiredDate,
    UpdatedAt:      now,
  }

  if (existing) {
    Object.assign(existing, fields)
    return { result: { draftId: existing.DraftId, action: 'updated', draft: existing } }
  }

  const draftId = _newDraftId()
  const draft = { DraftId: draftId, CreatedBy: userId, CreatedAt: now, ...fields }
  store.insertDraft(draft)
  return { result: { draftId, action: 'created', draft } }
}

async function _getPrDraft({ draftId }: any) {
  const row = store.findDraft(draftId)
  if (!row) return { result: { found: false, draftId } }
  return { result: { found: true, draft: row } }
}

async function _suggestPrFields({ description, materialId, missingFields }: any) {
  const tokens: string[] = []
  if (description) {
    String(description).toLowerCase().split(/\s+/).filter((w: string) => w.length >= 3).forEach((t: string) => tokens.push(t))
  }
  if (materialId) tokens.push(String(materialId).toLowerCase())
  if (tokens.length === 0) return { result: { suggestions: null, reason: 'no keywords to match' } }

  const rows = [...store.purchaseRequisitions()].sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || '')).slice(0, 200)

  const scored = rows.map((pr) => {
    const haystack = `${(pr.Description || '').toLowerCase()} ${(pr.MaterialId || '').toLowerCase()}`
    const exactId = materialId && pr.MaterialId && pr.MaterialId.toLowerCase() === String(materialId).toLowerCase()
    const stemHits = tokens.filter((t: string) => { const stem = t.slice(0, 4); return haystack.includes(t) || (stem.length >= 4 && haystack.includes(stem)) }).length
    const hits = (exactId ? 10 : 0) + stemHits
    return { pr, hits }
  }).filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits || (b.pr.CreatedAt || '').localeCompare(a.pr.CreatedAt || ''))

  if (scored.length === 0) return { result: { suggestions: null, reason: 'no matching historical PRs found' } }

  const want = new Set<string>(missingFields || ['costCentreId', 'vendorId', 'estimatedPrice', 'unit', 'currency'])
  const suggestions: Record<string, any> = {}
  const sources: Record<string, string> = {}

  for (const { pr } of scored) {
    if (want.has('costCentreId') && pr.CostCenterId && !suggestions.costCentreId) { suggestions.costCentreId = pr.CostCenterId; sources.costCentreId = pr.PRNumber }
    if (want.has('vendorId') && pr.VendorId && !suggestions.vendorId) { suggestions.vendorId = pr.VendorId; sources.vendorId = pr.PRNumber }
    if (want.has('estimatedPrice') && pr.EstimatedPrice != null && !suggestions.estimatedPrice) { suggestions.estimatedPrice = pr.EstimatedPrice; sources.estimatedPrice = pr.PRNumber }
    if (want.has('currency') && pr.Currency && !suggestions.currency) { suggestions.currency = pr.Currency; sources.currency = pr.PRNumber }
    else if (want.has('estimatedPrice') && suggestions.estimatedPrice && !suggestions.currency) { suggestions.currency = pr.Currency || 'USD' }
    if (want.has('unit') && pr.Unit && !suggestions.unit) { suggestions.unit = pr.Unit; sources.unit = pr.PRNumber }
    if (Object.keys(suggestions).length >= want.size) break
  }

  if (Object.keys(suggestions).length === 0) return { result: { suggestions: null, reason: 'matching PRs found but none had the required fields' } }

  const enriched: Record<string, any> = { ...suggestions }
  if (suggestions.costCentreId) {
    const cc = store.findCostCenter(suggestions.costCentreId)
    if (cc) enriched.costCentreDescription = cc.Description
  }
  if (suggestions.vendorId) {
    const v = store.findVendor(suggestions.vendorId)
    if (v) enriched.vendorName = v.Name
  }

  return { result: { suggestions: enriched, sources, matchedPRCount: scored.length, topMatch: scored[0].pr.PRNumber } }
}

async function _runComplianceChecks({ draftId }: any, userId = 'demo_user') {
  const draft = store.findDraft(draftId)
  if (!draft) return { result: { error: 'Draft not found', draftId } }

  const checks: any[] = []
  const missing: string[] = []
  if (!draft.MaterialId && !draft.Description) missing.push('material or description')
  if (!draft.Quantity) missing.push('quantity')
  if (!draft.Unit) missing.push('unit of measure')
  if (!draft.CostCenterId) missing.push('cost centre')
  if (!draft.RequiredDate) missing.push('required delivery date')
  checks.push({ rule: 'required_fields', label: 'Required Fields', status: missing.length ? 'BLOCKED' : 'PASSED', message: missing.length ? `Missing: ${missing.join(', ')}` : 'All required fields present' })

  if (draft.VendorId) {
    const vendor = store.findVendor(draft.VendorId)
    if (!vendor) checks.push({ rule: 'vendor_whitelist', label: 'Vendor Whitelist', status: 'BLOCKED', message: `Vendor ${draft.VendorId} not found in approved vendor list` })
    else if (vendor.IsBlocked) checks.push({ rule: 'vendor_whitelist', label: 'Vendor Whitelist', status: 'BLOCKED', message: `Vendor "${vendor.Name}" is blocked and cannot be used` })
    else checks.push({ rule: 'vendor_whitelist', label: 'Vendor Whitelist', status: 'PASSED', message: `Vendor "${vendor.Name}" is approved` })
  }

  if (draft.CostCenterId) {
    const cc = store.findCostCenter(draft.CostCenterId)
    const today = new Date().toISOString().slice(0, 10)
    if (!cc) checks.push({ rule: 'cost_centre_validity', label: 'Cost Centre Validity', status: 'BLOCKED', message: `Cost centre ${draft.CostCenterId} not found` })
    else if (!cc.IsActive || (cc.ValidTo && cc.ValidTo < today)) checks.push({ rule: 'cost_centre_validity', label: 'Cost Centre Validity', status: 'BLOCKED', message: `Cost centre "${cc.Description}" is expired or inactive` })
    else checks.push({ rule: 'cost_centre_validity', label: 'Cost Centre Validity', status: 'PASSED', message: `Cost centre "${cc.Description}" is valid` })
  }

  if (draft.CostCenterId && draft.EstimatedPrice && draft.Quantity) {
    const total = draft.EstimatedPrice * draft.Quantity
    const budgetResult = await _checkBudget({ costCentreId: draft.CostCenterId, estimatedAmount: total })
    const b = budgetResult.result
    if (!b.found) checks.push({ rule: 'budget', label: 'Budget', status: 'WARNING', message: 'No budget record found — proceed with caution' })
    else if (b.wouldExceed) checks.push({ rule: 'budget', label: 'Budget', status: 'BLOCKED', message: `Estimated total ${b.currency} ${total.toFixed(2)} exceeds remaining budget of ${b.currency} ${b.remaining.toFixed(2)}` })
    else if (b.nearLimit) checks.push({ rule: 'budget', label: 'Budget', status: 'WARNING', message: `Budget utilisation will reach ${((b.usedBudget + total) / b.totalBudget * 100).toFixed(1)}% after this PR` })
    else checks.push({ rule: 'budget', label: 'Budget', status: 'PASSED', message: `Remaining ${b.currency} ${(b.remaining ?? 0).toFixed(2)} — sufficient for ${b.currency} ${total.toFixed(2)}` })
  }

  // --- ComplianceVerifier integration (@wasmagent/compliance) ---
  // Serialise the draft as a virtual "draft.json" file so the file-based
  // DeterministicVerifier can run format/state constraints against it.
  // Wrapped in try/catch so any import or runtime failure falls back silently.
  let complianceViolations: any[] = []
  try {
    const { ComplianceVerifier } = await import('@wasmagent/compliance')
    const { VerificationPipeline, DeterministicVerifier } = await import('@wasmagent/core')

    const draftJson = JSON.stringify(draft)
    const ws = {
      readFile:  async (path: string): Promise<string>  => { if (path === 'draft.json') return draftJson; throw new Error(`File not found: ${path}`) },
      fileExists: async (path: string): Promise<boolean> => path === 'draft.json',
      fileSize:  async (path: string): Promise<number>  => { if (path === 'draft.json') return Buffer.byteLength(draftJson, 'utf8'); throw new Error(`File not found: ${path}`) },
    }

    const pipeline = new VerificationPipeline({ ws, verifiers: [new DeterministicVerifier()] })
    const verifier = new ComplianceVerifier({ pipeline })

    // Minimal TaskSpec — format/state constraints not already covered by the
    // checks above. Constraints use file_matches against the draft JSON so the
    // DeterministicVerifier can evaluate them without extra I/O.
    const taskSpec = {
      id:   `pr-draft-${draftId}`,
      intent: 'validate_pr_draft',
      language: 'en',
      priority_hierarchy: ['system_policy', 'user_explicit_constraints'],
      constraints: [
        { id: 'currency_iso', description: 'Currency must be a 3-letter ISO 4217 code', verify_method: 'file_matches', path: 'draft.json', arg: '"Currency":"[A-Z]{3}"', level: 'hard', priority: 70, category: 'format' },
        { id: 'price_positive', description: 'EstimatedPrice must be a positive number', verify_method: 'file_matches', path: 'draft.json', arg: '"EstimatedPrice":[1-9]', level: 'soft', priority: 60, category: 'state' },
        { id: 'required_date_format', description: 'RequiredDate must be an ISO date (YYYY-MM-DD)', verify_method: 'file_matches', path: 'draft.json', arg: '"RequiredDate":"[0-9]{4}-[0-9]{2}-[0-9]{2}"', level: 'hard', priority: 75, category: 'format' },
      ],
    }

    const cvResult = await verifier.verify(taskSpec as any, { stage: 'post_tool_call' })
    complianceViolations = cvResult.violations

    for (const v of complianceViolations) {
      if (!checks.some((c: any) => c.rule === v.constraint_id)) {
        checks.push({
          rule: v.constraint_id,
          label: v.constraint_id.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
          status: v.level === 'hard' ? 'BLOCKED' : 'WARNING',
          message: v.hint,
        })
      }
    }
  } catch (e: any) {
    log.warn('[tool] ComplianceVerifier integration failed (non-fatal):', e.message)
  }
  // --- end ComplianceVerifier integration ---

  const hasBlocked = checks.some((c: any) => c.status === 'BLOCKED')
  const hasWarning = checks.some((c: any) => c.status === 'WARNING')
  draft.ComplianceCheckedAt = new Date().toISOString()

  if (hasBlocked) {
    const blockedRules = checks.filter((c: any) => c.status === 'BLOCKED').map((c: any) => c.rule).join(', ')
    await logEvent({ userId, action: 'COMPLIANCE_BLOCKED', entityType: 'PRDraft', entityId: draftId, details: { blockedRules, checks: checks.filter((c: any) => c.status === 'BLOCKED') }, success: false, errorMessage: `Blocked rules: ${blockedRules}` })
  }

  return { result: { draftId, checks, canSubmit: !hasBlocked, overallStatus: hasBlocked ? 'BLOCKED' : hasWarning ? 'WARNING' : 'PASSED', complianceViolations } }
}

async function _submitPr({ draftId }: any, userId: string, ip?: string) {
  const draft = store.findDraft(draftId)
  if (!draft) return { result: { error: 'Draft not found', draftId } }

  // A submit without a prior compliance check is a policy bypass — recorded as
  // evidence even when the submit itself is allowed to proceed.
  const policyBypass = !draft.ComplianceCheckedAt
  const complianceResult = await _runComplianceChecks({ draftId })
  if (!complianceResult.result.canSubmit) {
    return { result: { error: 'Cannot submit — compliance checks failed', checks: complianceResult.result.checks } }
  }

  const prNumber = store.nextPRNumber()
  const now = new Date().toISOString()

  store.insertPR({ PRNumber: prNumber, MaterialId: draft.MaterialId, Description: draft.Description, Quantity: draft.Quantity, Unit: draft.Unit, EstimatedPrice: draft.EstimatedPrice, Currency: draft.Currency || 'USD', CostCenterId: draft.CostCenterId, VendorId: draft.VendorId, RequiredDate: draft.RequiredDate, Status: 'PENDING_APPROVAL', CreatedBy: userId, CreatedAt: now, SubmittedAt: now })
  store.deleteDraft(draftId)

  let vendorName: string | null = null
  if (draft.VendorId) {
    const v = store.findVendor(draft.VendorId)
    vendorName = v?.Name || null
  }

  await logEvent({ userId, action: 'SUBMIT_PR', entityType: 'PR', entityId: prNumber, details: { draftId, policyBypass }, ipAddress: ip })

  if (policyBypass) {
    await logEvent({ userId, action: 'POLICY_BYPASS_ATTEMPT', entityType: 'PR', entityId: prNumber, details: { rule: 'unguarded_write', description: 'submit_pr called without prior run_compliance_checks in same session', draftId }, ipAddress: ip, success: false })
  }

  return { result: { prNumber, policyBypass, status: 'PENDING_APPROVAL', vendorId: draft.VendorId || null, vendorName, message: `PR ${prNumber} created and submitted for approval.` } }
}

async function _listPRs({ status, limit }: any = {}) {
  let rows = [...store.purchaseRequisitions()].sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''))
  if (status && status !== 'ALL') rows = rows.filter(p => p.Status === status)
  rows = rows.slice(0, limit || 20)
  return { result: { source: 'local', prs: rows, count: rows.length } }
}

async function _getPRDetail({ prNumber }: any) {
  const row = store.findPR(prNumber)
  if (!row) return { result: { found: false, prNumber } }
  return { result: { found: true, pr: row } }
}

async function _listPOs({ status, vendorId, limit }: any = {}) {
  let rows = [...store.purchaseOrders()].sort((a, b) => (b.OrderDate || '').localeCompare(a.OrderDate || ''))
  if (status && status !== 'ALL') rows = rows.filter(p => p.Status === status)
  if (vendorId) rows = rows.filter(p => p.VendorId === vendorId)
  rows = rows.slice(0, limit || 20)
  return { result: { source: 'local', pos: rows, count: rows.length } }
}

async function _getPODetail({ poNumber }: any) {
  const row = store.findPO(poNumber)
  if (!row) return { result: { found: false, poNumber } }
  const grs = store.goodsReceipts().filter(g => g.PONumber === poNumber)
  return { result: { source: 'local', found: true, po: row, goodsReceipts: grs } }
}

async function _listInvoices({ status, paymentBlock, limit }: any = {}) {
  let rows = [...store.supplierInvoices()].sort((a, b) => (b.InvoiceDate || '').localeCompare(a.InvoiceDate || ''))
  if (status && status !== 'ALL') rows = rows.filter(i => i.Status === status)
  if (paymentBlock === true) rows = rows.filter(i => i.PaymentBlock === true)
  rows = rows.slice(0, limit || 20)
  return { result: { source: 'local', invoices: rows, count: rows.length } }
}

async function _runInvoiceMatch({ invoiceId }: any, userId: string) {
  const inv = store.findInvoice(invoiceId)
  if (!inv) return { result: { error: 'Invoice not found', invoiceId } }
  const po = inv.PONumber ? store.findPO(inv.PONumber) : null

  let matchScore = 0
  const details: any[] = []

  if (!po) {
    details.push({ check: 'PO reference', status: 'FAIL', message: 'No linked PO found' })
  } else {
    const poTotal = Number(po.NetPrice || 0) * Number(po.OrderedQty || 1)
    const invNet = Number(inv.NetAmount || 0)
    const priceDiff = Math.abs(invNet - poTotal)
    const pricePct = poTotal > 0 ? (priceDiff / poTotal) * 100 : 100
    if (pricePct <= 2) { matchScore += 50; details.push({ check: 'Price match', status: 'PASS', message: `Invoice $${invNet.toFixed(2)} vs PO $${poTotal.toFixed(2)} (diff ${pricePct.toFixed(1)}%)` }) }
    else { details.push({ check: 'Price match', status: 'FAIL', message: `Price variance ${pricePct.toFixed(1)}% exceeds 2% tolerance` }) }

    const grQty = po.GRQty || 0
    const orderedQty = po.OrderedQty || 0
    if (grQty >= orderedQty) { matchScore += 50; details.push({ check: 'Goods receipt', status: 'PASS', message: `GR quantity ${grQty} covers ordered ${orderedQty}` }) }
    else if (grQty > 0) { matchScore += 25; details.push({ check: 'Goods receipt', status: 'PARTIAL', message: `Only ${grQty} of ${orderedQty} received` }) }
    else { details.push({ check: 'Goods receipt', status: 'FAIL', message: 'No goods receipt posted yet' }) }
  }

  const paymentBlock = matchScore < 75
  inv.MatchScore = matchScore
  inv.MatchDetail = JSON.stringify(details)
  inv.PaymentBlock = paymentBlock
  inv.Status = matchScore >= 75 ? 'MATCHED' : 'PARTIAL'
  await logEvent({ userId, action: 'INVOICE_MATCH', entityType: 'Invoice', entityId: invoiceId, details: { matchScore, paymentBlock } })
  return { result: { invoiceId, matchScore, paymentBlock, details, status: inv.Status } }
}

async function _getAuditLog({ fromDate, toDate, limit }: any = {}) {
  let rows = [...store.auditLog()].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
  if (fromDate) rows = rows.filter(r => r.timestamp >= `${fromDate}T00:00:00Z`)
  if (toDate)   rows = rows.filter(r => r.timestamp <= `${toDate}T23:59:59Z`)
  rows = rows.slice(0, limit || 50)
  return { result: { logs: rows, count: rows.length } }
}

async function _convertPrToPo({ prNumber, vendorId, deliveryDate }: any, userId: string, ip?: string) {
  const pr = store.findPR(prNumber)
  if (!pr) return { result: { error: 'PR not found', prNumber } }
  if (pr.Status !== 'APPROVED') return { result: { error: `PR ${prNumber} is not approved (status: ${pr.Status}). Only approved PRs can be converted to POs.` } }

  const resolvedVendor = vendorId || pr.VendorId
  if (!resolvedVendor) return { result: { error: 'Vendor ID is required to create a PO. Please provide a vendor.' } }

  const now = new Date().toISOString()
  const poNumber = store.nextPONumber()

  store.insertPO({ PONumber: poNumber, PRNumber: prNumber, VendorId: resolvedVendor, Description: pr.Description, MaterialId: pr.MaterialId, CostCenterId: pr.CostCenterId, OrderedQty: pr.Quantity, Unit: pr.Unit, NetPrice: pr.EstimatedPrice, Currency: pr.Currency || 'USD', Status: 'OPEN', OrderDate: now, DeliveryDate: deliveryDate || pr.RequiredDate, GRQty: 0, InvoicedAmt: 0 })
  pr.Status = 'CONVERTED'
  pr.PONumber = poNumber
  await logEvent({ userId, action: 'CONVERT_PR_TO_PO', entityType: 'PO', entityId: poNumber, details: { prNumber, vendorId: resolvedVendor }, ipAddress: ip })

  return { result: { poNumber, prNumber, message: `PO ${poNumber} created from PR ${prNumber}.` } }
}

// Neutral catalog price lookup — a stand-in for an external price-reference
// integration. Returns indicative prices derived from the seed catalog so the
// demo works fully offline with no third-party dependency.
async function _searchCatalogPrice({ keyword, limit }: any) {
  if (!keyword) return { result: { error: 'keyword is required' } }
  const maxResults = Math.min(Math.max(parseInt(limit) || 5, 1), 10)
  const q = String(keyword)
  const matches = store.materials().filter(m => _like(m.Description, q) || _like(m.MaterialId, q)).slice(0, maxResults)

  if (!matches.length) {
    return { result: { keyword: q, results: [], message: `No catalog items found for "${q}". Try a different keyword.` } }
  }

  // Derive a stable indicative price from the material id (no randomness).
  const priceFor = (id: string) => {
    let h = 0
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 100000
    return Number((20 + (h % 48000) / 100).toFixed(2))
  }

  const results = matches.map(m => {
    const price = priceFor(m.MaterialId)
    return { title: m.Description, sku: m.MaterialId, price: `$${price.toFixed(2)}`, priceValue: price, currency: 'USD', uom: m.BaseUnit, materialMatch: [{ materialId: m.MaterialId, description: m.Description, uom: m.BaseUnit }] }
  })

  const prices = results.map(r => r.priceValue)
  const priceRange = { min: `$${Math.min(...prices).toFixed(2)}`, max: `$${Math.max(...prices).toFixed(2)}` }

  return { result: { keyword: q, source: 'Internal catalog (indicative)', currency: 'USD', count: results.length, priceRange, results, disclaimer: 'Prices are indicative catalog reference values for demo purposes only — not contracted supplier pricing.' } }
}
