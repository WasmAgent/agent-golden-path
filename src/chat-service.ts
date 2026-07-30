// Chat service — the SSE endpoint that drives one agent turn.
//
// This is where the chain begins: every turn creates a @wasmagent/core agent,
// runs it, gates high-risk tool calls through the intent guardrail, and records
// every tool call to the chat tool log (which audit-service later turns into
// signed evidence). Tool spans are also exported over OTLP when configured.

import express, { Request, Response } from 'express'
import { randomUUID } from 'crypto'
import { Readable } from 'stream'
import { getSystemPrompt } from './chat/system-prompt'
import { ALL_TOOL_DEFS, MUTATING } from './chat/tool-definitions'
import { sseWrite } from './chat/sse'
import * as panelStore from './chat/panel-store'
import { checkToolIntent } from './guardrails'
import { buildMemoryContext } from './memory-service'
import { createAgent, injectHistoryIntoAssembler } from './agent-engine'
import * as store from './store'

const log = console
const router = express.Router()

// ── OpenTelemetry span export (optional) ──────────────────────────────────────
let _otelExporter: any = null
let _otelExporterInitialized = false

async function _getOtelExporter(): Promise<any> {
  if (_otelExporterInitialized) return _otelExporter
  _otelExporterInitialized = true
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT
  if (!endpoint) return null
  try {
    const { OtlpHttpExporter } = await import('@wasmagent/otel-exporter')
    _otelExporter = new OtlpHttpExporter({ endpoint, serviceName: 'procurement-copilot' })
  } catch (e: any) {
    log.warn('[otel] failed to init OtlpHttpExporter:', e.message)
  }
  return _otelExporter
}

async function _exportChatSpan(opts: {
  turnId: string; userId: string; startMs: number; durationMs: number
  toolCallCount: number; estimatedInputTokens: number; hasError: boolean
}): Promise<void> {
  try {
    const exporter = await _getOtelExporter()
    if (!exporter) return
    const hexId = opts.turnId.replace(/-/g, '')
    exporter.export([{
      traceId: hexId.padEnd(32, '0').slice(0, 32),
      spanId: hexId.slice(0, 16),
      name: 'procurement.chat.turn',
      startTimeMs: opts.startMs,
      endTimeMs: opts.startMs + opts.durationMs,
      attributes: {
        userId: opts.userId,
        turnId: opts.turnId,
        toolCallCount: opts.toolCallCount,
        estimatedInputTokens: opts.estimatedInputTokens,
        hasError: opts.hasError,
      },
      status: opts.hasError ? 'error' : 'ok',
      events: [],
    }])
  } catch { /* never crash the response */ }
}

router.use(express.json({ limit: '2mb' }))

const RATE_LIMIT_RPM = Number(process.env.CHAT_RATE_LIMIT_RPM ?? 20)
const RATE_LIMIT_BURST = Number(process.env.CHAT_RATE_LIMIT_BURST ?? 5)
const RATE_EVICT_MS = 10 * 60 * 1000

interface Bucket { tokens: number; lastMs: number }
const _rateBuckets = new Map<string, Bucket>()

function _checkRateLimit(key: string): boolean {
  const now = Date.now()
  if (_rateBuckets.size > 10_000) {
    for (const [k, b] of _rateBuckets)
      if (now - b.lastMs > RATE_EVICT_MS) _rateBuckets.delete(k)
  }
  const b = _rateBuckets.get(key) ?? { tokens: RATE_LIMIT_BURST, lastMs: now }
  const elapsed = now - b.lastMs
  b.tokens = Math.min(RATE_LIMIT_BURST, b.tokens + (elapsed / 60_000) * RATE_LIMIT_RPM)
  b.lastMs = now
  if (b.tokens < 1) { _rateBuckets.set(key, b); return false }
  b.tokens -= 1
  _rateBuckets.set(key, b)
  return true
}

interface ToolLogFields {
  userId?: string; turnId?: string; toolName: string; toolArgs?: any; toolResult?: any
  durationMs?: number; hasError?: boolean; errorMessage?: string; outcome?: string
  stateChanging?: boolean; userMessage?: string; ip?: string; correlationId?: string
}

function _logToolCall(fields: ToolLogFields): void {
  try {
    store.insertChatToolLog({
      id: randomUUID(),
      calledAt: new Date().toISOString(),
      userId: fields.userId || 'demo_user',
      turnId: fields.turnId || '',
      toolName: fields.toolName,
      toolArgs: fields.toolArgs ? JSON.stringify(fields.toolArgs).slice(0, 4000) : '',
      toolResult: fields.toolResult ? JSON.stringify(fields.toolResult).slice(0, 4000) : '',
      durationMs: fields.durationMs || 0,
      hasError: !!fields.hasError,
      errorMessage: fields.errorMessage || '',
      outcome: fields.outcome || 'allow',
      stateChanging: !!fields.stateChanging,
      userMessage: (fields.userMessage || '').slice(0, 4000),
      assistantMessage: '',
      ipAddress: fields.ip || '',
      correlationId: fields.correlationId || '',
    })
  } catch (e: any) {
    log.warn('[chat] ChatToolLog write failed:', e.message)
  }
}

function _updateTurnReply(turnId: string, assistantMessage: string): void {
  const row = store.chatToolLog().find(r => r.turnId === turnId && r.toolName === '__turn__')
  if (row) row.assistantMessage = assistantMessage.slice(0, 4000)
}

let _approvalStore: any = null
async function _getApprovalStore() {
  if (_approvalStore) return _approvalStore
  const { InMemoryApprovalStore } = await import('@wasmagent/core')
  _approvalStore = new InMemoryApprovalStore()
  return _approvalStore
}

router.get('/health', (_req: Request, res: Response) => res.json({ status: 'ok' }))

router.get('/mode', async (_req: Request, res: Response) => {
  res.json({ mode: 'offline', configured: false })
})

router.get('/approvals', async (_req: Request, res: Response) => {
  try {
    const s = await _getApprovalStore()
    res.json({ value: s.getAll().filter((r: any) => r.status === 'pending') })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

router.post('/approvals/:requestId/decide', async (req: Request, res: Response) => {
  try {
    const s = await _getApprovalStore()
    const { decision, reviewer, reason } = req.body || {}
    if (!['approved', 'rejected'].includes(decision))
      return res.status(400).json({ error: 'decision must be approved or rejected' }) as any
    await s.update(req.params.requestId, { status: decision, decidedAt: new Date().toISOString(), reviewer: reviewer || 'unknown', reason: reason || '' })
    res.json({ ok: true })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

router.post('/reset-db', async (_req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') return res.status(403).json({ error: 'forbidden in production' }) as any
  store.resetToSeed()
  res.json({ status: 'ok' })
})

router.get('/audit', async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate } = req.query as Record<string, string>
    const ISO = /^\d{4}-\d{2}-\d{2}$/
    if (fromDate && !ISO.test(fromDate)) return res.status(400).json({ error: 'Invalid fromDate' }) as any
    if (toDate   && !ISO.test(toDate))   return res.status(400).json({ error: 'Invalid toDate' }) as any
    let rows = [...store.auditLog()].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || '')).slice(0, 500)
    if (fromDate) rows = rows.filter(r => r.timestamp >= `${fromDate}T00:00:00Z`)
    if (toDate)   rows = rows.filter(r => r.timestamp <= `${toDate}T23:59:59Z`)
    res.json({ value: rows })
  } catch (e: any) { res.status(500).json({ error: e.message }) }
})

router.post('/stream', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  const corsOrigin = process.env.CORS_ORIGIN
  if (corsOrigin) res.setHeader('Access-Control-Allow-Origin', corsOrigin)
  ;(res as any).flushHeaders()

  const { messages, viewContext } = req.body
  if (!Array.isArray(messages) || messages.length === 0) {
    sseWrite(res, { type: 'error', message: 'messages array is required' })
    sseWrite(res, { type: 'done' })
    return res.end()
  }

  const userId = req.headers['x-user-id'] as string || process.env.DEFAULT_USER_ID || 'demo_user'
  const ip = req.headers['x-forwarded-for'] as string || (req as any).ip || 'unknown'
  const rateLimitKey = userId !== 'demo_user' ? `user:${userId}` : `ip:${ip}`
  if (!_checkRateLimit(rateLimitKey)) {
    sseWrite(res, { type: 'error', message: 'Rate limit exceeded. Please wait before sending another message.' })
    sseWrite(res, { type: 'done' })
    return res.end()
  }
  const turnId = randomUUID()
  const lastMsg = messages[messages.length - 1]
  const userMessage = Array.isArray(lastMsg?.content)
    ? lastMsg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
    : (typeof lastMsg?.content === 'string' ? lastMsg.content : '')
  const panelSessionId: string | null = req.body.panelSessionId || req.headers['x-panel-session'] as string || null

  const effectiveViewContext = (viewContext && Object.keys(viewContext).length > 0)
    ? viewContext
    : (panelSessionId ? panelStore.serializeViewContext(panelSessionId) : viewContext)

  const turnStartMs = Date.now()
  const memoryCtx = await buildMemoryContext(userId).catch(() => '')
  const systemPrompt = getSystemPrompt(effectiveViewContext, { erpConnected: false }) + memoryCtx

  let estimatedInputTokens = 0
  try {
    const { estimateMessagesTokens } = await import('@wasmagent/core')
    estimatedInputTokens = estimateMessagesTokens(messages) + Math.ceil(systemPrompt.length / 4)
  } catch { /* non-fatal */ }

  _logToolCall({ turnId, userId, ip, toolName: '__turn__', userMessage, outcome: 'allow', toolArgs: { estimatedInputTokens } })

  try {
    const tools = ALL_TOOL_DEFS.map(t => ({
      ...t,
      _ctx: { userId, ip },
      forward: async (input: any, signal?: AbortSignal) => {
        const toolDef = ALL_TOOL_DEFS.find(d => d.name === t.name)!

        if (t.name === 'ui_action') {
          sseWrite(res, { type: 'ui_action', action: input })
          if (panelSessionId) { try { panelStore.applyAction(panelSessionId, input, 'agent') } catch { /* non-fatal */ } }
          _logToolCall({ turnId, userId, ip, toolName: t.name, toolArgs: input, toolResult: { ok: true }, durationMs: 0, outcome: 'allow', userMessage })
          return { ok: true }
        }

        if (t.name === 'get_view_state') {
          const viewState = panelSessionId ? panelStore.serializeViewContext(panelSessionId) : (effectiveViewContext || {})
          _logToolCall({ turnId, userId, ip, toolName: t.name, toolArgs: input, toolResult: viewState, durationMs: 0, outcome: 'allow', userMessage })
          return viewState
        }

        const t0 = Date.now()
        const intent = await checkToolIntent(t.name, input, userMessage)
        if (!intent.allowed) {
          const blocked = { error: `⛔ Blocked by intent-alignment guardrail: ${(intent as any).reason}` }
          _logToolCall({ turnId, userId, ip, toolName: t.name, toolArgs: input, toolResult: blocked, durationMs: Date.now() - t0, hasError: true, errorMessage: (intent as any).reason, outcome: 'block', stateChanging: MUTATING.has(t.name), userMessage })
          return blocked
        }
        const boundTool = { ...toolDef, _ctx: { userId, ip, callId: turnId } }
        const result = await toolDef.forward.call(boundTool, input, signal)
        const durationMs = Date.now() - t0
        const hasError = !!(result?.error)

        _logToolCall({ turnId, userId, ip, toolName: t.name, toolArgs: input, toolResult: result, durationMs, hasError, errorMessage: hasError ? String(result.error) : '', outcome: hasError ? 'error' : 'allow', stateChanging: MUTATING.has(t.name), userMessage })
        return result
      },
    }))

    const sessionId = `${userId}-${Date.now()}`
    const { agent, obsMemory } = await createAgent({ tools, systemPrompt, sessionId })

    const priorMessages = messages.slice(0, -1)
    if (priorMessages.length > 0) {
      await injectHistoryIntoAssembler(agent.assembler, priorMessages)
      obsMemory.noteStep()
    }

    const task = typeof userMessage === 'string' ? userMessage : JSON.stringify(userMessage)
    let finalAnswer = ''
    let toolCallCount = 0

    for await (const ev of agent.run(task)) {
      switch ((ev as any).event) {
        case 'tool_call':
          sseWrite(res, { type: 'tool_start', call_id: (ev as any).data.callId, name: (ev as any).data.toolName })
          break
        case 'tool_result':
          toolCallCount++
          sseWrite(res, { type: 'tool_end', call_id: (ev as any).data.callId, count: toolCallCount })
          obsMemory.noteStep()
          break
        case 'final_answer': {
          const answer = typeof (ev as any).data.answer === 'string' ? (ev as any).data.answer : JSON.stringify((ev as any).data.answer)
          finalAnswer = answer
          sseWrite(res, { type: 'text', delta: answer })
          obsMemory.noteStep()
          break
        }
        case 'model_done': {
          const d = (ev as any).data
          log.info(`[chat] step=${d.step} model=${d.modelId} in=${d.inputTokens ?? 0} out=${d.outputTokens ?? 0} cache_hit=${d.cacheReadTokens ?? 0} hit_rate=${((d.cacheHitRate ?? 0) * 100).toFixed(1)}% est=$${(d.estimatedUsd ?? 0).toFixed(4)}`)
          break
        }
        case 'await_human_input': {
          const s = await _getApprovalStore()
          const requestId = (ev as any).data.promptId
          await s.put({ requestId, toolName: (ev as any).data.prompt, status: 'pending', createdAt: new Date().toISOString() })
          sseWrite(res, { type: 'status', text: `⏳ Awaiting approval (id: ${requestId.slice(0, 8)})` })
          break
        }
        case 'error':
          log.error('[chat] agent error:', (ev as any).data.error)
          sseWrite(res, { type: 'error', message: (ev as any).data.error })
          break
        case 'status':
          if ((ev as any).data?.phase === 'tool_executing') break
          if ((ev as any).event === 'planning') { sseWrite(res, { type: 'status', text: `🗂 ${String((ev as any).data?.plan || '').slice(0, 120)}` }) }
          break
      }
    }

    if (finalAnswer.trim()) {
      _updateTurnReply(turnId, finalAnswer)
      _exportChatSpan({ turnId, userId, startMs: turnStartMs, durationMs: Date.now() - turnStartMs, toolCallCount, estimatedInputTokens, hasError: false }).catch(() => {})
      try {
        const suggestions = await _generateSuggestions(messages.slice(-4), finalAnswer)
        if (suggestions.length > 0) sseWrite(res, { type: 'suggestions', items: suggestions })
      } catch { /* non-critical */ }
    }
  } catch (err: any) {
    log.error('[chat] stream error:', err)
    sseWrite(res, { type: 'error', message: err.message })
    _exportChatSpan({ turnId, userId, startMs: turnStartMs, durationMs: Date.now() - turnStartMs, toolCallCount: 0, estimatedInputTokens, hasError: true }).catch(() => {})
  }

  sseWrite(res, { type: 'done' })
  res.end()
})

const SUGGEST_SYSTEM = `You are a next-step suggestion generator for a procurement assistant.
Given the assistant's last reply and recent conversation history, output 1-4 concise follow-up actions the user is most likely to want next.

Rules:
- Output only a valid JSON array, no prose or markdown fences
- Each item: {"label": "<≤20 chars>", "text": "<imperative sentence the user can send>"}
- text must be self-contained (include entity IDs if known)
- Do not suggest actions already completed in this turn
- Return [] if no sensible next step exists

Example: [{"label":"View PR details","text":"Show me the details of PR-000001"},{"label":"Check budget","text":"Check the budget for cost centre CC-IT-001"}]`

async function _generateSuggestions(recentHistory: any[], assistantReply: string): Promise<Array<{ label: string; text: string }>> {
  if (!assistantReply.trim()) return []
  const { callClaudeJSON } = await import('./llm-client')
  const historyText = recentHistory.map(m => `[${m.role}]: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n')
  const prompt = `Recent conversation:\n${historyText}\n\nAssistant just replied:\n${assistantReply}\n\nOutput the JSON array of suggestions:`
  try {
    const result = await callClaudeJSON({ prompt, system: SUGGEST_SYSTEM })
    if (!Array.isArray(result)) return []
    const seen = new Set<string>()
    return result.filter((item: any) => item.label && item.text && !seen.has(item.text) && seen.add(item.text)).slice(0, 4).map((item: any) => ({ label: String(item.label).slice(0, 22), text: String(item.text) }))
  } catch { return [] }
}

// ── AG-UI SSE endpoint (optional) ─────────────────────────────────────────────
// GET /api/chat/ag-ui/events?task=...
// Streams an AG-UI protocol SSE response, compatible with AG-UI-aware frontends.
router.get('/ag-ui/events', async (req: Request, res: Response) => {
  if (!process.env.AG_UI_ENABLED) return res.status(404).json({ error: 'AG-UI not enabled' }) as any

  const task = (req.query.task as string) || ''
  if (!task.trim()) return res.status(400).json({ error: 'task query param is required' }) as any

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  const corsOrigin = process.env.CORS_ORIGIN
  if (corsOrigin) res.setHeader('Access-Control-Allow-Origin', corsOrigin)
  ;(res as any).flushHeaders()

  try {
    const { toAgUiSseStream } = await import('@wasmagent/ag-ui')
    const systemPrompt = getSystemPrompt({}, {})
    const { agent } = await createAgent({ tools: ALL_TOOL_DEFS, systemPrompt, sessionId: `ag-ui-${Date.now()}` })
    const runId = randomUUID()
    const webStream = toAgUiSseStream(agent.run(task), runId)
    const nodeStream = Readable.fromWeb(webStream as any)
    nodeStream.pipe(res)
    nodeStream.on('end', () => res.end())
    nodeStream.on('error', (err: Error) => {
      log.error('[ag-ui] stream error:', err)
      res.end()
    })
  } catch (err: any) {
    log.error('[ag-ui] setup error:', err)
    res.write(`data: ${JSON.stringify({ type: 'error', message: err.message })}\n\n`)
    res.end()
  }
})

export default router
