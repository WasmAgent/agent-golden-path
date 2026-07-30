// Anthropic LLM client — streaming + one-shot JSON helpers.
//
// This reference app talks to the Anthropic API directly. To route through a
// gateway or a self-hosted proxy, set ANTHROPIC_BASE_URL. The provable-agent
// chain does not care which model backs it — only that calls are recorded.

import Anthropic from '@anthropic-ai/sdk'

const log = console

let _sdkClient: Anthropic | null = null
function _getSdkClient(): Anthropic {
  if (!_sdkClient) {
    _sdkClient = new Anthropic({
      baseURL: process.env.ANTHROPIC_BASE_URL,
      apiKey: process.env.ANTHROPIC_API_KEY || 'placeholder',
    })
  }
  return _sdkClient
}

function _cachedSystem(systemPrompt: string): any[] {
  return [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
}

function _cachedTools(tools: any[]): any[] {
  if (!tools || tools.length === 0) return tools
  const result = tools.map(t => ({ ...t }))
  result[result.length - 1] = { ...result[result.length - 1], cache_control: { type: 'ephemeral' } }
  return result
}

const MAX_MSG_TOKENS = Number(process.env.CHAT_MAX_MSG_TOKENS) || 160_000
const KEEP_HEAD = 1
const KEEP_TAIL = 6

function _estimateTokens(value: any): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return Math.ceil(text.length / 4)
}

function _estimateMessagesTokens(messages: any[]): number {
  return messages.reduce((sum, m) => {
    const c = m.content
    if (typeof c === 'string') return sum + _estimateTokens(c)
    if (Array.isArray(c)) return sum + c.reduce((s: number, b: any) => {
      if (b.type === 'text') return s + _estimateTokens(b.text || '')
      if (b.type === 'tool_result') return s + _estimateTokens(b.content || '')
      if (b.type === 'tool_use') return s + _estimateTokens(b.input)
      if (b.type === 'thinking') return s + _estimateTokens(b.thinking || '')
      return s
    }, 0)
    return sum
  }, 0)
}

function _guardContextWindow(messages: any[]): any[] {
  let tokens = _estimateMessagesTokens(messages)
  if (tokens <= MAX_MSG_TOKENS) return messages
  if (messages.length <= KEEP_HEAD + KEEP_TAIL) return messages
  let trimmed = messages
  while (tokens > MAX_MSG_TOKENS && trimmed.length > KEEP_HEAD + KEEP_TAIL) {
    trimmed = [...trimmed.slice(0, KEEP_HEAD), ...trimmed.slice(KEEP_HEAD + 1)]
    tokens = _estimateMessagesTokens(trimmed)
  }
  log.warn(`[llm] context trimmed to ${trimmed.length} messages (~${tokens} tokens)`)
  return trimmed
}

export interface StreamChunk {
  type: 'text' | 'tool_start' | 'tool_args_delta' | 'tool_end'
  delta?: string
  call_id?: string
  name?: string
}

export interface StreamResult {
  toolCalls: Array<{ call_id: string; name: string; arguments: string }>
  hasToolCalls: boolean
  stopReason: string
  usage?: any
}

export async function callClaudeStream(
  { model, systemPrompt, messages, tools }: { model?: string; systemPrompt: string; messages: any[]; tools?: any[] },
  onChunk: (chunk: StreamChunk) => void
): Promise<StreamResult> {
  const client = _getSdkClient()
  const indexToCallId: Record<number, string> = {}
  const pendingToolCalls: Record<string, { call_id: string; name: string; arguments: string }> = {}
  let hasToolCalls = false

  const guardedMessages = _guardContextWindow(messages)

  const stream = await client.messages.stream({
    model: model || process.env.LLM_MODEL || 'claude-sonnet-latest',
    max_tokens: 8000,
    system: _cachedSystem(systemPrompt) as any,
    messages: guardedMessages,
    tools: _cachedTools(tools || []),
    betas: ['prompt-caching-2024-07-31'],
  } as any)

  for await (const event of stream) {
    if ((event as any).type === 'content_block_start') {
      const e = event as any
      if (e.content_block?.type === 'tool_use') {
        const block = e.content_block
        indexToCallId[e.index] = block.id
        pendingToolCalls[block.id] = { call_id: block.id, name: block.name, arguments: '' }
        onChunk({ type: 'tool_start', call_id: block.id, name: block.name })
      }
    }
    if ((event as any).type === 'content_block_delta') {
      const e = event as any
      if (e.delta?.type === 'text_delta') {
        onChunk({ type: 'text', delta: e.delta.text })
      } else if (e.delta?.type === 'input_json_delta') {
        const callId = indexToCallId[e.index]
        if (callId && pendingToolCalls[callId]) {
          pendingToolCalls[callId].arguments += e.delta.partial_json || ''
          onChunk({ type: 'tool_args_delta', call_id: callId, delta: e.delta.partial_json || '' })
        }
      }
    }
    if ((event as any).type === 'content_block_stop') {
      const callId = indexToCallId[(event as any).index]
      if (callId && pendingToolCalls[callId]) hasToolCalls = true
    }
  }

  const finalMsg = await stream.finalMessage()
  const usage = finalMsg.usage as any
  if (usage) {
    log.info(
      `[llm] tokens in=${usage.input_tokens} out=${usage.output_tokens}` +
      ` cache_write=${usage.cache_creation_input_tokens ?? 0}` +
      ` cache_hit=${usage.cache_read_input_tokens ?? 0}`
    )
  }

  return { toolCalls: Object.values(pendingToolCalls), hasToolCalls, stopReason: finalMsg.stop_reason ?? 'end_turn', usage }
}

function _parseJsonText(text: string): any {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try { return JSON.parse(cleaned) } catch { throw new Error(`LLM returned non-JSON: ${text.slice(0, 120)}`) }
}

export async function callClaudeJSON({ prompt, system }: { prompt: string; system?: string }): Promise<any> {
  const client = _getSdkClient()
  const msg = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    system: _cachedSystem(system || '') as any,
    messages: [{ role: 'user', content: prompt }],
    betas: ['prompt-caching-2024-07-31'],
  } as any)
  return _parseJsonText((msg.content.find((b: any) => b.type === 'text') as any)?.text || '')
}
