import { z } from 'zod'
import { executeTool } from './execute-tool'
import { logEvent } from '../audit'
import { rememberVendor } from '../memory-service'

export const MUTATING = new Set(['save_pr_draft', 'submit_pr', 'run_invoice_match', 'convert_pr_to_po'])

interface ToolCtx { userId?: string; ip?: string; callId?: string }

interface MakeToolOpts {
  name: string
  description: string
  schema: z.ZodTypeAny
  readOnly: boolean
  idempotent: boolean
  toModelOutput?: (r: any) => string
}

function makeTool({ name, description, schema, readOnly, idempotent, toModelOutput }: MakeToolOpts) {
  return {
    name,
    description,
    inputSchema: schema,
    outputSchema: z.unknown(),
    readOnly: !!readOnly,
    idempotent: !!idempotent,
    _ctx: undefined as ToolCtx | undefined,
    toModelOutput: toModelOutput || ((r: any) => {
      const s = JSON.stringify(r)
      return s.length > 8000 ? JSON.stringify({ _truncated: true, _originalLength: s.length, summary: s.slice(0, 8000) }) : s
    }),
    async forward(input: any, _signal?: AbortSignal) {
      const ctx: ToolCtx = (this as any)._ctx || {}
      const result = (await executeTool(name, input, ctx)).result

      if (MUTATING.has(name)) {
        await logEvent({
          userId: ctx.userId || 'demo_user',
          action: name.toUpperCase(),
          entityType: 'tool',
          entityId: ctx.callId || name,
          details: { args: input, result },
          ipAddress: ctx.ip || '',
          success: !result?.error,
        })
        if (name === 'submit_pr' && result?.vendorId && result?.vendorName && !result?.error) {
          rememberVendor(ctx.userId || 'demo_user', result.vendorId, result.vendorName).catch(() => {})
        }
      }

      return result
    },
  }
}

export const ALL_TOOL_DEFS = [
  makeTool({ name: 'search_materials', description: 'Search material master by keyword. When to call: user describes what they need to buy without providing a material ID (e.g. "hydraulic pump", "laptop"). Not needed when user already provides a material ID.', schema: z.object({ query: z.string().describe('Keyword to search material descriptions') }), readOnly: true, idempotent: true }),
  makeTool({ name: 'search_vendors', description: 'Search approved vendor list by name. When to call: user mentions a supplier by name without a vendor ID, or asks to find suppliers for a category.', schema: z.object({ query: z.string().describe('Vendor name or category keyword') }), readOnly: true, idempotent: true }),
  makeTool({ name: 'get_cost_centre', description: 'Verify a cost centre is active and within its valid date range. When to call: user provides a cost centre ID during PR creation.', schema: z.object({ costCentreId: z.string().describe('Cost centre ID, e.g. CC-IT-001') }), readOnly: true, idempotent: true }),
  makeTool({ name: 'check_budget', description: 'Check remaining budget for a cost centre in the current fiscal year. When to call: user asks how much budget is left, or before PR submission.', schema: z.object({ costCentreId: z.string().describe('Cost centre ID'), estimatedAmount: z.number().optional().describe('Estimated total to check against remaining budget') }), readOnly: true, idempotent: true }),
  makeTool({ name: 'save_pr_draft', description: 'Create or update a PR draft. When to call: immediately after the user confirms any field. Pass draftId to update an existing draft; omit to create a new one. Do NOT wait for all fields — save incrementally.', schema: z.object({ draftId: z.string().optional(), materialId: z.string().optional(), description: z.string().optional(), quantity: z.number().optional(), unit: z.string().optional(), estimatedPrice: z.number().optional(), currency: z.string().optional(), costCentreId: z.string().optional(), vendorId: z.string().optional(), requiredDate: z.string().optional().describe('YYYY-MM-DD') }), readOnly: false, idempotent: false }),
  makeTool({ name: 'get_pr_draft', description: 'Retrieve a saved PR draft by ID. When to call: user returns to a draft in a new turn.', schema: z.object({ draftId: z.string() }), readOnly: true, idempotent: true }),
  makeTool({ name: 'suggest_pr_fields', description: `Look up historical PRs by fuzzy-matching the item description or material ID, and suggest values for fields the user has NOT yet provided. Call this after search_materials returns a match, before asking the user to fill in missing fields one-by-one. ALWAYS pass materialId when known.

Present results as a table with 💡 prefix and source PR. Ask user to confirm before applying. NEVER apply without explicit confirmation.`, schema: z.object({ description: z.string().optional(), materialId: z.string().optional(), missingFields: z.array(z.enum(['costCentreId','vendorId','estimatedPrice','unit','currency'])).optional() }), readOnly: true, idempotent: true }),
  makeTool({ name: 'run_compliance_checks', description: 'Run all pre-submission compliance checks on a PR draft (required fields, vendor whitelist, cost centre validity, budget). Call after user confirms all fields, before asking for final submit confirmation. Show ✅ / ⚠️ / ❌ per check.', schema: z.object({ draftId: z.string().describe('PR draft ID to validate') }), readOnly: true, idempotent: true }),
  makeTool({ name: 'submit_pr', description: 'Submit a PR draft as an official Purchase Requisition. Call ONLY after (1) explicit user confirmation AND (2) run_compliance_checks shows no ❌. After success, use ui_action NAVIGATE page=prs.', schema: z.object({ draftId: z.string().describe('PR draft ID to submit') }), readOnly: false, idempotent: false }),
  makeTool({ name: 'list_purchase_requisitions', description: 'List purchase requisitions with optional status filter. Use when user asks to see their PRs or filter by status.', schema: z.object({ status: z.enum(['PENDING_APPROVAL','APPROVED','REJECTED','CONVERTED','ALL']).optional(), limit: z.number().optional() }), readOnly: true, idempotent: true }),
  makeTool({ name: 'get_pr_detail', description: 'Get full details of a single PR. Use when user mentions a specific PR number or asks about status/content of a particular PR.', schema: z.object({ prNumber: z.string().describe('e.g. PR-000001') }), readOnly: true, idempotent: true }),
  makeTool({ name: 'list_purchase_orders', description: 'List purchase orders with optional status/vendor filter. Use when user asks to see open orders or filter by vendor.', schema: z.object({ status: z.enum(['OPEN','PARTIAL_GR','FULLY_GR','CLOSED','ALL']).optional(), vendorId: z.string().optional(), limit: z.number().optional() }), readOnly: true, idempotent: true }),
  makeTool({ name: 'get_po_detail', description: 'Get full PO details including GR lines and invoiced amount. Use when user asks about a specific PO or its delivery/goods receipt status.', schema: z.object({ poNumber: z.string().describe('e.g. PO-000001') }), readOnly: true, idempotent: true }),
  makeTool({ name: 'list_invoices', description: 'List supplier invoices with optional status/payment-block filter. Use when user asks to see invoices or blocked payments.', schema: z.object({ status: z.enum(['PENDING','MATCHED','PARTIAL','BLOCKED','PAID','ALL']).optional(), paymentBlock: z.boolean().optional(), limit: z.number().optional() }), readOnly: true, idempotent: true }),
  makeTool({ name: 'run_invoice_match', description: 'Run three-way match (PO × GR × invoice) and update the invoice match score. Score ≥75 = MATCHED; <75 = PARTIAL. Use when user asks to match an invoice.', schema: z.object({ invoiceId: z.string().describe('e.g. INV-000001') }), readOnly: false, idempotent: false }),
  makeTool({ name: 'convert_pr_to_po', description: 'Convert an APPROVED PR into a Purchase Order. Requirements: PR must be APPROVED; vendorId required. Use when user says "convert PR to PO" or "create a purchase order from this PR".', schema: z.object({ prNumber: z.string().describe('PR to convert'), vendorId: z.string().describe('Vendor ID'), deliveryDate: z.string().optional().describe('YYYY-MM-DD') }), readOnly: false, idempotent: false }),
  makeTool({ name: 'get_audit_log', description: 'Retrieve the agent action audit trail. Use when user asks what actions were taken, compliance attempts, or policy violations. Present as Markdown table with ❌ for failed actions.', schema: z.object({ fromDate: z.string().optional().describe('YYYY-MM-DD'), toDate: z.string().optional().describe('YYYY-MM-DD'), limit: z.number().optional() }), readOnly: true, idempotent: true }),
  makeTool({ name: 'search_catalog_price', description: 'Look up indicative catalog reference prices for an item by keyword. Use for consumables, tools, or any item where a price reference is helpful. Present as a Markdown table. End with a ⚠️ disclaimer that prices are indicative, not contracted pricing.', schema: z.object({ keyword: z.string().describe('Product search keyword in English'), limit: z.number().optional().describe('Default 5, max 10') }), readOnly: true, idempotent: true }),
  makeTool({ name: 'ui_action', description: 'Control the left panel: navigate a list, highlight rows, filter, open a record read-only (OPEN_DETAIL), or open/populate an editable form (OPEN_FORM / SET_FORM_FIELDS). The panel has two view types: the LIST and the RECORD view (detail = read-only mode, form = edit mode). Use OPEN_FORM while the user creates/edits a document and SET_FORM_FIELDS as each field is confirmed; use OPEN_DETAIL to show a finished document. Call after every query or write to keep the panel in sync.', schema: z.object({ type: z.enum(['NAVIGATE','HIGHLIGHT','HIGHLIGHT_MANY','SET_FILTER','OPEN_DETAIL','OPEN_FORM','SET_FORM_FIELDS','CLOSE_DETAIL','CLEAR']), page: z.enum(['prs','pos','invoices','audit']).optional(), id: z.string().optional(), ids: z.array(z.string()).optional(), kind: z.enum(['pr','po','invoice']).optional(), draftId: z.string().optional(), fields: z.record(z.string()).optional(), filters: z.record(z.string()).optional() }), readOnly: true, idempotent: true }),
  makeTool({ name: 'get_view_state', description: 'Read the CURRENT left-panel state (what the user is looking at right now). Call when the user refers to "this", changed the view themselves, or you need to confirm the live view before acting.', schema: z.object({}), readOnly: true, idempotent: true }),
]
