// Audit service — the payoff end of the provable-agent chain.
//
// Reads the recorded agent activity (the chat tool log) and turns it into:
//   1. Signed AEP evidence records          (@wasmagent/aep)
//   2. OAA risk scoring + policy findings    (@openagentaudit/core + adapters)
//   3. A signed Trust Passport               (@openagentaudit/passport)
//   4. A human-readable HTML / Markdown / CSV audit report
//
// Nothing here is procurement-specific except the capability names — the same
// shape works for any agent whose tool calls are logged as evidence.

import express from 'express'
import { randomUUID, createHash } from 'crypto'
import * as store from './store'
import { callClaudeJSON } from './llm-client'

const log = console

const _DEFAULT_SEED = 'a'.repeat(64)
if (process.env.NODE_ENV === 'production' && (!process.env.AEP_SIGNING_SEED || process.env.AEP_SIGNING_SEED === _DEFAULT_SEED)) {
  throw new Error('AEP_SIGNING_SEED must be set to a non-default value in production')
}
const DEV_SEED = process.env.AEP_SIGNING_SEED || _DEFAULT_SEED
const DEV_KEY_ID = process.env.AEP_KEY_ID || 'golden-path-dev-key-01'

let _aepPromise: Promise<any> | null = null
function loadAEP() {
  if (!_aepPromise) _aepPromise = import('@wasmagent/aep')
  return _aepPromise
}

let _adapterPromise: Promise<any> | null = null
async function getAdapter() {
  if (!_adapterPromise)
    _adapterPromise = import('@openagentaudit/adapters/aep-v0_2').then(m => ({ Adapter: (m as any).AepV0_2Adapter, getProvenance: (m as any).getProvenance }))
  return _adapterPromise
}

let _corePromise: Promise<any> | null = null
function loadCore() {
  if (!_corePromise) _corePromise = import('@openagentaudit/core').then(m => m)
  return _corePromise
}

let _passportPromise: Promise<any> | null = null
function loadPassport() {
  if (!_passportPromise) _passportPromise = import('@openagentaudit/passport')
  return _passportPromise
}

const DECLARED_CAPABILITIES = [
  'read:purchase_requisitions', 'read:purchase_orders', 'read:invoices', 'read:audit_log',
  'read:materials', 'read:vendors', 'read:cost_centre', 'read:budget',
  'write:pr_draft', 'write:pr_submit', 'write:invoice_match', 'write:pr_to_po', 'read:catalog_price',
].sort()

const TOOL_MANIFEST_DIGEST = createHash('sha256').update(JSON.stringify(DECLARED_CAPABILITIES)).digest('hex')

const CAPABILITY_MANIFEST = {
  declared_capabilities: DECLARED_CAPABILITIES,
  high_risk_capabilities: ['write:pr_submit', 'write:pr_to_po', 'write:invoice_match'],
  denied_capabilities: [] as string[],
}

const TOOL_TO_CAP: Record<string, string> = {
  search_materials: 'read:materials', search_vendors: 'read:vendors', get_cost_centre: 'read:cost_centre',
  check_budget: 'read:budget', save_pr_draft: 'write:pr_draft', get_pr_draft: 'write:pr_draft',
  run_compliance_checks: 'write:pr_draft', submit_pr: 'write:pr_submit',
  list_purchase_requisitions: 'read:purchase_requisitions', get_pr_detail: 'read:purchase_requisitions',
  list_purchase_orders: 'read:purchase_orders', get_po_detail: 'read:purchase_orders',
  list_invoices: 'read:invoices', run_invoice_match: 'write:invoice_match',
  convert_pr_to_po: 'write:pr_to_po', get_audit_log: 'read:audit_log',
  search_catalog_price: 'read:catalog_price', ui_action: 'read:purchase_requisitions', get_view_state: 'read:purchase_requisitions',
}

let _emitterFactory: any = null
async function getEmitterFactory(AEP: any) {
  if (_emitterFactory) return _emitterFactory
  const { AEPEmitter, createLocalSignerFromSeed, resolveRepoCommit } = AEP
  const signer = createLocalSignerFromSeed(DEV_SEED, DEV_KEY_ID)
  const repoCommit = await resolveRepoCommit().catch(() => null)
  _emitterFactory = AEPEmitter.withDefaults({
    model_id: process.env.LLM_MODEL || 'claude-sonnet-latest',
    model_provider: 'anthropic',
    runtime_version: '1.0.0',
    repo_commit: repoCommit,
    policy_bundle_digest: 'golden-path-policy-v1',
    tool_manifest_digest: TOOL_MANIFEST_DIGEST,
    signer,
  })
  return _emitterFactory
}

async function buildTurnRecord(AEP: any, turnRow: any, toolCalls: any[]) {
  const factory = await getEmitterFactory(AEP)
  const emitter = factory.create({
    run_id: `turn-${turnRow.turnId}`,
    trace_id: randomUUID(),
    allowEmptyActions: true,
    run_context: { agent_id: 'procurement-copilot', agent_version: '1.0.0', session_id: turnRow.turnId },
  })

  const ts = (s: string) => { const ms = new Date(s).getTime(); return isFinite(ms) ? ms : Date.now() }

  for (const tc of toolCalls) {
    const cap = TOOL_TO_CAP[tc.toolName] || 'read:purchase_requisitions'
    const isWrite = cap.startsWith('write:')
    const isHighRisk = ['write:pr_submit', 'write:pr_to_po', 'write:invoice_match'].includes(cap)
    const hasErr = !!(tc.hasError)
    const isBypass = tc.outcome === 'policy_bypass'
    const capDecision = { capability: cap, subject: turnRow.userId, resource: `procurement:${tc.toolName}`, decision: (hasErr || isBypass) ? 'deny' : 'allow', approval_mode: isWrite ? 'bounded-lease' : 'policy-allow-with-receipt' }
    const recordingMode = isHighRisk ? 'full' : isWrite ? 'delta' : 'validation'
    emitter.addAction({ tool_name: tc.toolName, state_changing: !!(tc.stateChanging), timestamp_ms: ts(tc.calledAt), recording_mode: recordingMode, side_effect_class: isWrite ? (isHighRisk ? 'mutate-external' : 'mutate-local') : 'read', capability_decision: capDecision })
    emitter.addCapabilityDecision(capDecision)
    if (hasErr || isBypass) {
      emitter.addVerifierResult({ verifier_id: isBypass ? 'compliance-gate' : 'tool-error-gate', passed: false, score: 0, claim_ids: [isBypass ? `tool:${tc.toolName}:compliance-checked` : `tool:${tc.toolName}:no-error`] })
    }
  }

  emitter.addInputRef({ uri: `procurement:turn:${turnRow.turnId}`, taint_labels: ['user-input'] })
  emitter.setBudgetLedger({ tool_budget: { spent: toolCalls.length } })
  return await emitter.emit(Date.now())
}

async function buildEventBatch(AEP: any, turns: any[]) {
  const { Adapter, getProvenance } = await getAdapter()
  const aepRecords: any[] = []

  for (const { turnRow, toolCalls } of turns) {
    try {
      const record = await buildTurnRecord(AEP, turnRow, toolCalls)
      aepRecords.push({ record, label: `Turn ${turnRow.turnId.slice(0, 8)} by ${turnRow.userId}` })
    } catch (err: any) {
      log.error('[audit] failed to build AEP record for turn', turnRow.turnId, err)
    }
  }

  const allRecords = aepRecords.map(r => r.record)
  const events = allRecords.length > 0 && Adapter.toEventsBatch
    ? Adapter.toEventsBatch(allRecords)
    : allRecords.flatMap((r: any) => Adapter.toEvents(r))
  const aepProvenance = allRecords.length > 0 ? getProvenance(allRecords[0]) : undefined
  return { aepRecords, events, aepProvenance }
}

// Group the flat chat-tool-log into turns (one "__turn__" row + its tool calls).
function loadTurns(fromDate?: string, toDate?: string) {
  const all = store.chatToolLog()
  const inRange = (t: string) => (!fromDate || t >= `${fromDate}T00:00:00Z`) && (!toDate || t <= `${toDate}T23:59:59Z`)
  const turnRows = all
    .filter(r => r.toolName === '__turn__' && inRange(r.calledAt))
    .sort((a, b) => (b.calledAt || '').localeCompare(a.calledAt || ''))
    .slice(0, 200)

  return turnRows.map(row => ({
    turnRow: { turnId: row.turnId, userId: row.userId || 'demo_user', calledAt: row.calledAt, userMessage: row.userMessage || '', assistantMessage: row.assistantMessage || '', ip: row.ipAddress || '' },
    toolCalls: all
      .filter(r => r.turnId === row.turnId && r.toolName !== '__turn__')
      .sort((a, b) => (a.calledAt || '').localeCompare(b.calledAt || ''))
      .map(r => ({ toolName: r.toolName, calledAt: r.calledAt, toolArgs: r.toolArgs, toolResult: r.toolResult, durationMs: Number(r.durationMs || 0), hasError: !!r.hasError, errorMessage: r.errorMessage || '', stateChanging: !!r.stateChanging, outcome: r.outcome || 'allow' })),
  }))
}

async function buildPassport(riskScore: any, findings: any[], turns: any[], aepRecords: any[], aepProvenance: any) {
  try {
    const { issue, addFact, signPassport, EVIDENCE_QUALITY_THRESHOLDS } = await loadPassport()
    const report = { evidence_admission_score: { score: riskScore.evidence_admission_score?.score ?? 0, grade: riskScore.evidence_admission_score?.grade ?? 'F' }, findings: findings.map(f => ({ severity: f.severity })), profiles_applied: ['owasp-agentic-top10-2026', 'eu-ai-act-2024', 'nist-ai-rmf-1.0'] }
    let passport = await issue({ report, agentId: 'procurement-copilot', agentName: 'Procurement Copilot Agent', validityDays: 30, issuer: 'golden-path-audit-service', issuanceContext: 'self-issued' })
    const writeCalls = turns.flatMap((t: any) => t.toolCalls.filter((tc: any) => tc.stateChanging && !tc.hasError))
    for (const tc of writeCalls.slice(0, 20)) { addFact(passport, `tool_call:${tc.toolName}:${tc.calledAt}`, { toolName: tc.toolName, toolArgs: tc.toolArgs }) }
    if (aepProvenance && Object.keys(aepProvenance).length > 0) { addFact(passport, 'aep_provenance', aepProvenance) }
    if (process.env.AEP_SIGNING_SEED && process.env.AEP_SIGNING_SEED !== _DEFAULT_SEED) {
      try {
        const seedBytes = Buffer.from(process.env.AEP_SIGNING_SEED, 'hex')
        const signer = { keyId: DEV_KEY_ID, sign: async (bytes: any) => { const ed = await import('@noble/ed25519'); const sig = await ed.signAsync(bytes, seedBytes.slice(0, 32)); return Buffer.from(sig).toString('base64') } }
        passport = await signPassport(passport, signer)
      } catch (e: any) { log.warn('[audit] passport signing skipped:', e.message) }
    }
    if (EVIDENCE_QUALITY_THRESHOLDS) { const easNum = passport.evidence_summary?.eas_score; log.info(`[audit] passport issued: quality=${passport.evidence_summary?.evidence_quality} eas=${easNum ?? 'n/a'}`) }
    return passport
  } catch (e: any) { log.warn('[audit] trust passport generation failed (non-fatal):', e.message); return null }
}

function _reportMeta(req: any, narrative: any, aepProvenance: any, cryptoSummary: any) {
  const baseUrl = process.env.APP_BASE_URL || (req ? `${req.protocol}://${req.get('host')}` : 'http://localhost:4000')
  return { agent_name: 'Procurement Copilot Agent', agent_id: 'procurement-copilot', issuer: 'Golden Path Audit Service (self-hosted)', issuer_email: '', report_url: `${baseUrl}/api/audit/report`, intended_use: 'AI-assisted procurement (Procure-to-Pay)', deployment_context: 'Node.js reference deployment', narrative: narrative ? { intro: narrative.intro, conclusion: narrative.conclusion } : undefined, aep_provenance: aepProvenance || undefined, crypto_summary: cryptoSummary || undefined }
}

async function _llmConclusion(context: any) {
  try {
    const system = `You are a senior procurement compliance auditor reviewing AI agent activity.
Based on the audit data summary provided, generate two short paragraphs:
1. "intro": 60-100 words, first-person auditor perspective, describe what was audited and the key focus areas.
2. "conclusion": 100-150 words, specific observations and 1-2 actionable recommendations.

Rules:
- Output only valid JSON: {"intro": "...", "conclusion": "..."}
- No markdown, no fences, no explanations outside the JSON.
- Base conclusions strictly on the provided data — do not invent tool names, user IDs, or actions.
- If no findings: write a specific "no anomalies" observation (e.g. "All tool calls were read-only queries with no permission denials").`
    const prompt = `Audit data summary:\n${JSON.stringify(context, null, 2)}\n\nOutput JSON {"intro":"...","conclusion":"..."}`
    const result = await callClaudeJSON({ prompt, system })
    if (result?.intro || result?.conclusion) return result
  } catch (e: any) { log.warn('[audit] LLM audit conclusion skipped:', e.message) }
  return null
}

async function _runOAAScoring(turns: any[]) {
  const [AEP, core] = await Promise.all([loadAEP(), loadCore()])
  const { events, aepRecords, aepProvenance } = await buildEventBatch(AEP, turns)
  const validation = await core.validate(events).catch(() => null)
  const cryptoSummary = validation?.crypto_summary
  const [riskScore, findings, inv] = await Promise.all([
    core.computeRiskScore(events, undefined, aepProvenance, cryptoSummary),
    core.policyAudit(events, { manifest: CAPABILITY_MANIFEST }),
    core.inventory(events).catch(() => null),
  ])
  return { events, aepRecords, aepProvenance, cryptoSummary, riskScore, findings, inv }
}

export default function registerAuditRoutes(app: any) {
  const router = express.Router()

  router.get('/summary', async (req: any, res: any) => {
    try {
      const { fromDate, toDate } = req.query
      const turns = loadTurns(fromDate, toDate)
      const toolCnt = turns.reduce((s, t) => s + t.toolCalls.length, 0)
      res.json({ turnCount: turns.length, toolCallCount: toolCnt })
    } catch (e: any) { res.status(500).json({ error: e.message }) }
  })

  router.get('/turns', async (req: any, res: any) => {
    try {
      const { fromDate, toDate, limit = 100 } = req.query
      const turns = loadTurns(fromDate, toDate)
      res.json({ value: turns.slice(0, Number(limit)) })
    } catch (e: any) { res.status(500).json({ error: e.message }) }
  })

  router.get('/analyze', async (req: any, res: any) => {
    try {
      const { fromDate, toDate } = req.query
      const turns = loadTurns(fromDate, toDate)
      if (turns.length === 0) return res.json({ easScore: 0, easGrade: 'F', arsScore: 100, eventCount: 0, findings: [] })
      const { events, riskScore, findings } = await _runOAAScoring(turns)
      res.json({ easScore: riskScore.evidence_admission_score.score, easGrade: riskScore.evidence_admission_score.grade, arsScore: riskScore.agent_risk_score.score, eventCount: events.length, components: riskScore.components, findings: findings.map((f: any) => ({ findingId: f.finding_id, ruleId: f.rule_id, severity: f.severity, category: f.category, title: f.title, description: f.description, recommendation: f.recommendation })) })
    } catch (e: any) { log.error('[audit] analyze error:', e); res.status(500).json({ error: e.message }) }
  })

  router.get('/passport', async (req: any, res: any) => {
    try {
      const { fromDate, toDate } = req.query
      const turns = loadTurns(fromDate, toDate)
      if (turns.length === 0) return res.json({ passport: null, message: 'No audit data found' })
      const { riskScore, findings, aepRecords, aepProvenance } = await _runOAAScoring(turns)
      const passport = await buildPassport(riskScore, findings, turns, aepRecords, aepProvenance)
      if (!passport) return res.status(500).json({ error: 'Passport generation failed' })
      const { status: passportStatus } = await loadPassport()
      res.json({ passport, status: passportStatus(passport), easScore: riskScore.evidence_admission_score.score, easGrade: riskScore.evidence_admission_score.grade })
    } catch (e: any) { log.error('[audit] passport error:', e); res.status(500).json({ error: e.message }) }
  })

  router.get('/report', async (req: any, res: any) => {
    try {
      const { fromDate, toDate, format = 'html' } = req.query
      const turns = loadTurns(fromDate, toDate)

      const byTool: Record<string, any> = {}
      let stateChanging = 0, errors = 0, totalToolCalls = 0
      for (const { toolCalls } of turns) {
        totalToolCalls += toolCalls.length
        for (const tc of toolCalls) {
          const s = byTool[tc.toolName] || (byTool[tc.toolName] = { count: 0, errors: 0, stateChanging: 0 })
          s.count++
          if (tc.hasError) { s.errors++; errors++ }
          if (tc.stateChanging) { s.stateChanging++; stateChanging++ }
        }
      }
      const stats = { totalToolCalls, stateChanging, errors, byTool }

      if (format === 'json') return res.json({ turns: turns.length, stats })

      let oaa: any = null
      let passport: any = null
      if (turns.length > 0) {
        try {
          const result = await _runOAAScoring(turns)
          oaa = result
          passport = await buildPassport(result.riskScore, result.findings, turns, result.aepRecords, result.aepProvenance)
        } catch (e: any) { log.warn('[audit] OAA scoring failed (non-fatal):', e.message) }
      }

      const scores = oaa ? { easScore: oaa.riskScore.evidence_admission_score.score, easGrade: oaa.riskScore.evidence_admission_score.grade, arsScore: oaa.riskScore.agent_risk_score.score, findings: oaa.findings.map((f: any) => ({ severity: f.severity, title: f.title, description: f.description, recommendation: f.recommendation })) } : null

      const llmContext = { turnCount: turns.length, totalToolCalls, stateChanging, errors, topTools: Object.entries(byTool).sort((a: any, b: any) => b[1].count - a[1].count).slice(0, 5).map(([t, s]: any) => ({ tool: t, count: s.count, errors: s.errors })), easScore: scores?.easScore ?? null, easGrade: scores?.easGrade ?? null, findingCount: scores?.findings?.length ?? 0, topFindings: (scores?.findings || []).filter((f: any) => f.severity === 'critical' || f.severity === 'high').slice(0, 3).map((f: any) => ({ severity: f.severity, title: f.title })) }
      const narrative = await _llmConclusion(llmContext)

      let oaaReportHtml = ''
      if (oaa) {
        try {
          const core = await loadCore()
          const reportBundle = await core.renderReport(oaa.events, oaa.findings, oaa.riskScore, oaa.inv, _reportMeta(req, narrative, oaa.aepProvenance, oaa.cryptoSummary))
          oaaReportHtml = reportBundle.html
        } catch (e: any) { log.warn('[audit] renderReport failed (non-fatal):', e.message) }
      }

      if (format === 'markdown' && oaa) {
        const core = await loadCore()
        const bundle = await core.renderReport(oaa.events, oaa.findings, oaa.riskScore, oaa.inv, _reportMeta(req, narrative, oaa.aepProvenance, oaa.cryptoSummary))
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        return res.send(bundle.markdown)
      }

      if (format === 'csv' && oaa) {
        const core = await loadCore()
        const bundle = await core.renderReport(oaa.events, oaa.findings, oaa.riskScore, oaa.inv, _reportMeta(req, null, oaa.aepProvenance, oaa.cryptoSummary))
        res.setHeader('Content-Type', 'text/csv; charset=utf-8')
        res.setHeader('Content-Disposition', 'attachment; filename="agent-audit.csv"')
        return res.send(bundle.csv)
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      let passportInspect = ''
      if (passport) {
        try { const { inspectTrustPassport } = await loadPassport(); passportInspect = inspectTrustPassport(passport, { verbose: false }) } catch { /* non-fatal */ }
      }
      res.send(renderHTML({ turns, stats, scores, passport, passportInspect }, narrative, oaaReportHtml))
    } catch (e: any) { log.error('[audit] report error:', e); res.status(500).json({ error: e.message }) }
  })

  app.use('/api/audit', router)
}

function _sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/\bon\w+\s*=/gi, 'data-removed-')
    .replace(/javascript\s*:/gi, 'removed:')
}

function renderHTML(data: any, narrative: any, oaaReportHtml: string): string {
  const { turns, stats, scores, passport, passportInspect } = data
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC'

  const esc = (s: any) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  const gradeColor = (g: string) => ({ A:'#059669', B:'#16a34a', C:'#ca8a04', D:'#ea580c', F:'#dc2626' }[g] || '#6b7280')

  const toolRows = Object.entries(stats.byTool || {}).sort((a: any, b: any) => b[1].count - a[1].count).map(([tool, s]: any) => `
    <tr><td><code>${esc(tool)}</code></td><td>${s.count}</td><td>${s.errors}</td><td>${s.errors > 0 ? ((s.errors/s.count*100).toFixed(1)+'%') : '—'}</td><td>${s.stateChanging}</td></tr>`).join('')

  const turnRows = turns.slice(0, 50).map((t: any, i: number) => `
    <tr><td>${i+1}</td><td>${esc(t.turnRow.calledAt?.slice(0,19) || '')}</td><td>${esc(t.turnRow.userId)}</td><td>${t.toolCalls.length}</td><td>${t.toolCalls.filter((c: any) => c.stateChanging).length}</td><td>${t.toolCalls.filter((c: any) => c.hasError).length}</td><td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(t.turnRow.userMessage?.slice(0,120) || '')}</td></tr>`).join('')

  const easScore = scores?.easScore ?? null
  const easGrade = scores?.easGrade ?? 'N/A'
  const arsScore = scores?.arsScore ?? null

  const passportBadge = passport ? `
<div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 18px;margin:16px 0;background:linear-gradient(90deg,#f0fdf4,#fff 70%)">
  <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
    <div style="font-size:22px">🛡️</div>
    <div>
      <div style="font-weight:700;font-size:14px;color:#166534">Trust Passport Issued</div>
      <div style="font-size:12px;color:#6b7280;margin-top:2px">
        ID: <code style="background:#f3f4f6;padding:1px 5px;border-radius:3px">${esc(passport.identity?.passport_id ?? passport.passport_id)}</code> ·
        Quality: <strong>${esc(passport.evidence_summary?.evidence_quality ?? 'N/A')}</strong>
        ${passport.evidence_summary?.eas_score != null ? `· EAS: <strong>${Math.round(passport.evidence_summary.eas_score)}</strong>` : ''} ·
        Valid until: ${esc(passport.validity?.expires_at?.slice(0,10) ?? 'N/A')} ·
        Facts: ${Object.keys(passport.evidence_facts || {}).length} ·
        Signing: ${esc(passport.attestation?.signing_method ?? 'none')}
      </div>
    </div>
  </div>
  ${passportInspect ? `<details style="margin-top:10px"><summary style="cursor:pointer;font-size:12px;color:#6b7280">Passport details</summary><pre style="font-size:11px;background:#f9fafb;padding:10px;border-radius:6px;margin-top:6px;overflow:auto">${esc(passportInspect)}</pre></details>` : ''}
</div>` : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Procurement Copilot — Agent Audit Report</title>
<style>
:root{--accent:#4f46e5;--border:#e5e7eb;--muted:#6b7280;--bg:#fff;--code-bg:#f3f4f6}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:960px;margin:0 auto;padding:32px 24px 64px;color:#1f2937;font-size:14px;line-height:1.6}
.no-print{text-align:right;margin-bottom:16px}
.no-print button{padding:7px 16px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px}
.cover{border:1px solid var(--border);border-radius:12px;padding:28px 32px;margin-bottom:28px;background:linear-gradient(135deg,#eef2ff 0%,#fff 60%)}
.cover h1{margin:0 0 6px;font-size:24px;color:var(--accent)}
.cover .sub{color:var(--muted);font-size:13px;margin-bottom:16px}
.cover-meta{display:grid;grid-template-columns:max-content 1fr;gap:5px 20px;font-size:13px}
.cover-meta dt{color:var(--muted);font-weight:500}
.cover-meta dd{margin:0}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:24px 0}
.card{border:1px solid var(--border);border-radius:10px;padding:16px 18px;position:relative;overflow:hidden}
.card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--cc,var(--accent))}
.card .lbl{color:var(--muted);font-size:12px;letter-spacing:.3px}
.card .val{font-size:30px;font-weight:700;line-height:1.1}
.card .hint{color:var(--muted);font-size:11px}
.bar{margin-top:6px;height:6px;border-radius:3px;background:var(--border);overflow:hidden}
.bar span{display:block;height:100%;background:var(--cc,var(--accent))}
.card-risk{--cc:#b45309}.card-deny{--cc:#dc2626}.card-eas{--cc:var(--accent)}.card-ars{--cc:#059669}
h2{border-bottom:1px solid var(--border);padding-bottom:6px;margin:32px 0 12px;font-size:17px}
h3{margin:20px 0 8px;font-size:14px;color:var(--accent);font-weight:600}
table{border-collapse:collapse;width:100%;margin:8px 0 16px;font-size:13px}
th,td{border:1px solid var(--border);padding:8px 10px;text-align:left;vertical-align:top}
th{background:#f9fafb;font-weight:600;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.3px}
tbody tr:nth-child(even){background:#fafbfc}
code{background:var(--code-bg);padding:1px 5px;border-radius:3px;font-size:12px;font-family:"SF Mono",Consolas,monospace}
.narrative{background:linear-gradient(90deg,#eef2ff,transparent 70%);border-left:3px solid var(--accent);padding:12px 16px;margin:12px 0;font-size:14px;line-height:1.7;border-radius:0 6px 6px 0}
.oaa-section{border:1px solid var(--border);border-radius:10px;padding:20px;margin:24px 0}
.oaa-section h2{margin-top:0}
.footer{color:var(--muted);font-size:12px;margin-top:32px;padding-top:12px;border-top:1px solid var(--border)}
@media print{.no-print{display:none}body{max-width:100%;padding:12px;font-size:11pt}.cover{background:none;page-break-inside:avoid}h2,h3{page-break-after:avoid}table{font-size:9pt}}
</style>
</head>
<body>
<div class="no-print"><button onclick="window.print()">🖨 Print / Export PDF</button></div>
<div class="cover">
  <h1>Procurement Copilot — Agent Audit Report</h1>
  <div class="sub">AI Procurement Copilot — Agent Execution Trace</div>
  <dl class="cover-meta">
    <dt>Generated</dt><dd>${now}</dd>
    <dt>Total Turns</dt><dd>${turns.length}</dd>
    <dt>Tool Calls</dt><dd>${stats.totalToolCalls}</dd>
    <dt>State-Changing</dt><dd>${stats.stateChanging}</dd>
    <dt>Errors</dt><dd>${stats.errors}</dd>
  </dl>
</div>
${passportBadge}
${narrative?.intro ? `<div class="narrative">${esc(narrative.intro)}</div>` : ''}
<div class="cards">
  <div class="card card-risk"><div class="lbl">OAA Findings</div><div class="val">${scores?.findings?.length ?? 0}</div><div class="hint">policy violations</div></div>
  <div class="card card-deny"><div class="lbl">State-Changing Ops</div><div class="val">${stats.stateChanging}</div><div class="hint">write operations</div></div>
  <div class="card card-eas" style="--cc:${gradeColor(easGrade)}"><div class="lbl">EAS · Evidence Score (${easGrade})</div><div class="val">${easScore !== null ? Math.round(easScore) : 'N/A'}</div><div class="hint">/ 100</div>${easScore !== null ? `<div class="bar"><span style="width:${Math.round(easScore)}%"></span></div>` : ''}</div>
  <div class="card card-ars"><div class="lbl">ARS · Agent Risk</div><div class="val">${arsScore !== null ? Math.round(arsScore) : 'N/A'}</div><div class="hint">/ 100 (higher = safer)</div>${arsScore !== null ? `<div class="bar"><span style="width:${Math.round(arsScore)}%"></span></div>` : ''}</div>
</div>
<h2>Tool Call Statistics</h2>
<table><thead><tr><th>Tool</th><th>Calls</th><th>Errors</th><th>Error Rate</th><th>State-Changing</th></tr></thead><tbody>${toolRows || '<tr><td colspan="5" style="color:var(--muted)">No tool calls recorded.</td></tr>'}</tbody></table>
<h2>Turn Detail (most recent 50)</h2>
<table><thead><tr><th>#</th><th>Time</th><th>User</th><th>Tools</th><th>Writes</th><th>Errors</th><th>User Message</th></tr></thead><tbody>${turnRows || '<tr><td colspan="7" style="color:var(--muted)">No turns recorded.</td></tr>'}</tbody></table>
${narrative?.conclusion ? `<h2>Auditor Conclusion</h2><div class="narrative">${esc(narrative.conclusion)}</div>` : ''}
${oaaReportHtml ? `<div class="oaa-section"><h2>OAA Compliance Framework Analysis</h2><p style="color:var(--muted);font-size:12px;margin-bottom:16px">Generated by <a href="https://github.com/WasmAgent/open-agent-audit" target="_blank">open-agent-audit</a> · includes OWASP Agentic Top 10, EU AI Act, NIST AI RMF, ISO 42001 mappings</p>${_sanitizeHtml(oaaReportHtml)}</div>` : ''}
<div class="footer">Report generated ${now} · Procurement Copilot Audit System · Evidence format: <a href="https://github.com/WasmAgent/wasmagent-js/tree/main/packages/aep" target="_blank">AEP</a> + <a href="https://github.com/WasmAgent/open-agent-audit" target="_blank">open-agent-audit</a></div>
</body></html>`
}
