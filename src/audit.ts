// Simple business audit log — a plain human-readable trail of write actions.
// This is the "legacy" log kept alongside the richer AEP evidence stream;
// the audit report (audit-service.ts) reads both.

import { randomUUID } from 'crypto'
import * as store from './store'

const log = console

interface LogEventParams {
  userId?: string
  action: string
  entityType: string
  entityId: string
  details?: object | string
  ipAddress?: string
  success?: boolean
  errorMessage?: string
}

export async function logEvent({ userId, action, entityType, entityId, details, ipAddress, success = true, errorMessage }: LogEventParams): Promise<void> {
  try {
    store.insertAudit({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      userId: userId || 'unknown',
      action,
      entityType,
      entityId,
      details: typeof details === 'object' ? JSON.stringify(details) : (details || ''),
      ipAddress: ipAddress || '',
      success,
      errorMessage: errorMessage || '',
    })
  } catch (e: any) {
    log.warn('[audit] failed to write audit log:', e.message)
  }
}
