// Server entry — plain Express.
//
// Startup wires the three legs of the provable-agent chain into one app:
//   • vets every tool descriptor with mcp-firewall  (rug-pull / prompt-injection)
//   • validates the agent's tool BOM with agentbom-core
//   • mounts the chat, panel, and audit routers
// then serves the built web UI if present.

import express from 'express'
import path from 'path'
import fs from 'fs'
try { require('dotenv').config() } catch { /* dotenv optional */ }

import * as store from './store'

const log = console

async function _vetTools(): Promise<void> {
  try {
    const { vetToolAsync, snapshotTool, TfidfSemanticDetector } = await import('@wasmagent/mcp-firewall')
    const { ALL_TOOL_DEFS } = require('./chat/tool-definitions')
    const entries = ALL_TOOL_DEFS.map((t: any) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))

    // Snapshot all tool descriptors at startup — hashes detect rug-pull tampering at runtime.
    const serverId = 'procurement-copilot'
    for (const entry of entries) {
      try { snapshotTool(entry, serverId) } catch { /* non-fatal */ }
    }

    const results = await Promise.all(entries.map((e: any) => vetToolAsync(e)))
    const blocked = results.filter((r: any) => r.blocked)
    const warned = results.filter((r: any) => !r.blocked && r.findings.length > 0)
    if (blocked.length > 0) {
      log.error('[mcp-firewall] BLOCKED tools at startup:', blocked.map((r: any) => r.toolName).join(', '))
      blocked.forEach((r: any) => r.findings.forEach((f: any) => log.error(`  [${r.toolName}] ${f.severity}: ${f.description}`)))
    }
    if (warned.length > 0) { warned.forEach((r: any) => r.findings.forEach((f: any) => log.warn(`[mcp-firewall] ${r.toolName}: ${f.severity}: ${f.description}`))) }
    log.info(`[mcp-firewall] async: ${results.length - blocked.length}/${results.length} tools passed`)

    if (TfidfSemanticDetector) {
      const detector = new TfidfSemanticDetector({ blockThreshold: 0.88, warnThreshold: 0.75 })
      let semanticBlocked = 0
      for (const entry of entries) {
        const result = await detector.detect(entry.description || '')
        if (result.score >= 0.88) { log.error(`[mcp-firewall] semantic BLOCKED ${entry.name}: score=${result.score.toFixed(3)} category=${result.matchedCategory}`); semanticBlocked++ }
        else if (result.score >= 0.75) { log.warn(`[mcp-firewall] semantic warn ${entry.name}: score=${result.score.toFixed(3)} category=${result.matchedCategory}`) }
      }
      log.info(`[mcp-firewall] semantic: ${entries.length - semanticBlocked}/${entries.length} tools passed`)
    }
  } catch (e: any) {
    log.warn('[mcp-firewall] vetting skipped:', e.message)
  }
}

async function _validateAgentBOM(): Promise<void> {
  try {
    const agentbom = await import('@wasmagent/agentbom-core')
    const { ALL_TOOL_DEFS } = require('./chat/tool-definitions')
    const pkg = require('../package.json')

    const bom = {
      agentbom_version: '0.1',
      identity: { agent_id: 'procurement-copilot', agent_name: 'procurement-copilot', agent_version: pkg.version as string, generated_at: new Date().toISOString() },
      tool_layer: (ALL_TOOL_DEFS as any[]).map((t: any) => ({ tool_id: t.name as string, tool_name: t.name as string, source: 'builtin' as const })),
      attestation: { generator: 'golden-path-server' },
    }

    const validation = agentbom.validateAgentBOM(bom)
    if (!validation.valid) log.warn('[agentbom] BOM validation errors:', validation.errors.join(', '))

    const profile = {
      profile_id: 'golden-path-basic', profile_version: '1.0', framework: { name: 'internal', version: '1.0' },
      rules: { identity: { requires_version: true }, tool_layer: { requires_tool_inventory: true }, risk_layer: {}, attestation: {} },
    }
    const result = agentbom.checkCompliance(bom, profile)
    const total = bom.tool_layer.length
    if (result.compliant) log.info(`[agentbom] ${total}/${total} tools compliant (score=${result.score})`)
    else log.warn(`[agentbom] compliance violations (score=${result.score}):`, result.errors.join(', '))
  } catch (e: any) {
    log.warn('[agentbom] validation skipped:', e.message)
  }
}

async function main() {
  await _vetTools()
  await _validateAgentBOM()

  const app = express()
  app.use(express.json({ limit: '2mb' }))

  const chatRouter = require('./chat-service').default
  app.use('/api/chat', chatRouter)

  const panelRouter = require('./chat/panel-router').default
  app.use('/api/panel', panelRouter)

  const registerAuditRoutes = require('./audit-service').default
  registerAuditRoutes(app)

  // Demo approval workflow — approve/reject a pending PR.
  app.post('/api/prs/:prNumber/approve', (req: any, res: any) => {
    const pr = store.findPR(req.params.prNumber)
    if (!pr) return res.status(404).json({ ok: false, error: 'PR not found' })
    pr.Status = 'APPROVED'
    res.json({ ok: true, prNumber: pr.PRNumber, status: 'APPROVED' })
  })
  app.post('/api/prs/:prNumber/reject', (req: any, res: any) => {
    const pr = store.findPR(req.params.prNumber)
    if (!pr) return res.status(404).json({ ok: false, error: 'PR not found' })
    pr.Status = 'REJECTED'
    pr.RejectReason = (req.body || {}).reason || 'Rejected'
    res.json({ ok: true, prNumber: pr.PRNumber, status: 'REJECTED' })
  })

  // Read-only REST for the list pages (replaces the OData projection service).
  app.get('/api/purchase-requisitions', (req: any, res: any) => {
    let rows = [...store.purchaseRequisitions()].sort((a, b) => (b.CreatedAt || '').localeCompare(a.CreatedAt || ''))
    if (req.query.status && req.query.status !== 'ALL') rows = rows.filter(r => r.Status === req.query.status)
    res.json({ value: rows })
  })
  app.get('/api/purchase-requisitions/:prNumber', (req: any, res: any) => {
    const row = store.findPR(req.params.prNumber)
    if (!row) return res.status(404).json({ error: 'not found' })
    res.json(row)
  })
  app.get('/api/purchase-orders', (req: any, res: any) => {
    let rows = [...store.purchaseOrders()].sort((a, b) => (b.OrderDate || '').localeCompare(a.OrderDate || ''))
    if (req.query.status && req.query.status !== 'ALL') rows = rows.filter(r => r.Status === req.query.status)
    res.json({ value: rows })
  })
  app.get('/api/purchase-orders/:poNumber', (req: any, res: any) => {
    const row = store.findPO(req.params.poNumber)
    if (!row) return res.status(404).json({ error: 'not found' })
    res.json(row)
  })
  app.get('/api/supplier-invoices', (req: any, res: any) => {
    let rows = [...store.supplierInvoices()].sort((a, b) => (b.InvoiceDate || '').localeCompare(a.InvoiceDate || ''))
    if (req.query.status && req.query.status !== 'ALL') rows = rows.filter(r => r.Status === req.query.status)
    res.json({ value: rows })
  })
  app.get('/api/supplier-invoices/:invoiceId', (req: any, res: any) => {
    const row = store.findInvoice(req.params.invoiceId)
    if (!row) return res.status(404).json({ error: 'not found' })
    res.json(row)
  })

  // ── A2A endpoints (optional) ──────────────────────────────────────────────
  if (process.env.A2A_ENABLED) {
    try {
      const { createA2AServer } = await import('@wasmagent/a2a')
      const { createAgent } = require('./agent-engine')
      const { ALL_TOOL_DEFS } = require('./chat/tool-definitions')
      const { getSystemPrompt } = require('./chat/system-prompt')
      const systemPrompt = getSystemPrompt({}, {})
      const { agent } = await createAgent({ tools: ALL_TOOL_DEFS, systemPrompt, sessionId: 'a2a' })
      const a2aServer = createA2AServer(agent, {
        agentId: `${process.env.APP_URL || 'http://localhost:4000'}/api/a2a`,
        name: 'Procurement Copilot',
        description: 'AI-powered Procure-to-Pay compliance copilot',
        skills: ['purchase_requisition', 'purchase_order', 'invoice_matching', 'compliance_check'],
      })
      app.use('/api/a2a', a2aServer.handler())
      log.info('[a2a] A2A server mounted at /api/a2a')
    } catch (e: any) {
      log.warn('[a2a] failed to mount A2A server:', e.message)
    }
  }

  const distDir = path.join(__dirname, '../web/dist')
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir))
    app.get('/{*path}', (req: any, res: any, next: any) => {
      if (req.path.startsWith('/api')) return next()
      res.sendFile(path.join(distDir, 'index.html'))
    })
  }

  const port = Number(process.env.PORT) || 4000
  app.listen(port, () => log.info(`[server] Procurement Copilot listening on http://localhost:${port}`))
}

main().catch(err => { log.error('[server] fatal:', err); process.exit(1) })
