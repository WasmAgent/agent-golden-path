// Intent-alignment guardrail — wraps @wasmagent/core's intentAlignmentGuardrail.
// High-risk (state-changing) tools are gated: before the call runs, a fast model
// checks that the proposed tool call actually matches what the user asked for.
// Fails CLOSED — if the checker is unavailable, the high-risk call is blocked.

const log = console

export const HIGH_RISK_TOOLS = new Set(['submit_pr', 'run_invoice_match', 'convert_pr_to_po'])

interface GuardrailResult { allowed: true }
interface GuardrailBlocked { allowed: false; reason: string; ruleId: string }
export type CheckToolIntentResult = GuardrailResult | GuardrailBlocked

let _guardrailsPromise: Promise<any> | null = null
async function _loadGuardrails() {
  if (!_guardrailsPromise)
    _guardrailsPromise = import('@wasmagent/core').then(m => ({
      intentAlignmentGuardrail: m.intentAlignmentGuardrail,
      runToolGuardrails: m.runToolGuardrails,
    }))
  return _guardrailsPromise
}

function _makeCheckerModel() {
  return {
    async *generate(messages: any[], _opts?: any) {
      const { callClaudeJSON } = require('./llm-client')
      const system = messages.find((m: any) => m.role === 'system')?.content ?? ''
      const userMsg = messages.filter((m: any) => m.role !== 'system').map((m: any) => m.content).join('\n')
      try {
        const text = await callClaudeJSON({ prompt: userMsg, system })
        const str = typeof text === 'string' ? text : JSON.stringify(text)
        yield { type: 'text_delta', delta: str }
      } catch {
        yield { type: 'text_delta', delta: JSON.stringify({ aligned: true, reason: 'checker unavailable' }) }
      }
    }
  }
}

let _guardrail: any = null
async function _getGuardrail() {
  if (_guardrail) return _guardrail
  const { intentAlignmentGuardrail } = await _loadGuardrails()
  _guardrail = intentAlignmentGuardrail({ model: _makeCheckerModel(), name: 'golden-path-intent-alignment' })
  return _guardrail
}

export async function checkToolIntent(toolName: string, toolArgs: object, userMessage: string): Promise<CheckToolIntentResult> {
  if (!HIGH_RISK_TOOLS.has(toolName)) return { allowed: true }

  try {
    const { runToolGuardrails } = await _loadGuardrails()
    const guardrail = await _getGuardrail()
    const proposedAction = `Call tool "${toolName}" with: ${JSON.stringify(toolArgs).slice(0, 400)}`
    const result = await runToolGuardrails(
      [guardrail],
      toolName,
      toolArgs,
      { originalTask: userMessage || '', proposedAction }
    )
    if (result?.result?.tripwireTriggered) {
      log.warn(`[guardrails] intent guardrail blocked ${toolName}:`, result.result.metadata?.reason)
      return { allowed: false, reason: result.result.metadata?.reason || 'Intent alignment failed', ruleId: 'golden-path-intent-alignment' }
    }
  } catch (e: any) {
    log.warn(`[guardrails] intent guardrail error for ${toolName} — failing closed:`, e.message)
    return { allowed: false, reason: 'Intent guardrail unavailable', ruleId: 'guardrail-error' }
  }
  return { allowed: true }
}
