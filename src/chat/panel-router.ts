import express, { Request, Response } from 'express'
import * as store from './panel-store'
import { executeTool } from './execute-tool'

const router = express.Router()
router.use(express.json({ limit: '256kb' }))

function _source(req: Request): string {
  return String(req.query.source || req.get('X-Panel-Source') || ((req.body as any)?._source) || 'api')
}

function sid(req: Request): string {
  return req.params.sessionId as string
}

router.get('/:sessionId', (req: Request, res: Response) => {
  res.json({ sessionId: sid(req), state: store.getState(sid(req)) })
})

router.get('/:sessionId/view-context', (req: Request, res: Response) => {
  res.json({ sessionId: sid(req), viewContext: store.serializeViewContext(sid(req)) })
})

router.put('/:sessionId', (req: Request, res: Response) => {
  const patch = (req.body && typeof req.body === 'object') ? req.body : {}
  const state = store.replaceState(sid(req), patch, _source(req))
  res.json({ sessionId: sid(req), state })
})

router.post('/:sessionId/action', (req: Request, res: Response) => {
  const action = (req.body && typeof req.body === 'object') ? req.body : {}
  if (!action.type) return res.status(400).json({ error: 'action.type is required' }) as any
  const state = store.applyAction(sid(req), action, _source(req))
  res.json({ sessionId: sid(req), state })
})

router.post('/:sessionId/form/save', async (req: Request, res: Response) => {
  const sessionId = sid(req)
  const state = store.getState(sessionId)
  if (!state.detailOpen || state.detailMode !== 'edit') {
    return res.status(409).json({ error: 'no editable form is open' }) as any
  }
  const f = (state.formFields || {}) as Record<string, any>
  const args = {
    draftId:        state.formDraftId || undefined,
    materialId:     f.materialId,
    description:    f.description,
    quantity:       f.quantity != null && f.quantity !== '' ? Number(f.quantity) : undefined,
    unit:           f.unit,
    estimatedPrice: f.estimatedPrice != null && f.estimatedPrice !== '' ? Number(f.estimatedPrice) : undefined,
    currency:       f.currency,
    costCentreId:   f.costCenterId,
    vendorId:       f.vendorId,
    requiredDate:   f.requiredBy || f.requiredDate,
  }
  const userId = req.headers['x-user-id'] as string || process.env.DEFAULT_USER_ID || 'demo_user'
  try {
    const { result } = await executeTool('save_pr_draft', args, { userId })
    if (result?.error) return res.status(400).json({ error: result.error }) as any
    const next = store.applyAction(sessionId, { type: 'COMMIT_FORM', draftId: result.draftId }, _source(req))
    res.json({ sessionId, saved: true, draftId: result.draftId, action: result.action, state: next })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

router.get('/:sessionId/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  const corsOrigin = process.env.CORS_ORIGIN
  if (corsOrigin) res.setHeader('Access-Control-Allow-Origin', corsOrigin)
  ;(res as any).flushHeaders?.()

  const sessionId = sid(req)
  const subscriberSource = _source(req)
  res.write(`data: ${JSON.stringify({ type: 'state', state: store.getState(sessionId), source: 'snapshot' })}\n\n`)

  const unsubscribe = store.subscribe(sessionId, ({ state, source }) => {
    if (source === subscriberSource) return
    try { res.write(`data: ${JSON.stringify({ type: 'state', state, source })}\n\n`) } catch { cleanup() }
  })

  const keepAlive = setInterval(() => {
    try { res.write(': keep-alive\n\n') } catch { cleanup() }
  }, 25_000)

  let cleaned = false
  function cleanup() {
    if (cleaned) return
    cleaned = true
    clearInterval(keepAlive)
    unsubscribe()
    res.end()
  }

  req.on('close', cleanup)
  req.on('error', cleanup)
  res.on('error', cleanup)
})

export default router
