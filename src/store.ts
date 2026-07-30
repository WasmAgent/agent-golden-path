// In-memory data store — the persistence layer for the reference app.
//
// The golden-path app keeps all procurement state in memory, seeded from
// src/seed/seed-data.json on startup. This keeps the reference app dependency-free
// (no native SQLite driver, no `cds deploy`) so a fresh `npm install` just runs.
// Swap this module for a real database (Postgres, SQLite, an ERP client, …)
// without touching the agent/evidence chain that consumes it.

import fs from 'fs'
import path from 'path'

export interface Vendor { VendorId: string; Name: string; City: string; Country: string; IsBlocked: boolean; IsDeleted: boolean; PaymentTerms: string; Currency: string }
export interface Material { MaterialId: string; Description: string; MaterialType: string; MaterialGroup: string; BaseUnit: string; PurchaseUnit: string }
export interface CostCenter { CostCenterId: string; ControllingArea: string; Description: string; ValidFrom: string; ValidTo: string; IsActive: boolean; ResponsiblePerson: string }
export interface Budget { CostCenterId: string; FiscalYear: string; TotalBudget: number; UsedBudget: number; Currency: string }
export interface PRDraft { DraftId: string; MaterialId?: string; Description?: string; Quantity?: number; Unit?: string; EstimatedPrice?: number; Currency?: string; CostCenterId?: string; VendorId?: string; RequiredDate?: string; CreatedBy?: string; CreatedAt?: string; UpdatedAt?: string; ComplianceCheckedAt?: string }
export interface PurchaseRequisition { PRNumber: string; MaterialId?: string; Description?: string; Quantity?: number; Unit?: string; EstimatedPrice?: number; Currency?: string; CostCenterId?: string; VendorId?: string; RequiredDate?: string; Status: string; CreatedBy?: string; CreatedAt?: string; SubmittedAt?: string; PONumber?: string; RejectReason?: string }
export interface PurchaseOrder { PONumber: string; PRNumber?: string; VendorId?: string; MaterialId?: string; Description?: string; OrderedQty?: number; Unit?: string; NetPrice?: number; Currency?: string; CostCenterId?: string; PurchasingOrg?: string; PurchasingGroup?: string; Plant?: string; OrderDate?: string; DeliveryDate?: string; Status: string; GRQty?: number; InvoicedAmt?: number }
export interface GoodsReceipt { GRNumber: string; PONumber?: string; MaterialId?: string; ReceivedQty?: number; Unit?: string; PostingDate?: string; DeliveryNote?: string; CreatedBy?: string; CreatedAt?: string }
export interface SupplierInvoice { InvoiceId: string; PONumber?: string; VendorId?: string; GrossAmount?: number; TaxAmount?: number; NetAmount?: number; Currency?: string; InvoiceDate?: string; PostingDate?: string; ExternalRef?: string; Status: string; MatchScore?: number; MatchDetail?: string; PaymentBlock?: boolean; CreatedBy?: string; CreatedAt?: string }
export interface AuditLogEntry { id: string; timestamp: string; userId: string; action: string; entityType: string; entityId: string; details: string; ipAddress: string; success: boolean; errorMessage: string }
export interface ChatToolLogEntry { id: string; calledAt: string; userId: string; turnId: string; toolName: string; toolArgs: string; toolResult: string; durationMs: number; hasError: boolean; errorMessage: string; outcome: string; stateChanging: boolean; userMessage: string; assistantMessage: string; ipAddress: string; correlationId: string }

interface StoreShape {
  vendors: Vendor[]
  materials: Material[]
  costCenters: CostCenter[]
  budgets: Budget[]
  prDrafts: PRDraft[]
  purchaseRequisitions: PurchaseRequisition[]
  purchaseOrders: PurchaseOrder[]
  goodsReceipts: GoodsReceipt[]
  supplierInvoices: SupplierInvoice[]
  auditLog: AuditLogEntry[]
  chatToolLog: ChatToolLogEntry[]
}

const SEED_FILE = path.join(__dirname, 'seed', 'seed-data.json')

function loadSeed(): StoreShape {
  const raw = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'))
  return {
    vendors: raw.vendors ?? [],
    materials: raw.materials ?? [],
    costCenters: raw.costCenters ?? [],
    budgets: raw.budgets ?? [],
    prDrafts: raw.prDrafts ?? [],
    purchaseRequisitions: raw.purchaseRequisitions ?? [],
    purchaseOrders: raw.purchaseOrders ?? [],
    goodsReceipts: raw.goodsReceipts ?? [],
    supplierInvoices: raw.supplierInvoices ?? [],
    auditLog: [],
    chatToolLog: [],
  }
}

let db: StoreShape = loadSeed()

/** Reset all tables back to the seed snapshot (used by the demo "reset" endpoint). */
export function resetToSeed(): void {
  db = loadSeed()
}

// ── Read helpers ──────────────────────────────────────────────────────────────
export const vendors = () => db.vendors
export const materials = () => db.materials
export const costCenters = () => db.costCenters
export const budgets = () => db.budgets
export const prDrafts = () => db.prDrafts
export const purchaseRequisitions = () => db.purchaseRequisitions
export const purchaseOrders = () => db.purchaseOrders
export const goodsReceipts = () => db.goodsReceipts
export const supplierInvoices = () => db.supplierInvoices
export const auditLog = () => db.auditLog
export const chatToolLog = () => db.chatToolLog

// ── Lookups ─────────────────────────────────────────────────────────────────
export const findVendor = (id: string) => db.vendors.find(v => v.VendorId === id)
export const findMaterial = (id: string) => db.materials.find(m => m.MaterialId === id)
export const findCostCenter = (id: string) => db.costCenters.find(c => c.CostCenterId === id)
export const findBudget = (ccId: string, fy: string) => db.budgets.find(b => b.CostCenterId === ccId && b.FiscalYear === fy)
export const findDraft = (id: string) => db.prDrafts.find(d => d.DraftId === id)
export const findPR = (num: string) => db.purchaseRequisitions.find(p => p.PRNumber === num)
export const findPO = (num: string) => db.purchaseOrders.find(p => p.PONumber === num)
export const findInvoice = (id: string) => db.supplierInvoices.find(i => i.InvoiceId === id)

// ── Mutations ─────────────────────────────────────────────────────────────────
export function insertDraft(d: PRDraft): void { db.prDrafts.push(d) }
export function deleteDraft(id: string): void { db.prDrafts = db.prDrafts.filter(d => d.DraftId !== id) }
export function insertPR(pr: PurchaseRequisition): void { db.purchaseRequisitions.push(pr) }
export function insertPO(po: PurchaseOrder): void { db.purchaseOrders.push(po) }
export function insertAudit(e: AuditLogEntry): void { db.auditLog.push(e) }
export function insertChatToolLog(e: ChatToolLogEntry): void { db.chatToolLog.push(e) }

/** Next sequential PR number, e.g. PR-000004. */
export function nextPRNumber(): string {
  const max = db.purchaseRequisitions.reduce((m, pr) => Math.max(m, parseInt((pr.PRNumber || '').replace('PR-', ''), 10) || 0), 0)
  return `PR-${String(max + 1).padStart(6, '0')}`
}

/** Next sequential PO number, e.g. PO-000002. */
export function nextPONumber(): string {
  const max = db.purchaseOrders.reduce((m, po) => Math.max(m, parseInt((po.PONumber || '').replace('PO-', ''), 10) || 0), 0)
  return `PO-${String(max + 1).padStart(6, '0')}`
}
