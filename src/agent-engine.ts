// Agent engine — constructs the @wasmagent/core ToolCallingAgent that drives
// every chat turn. This is the top of the provable-agent chain: the agent runs
// tools, guardrails gate high-risk calls, and each call is recorded as evidence.

const log = console

let _corePromise: Promise<any> | null = null
async function _loadCore() {
  if (!_corePromise)
    _corePromise = import('@wasmagent/core')
  return _corePromise
}

let _model: any = null
let _haiku: any = null
let _budget: any = null

export async function getModel(): Promise<any> {
  if (_model) return _model
  const { AnthropicModel } = await _loadCore()
  const modelId = process.env.LLM_MODEL || 'claude-sonnet-latest'
  _model = new AnthropicModel(modelId, {
    apiKey: process.env.ANTHROPIC_API_KEY || 'placeholder',
    baseURL: process.env.ANTHROPIC_BASE_URL,
    serverSideContextManagement: true,
  })
  log.info(`[engine] AnthropicModel initialised: ${modelId}`)
  return _model
}

export async function getHaiku(): Promise<any> {
  if (_haiku) return _haiku
  const { AnthropicModel } = await _loadCore()
  _haiku = new AnthropicModel('claude-haiku-4-5-20251001', {
    apiKey: process.env.ANTHROPIC_API_KEY || 'placeholder',
    baseURL: process.env.ANTHROPIC_BASE_URL,
  })
  return _haiku
}

export async function getTokenBudget(): Promise<any> {
  if (_budget) return _budget
  const { TokenBudget } = await _loadCore()
  _budget = new TokenBudget()
  return _budget
}

interface CreateAgentOptions {
  tools: any[]
  systemPrompt: string
  sessionId: string
  checkpointer?: any
  toolGuardrails?: any[]
  inputGuardrails?: any[]
}

export async function createAgent({ tools, systemPrompt, sessionId, checkpointer, toolGuardrails, inputGuardrails }: CreateAgentOptions): Promise<{ agent: any; obsMemory: any; budget: any }> {
  const {
    ToolCallingAgent,
    ObservationalMemory,
    InMemoryCheckpointer,
  } = await _loadCore()

  const model = await getModel()
  const haiku = await getHaiku()
  const budget = await getTokenBudget()

  const agent = new ToolCallingAgent({
    tools,
    model,
    systemPrompt,
    maxSteps: Number(process.env.CHAT_TOOL_CALLS_MAX) || 12,
    maxTokensPerStep: 8000,
    stopPolicies: ['noProgress:3'],
    checkpointer: checkpointer || new InMemoryCheckpointer(),
    toolGuardrails: toolGuardrails || [],
    inputGuardrails: inputGuardrails || [],
  })

  const obsMemory = new ObservationalMemory({
    assembler: agent.assembler,
    model,
    observerModel: haiku,
    sessionId,
    tokenThreshold: Number(process.env.OBS_MEMORY_THRESHOLD) || 8000,
    keepRecentSteps: 5,
  })

  return { agent, obsMemory, budget }
}

export async function injectHistoryIntoAssembler(assembler: any, messages: any[]): Promise<void> {
  await _loadCore()
  let stepIndex = 0
  let i = 0
  while (i < messages.length) {
    const msg = messages[i]
    if (msg.role === 'user') {
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      assembler.addStep({ type: 'user_message', content })
      i++
    } else if (msg.role === 'assistant') {
      const assistantContent = Array.isArray(msg.content) ? msg.content : [{ type: 'text', text: msg.content }]
      const thoughts = assistantContent.find((b: any) => b.type === 'text')?.text || ''
      const toolUseBlocks = assistantContent.filter((b: any) => b.type === 'tool_use')

      if (toolUseBlocks.length === 0) {
        assembler.addStep({ type: 'final_answer', answer: thoughts })
        i++
      } else if (toolUseBlocks.length === 1) {
        const tu = toolUseBlocks[0]
        const nextMsg = messages[i + 1]
        const toolResultBlock = nextMsg?.role === 'user' && Array.isArray(nextMsg.content)
          ? nextMsg.content.find((b: any) => b.type === 'tool_result' && b.tool_use_id === tu.id)
          : null
        assembler.addStep({
          type: 'tool_use',
          stepIndex: stepIndex++,
          thoughts,
          toolCallId: tu.id,
          toolName: tu.name,
          toolInput: tu.input || {},
          toolOutput: toolResultBlock ? toolResultBlock.content : '',
          isError: false,
        })
        i += toolResultBlock ? 2 : 1
      } else {
        const nextMsg = messages[i + 1]
        const toolResults = nextMsg?.role === 'user' && Array.isArray(nextMsg.content)
          ? nextMsg.content.filter((b: any) => b.type === 'tool_result')
          : []
        const calls = toolUseBlocks.map((tu: any) => {
          const tr = toolResults.find((r: any) => r.tool_use_id === tu.id)
          return { callId: tu.id, toolName: tu.name, toolInput: tu.input || {}, toolOutput: tr?.content || '', isError: false }
        })
        assembler.addStep({ type: 'parallel_tool_use', stepIndex: stepIndex++, thoughts, calls })
        i += toolResults.length > 0 ? 2 : 1
      }
    } else {
      i++
    }
  }
}

export function logBudget(budget: any, modelId?: string): void {
  if (!budget || budget.calls === 0) return
  const usd = budget.estimatedUsdFor(modelId || process.env.LLM_MODEL || 'claude-sonnet-latest')
  log.info(
    `[engine] TokenBudget: in=${budget.inputTokens} out=${budget.outputTokens}` +
    ` cache_hit=${budget.cacheReadTokens} cache_write=${budget.cacheWriteTokens}` +
    ` hit_rate=${(budget.cacheHitRate * 100).toFixed(1)}%` +
    ` calls=${budget.calls} est_usd=$${usd.toFixed(4)}`
  )
}
