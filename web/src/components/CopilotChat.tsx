import { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Loader2, Square, Check, Trash2 } from 'lucide-react'
import { MarkdownMessage } from './MarkdownMessage'
import { CopilotIcon } from './CopilotIcon'
import { useDocument } from '../contexts/DocumentContext'
import { dispatchAgentAction, serializeViewContext, getPanelSessionId } from '../contexts/documentModel'
import { registerChatInsert, deregisterChatInsert } from '../utils/chatInsert'
import { useConversationStore } from '../hooks/useConversationStore'
import { useLanguage, type TFn } from '../i18n/LanguageContext'
import { useAgentRun } from '@wasmagent/react'

interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls?: ToolCall[]
  streaming?: boolean
  statusText?: string
}

interface ToolCall {
  call_id: string
  name: string
  status: 'running' | 'done'
}

// Tool progress labels come from i18n (`tool.<name>`); unknown tools fall back
// to a humanised form so nothing is ever hidden.
function humaniseTool(t: TFn, name: string): string {
  const key = `tool.${name}`
  const label = t(key)
  return label === key ? name.replace(/_/g, ' ') : label
}

function welcomeMessage(t: TFn): UiMessage {
  return { id: 'welcome', role: 'assistant', content: t('copilot.welcome') }
}

export default function CopilotChat() {
  const { dispatch, state: documentState } = useDocument()
  const { t, lang } = useLanguage()
  const store = useConversationStore()

  // UI messages = persisted history rendered as UiMessage, plus any live streaming message
  const [uiMessages, setUiMessages] = useState<UiMessage[]>(() => [
    welcomeMessage(t),
    ...store.messages.map(m => ({ id: m.id, role: m.role, content: m.content })),
  ])
  const [input, setInput] = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  // Suggestions live in the store (localStorage-backed) so the quick-reply chips
  // survive a CopilotChat remount — panel toggle, mobile drawer, or page reload.
  const suggestions = store.suggestions
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const clearedRef = useRef(false)
  const documentStateRef = useRef(documentState)
  useEffect(() => { documentStateRef.current = documentState }, [documentState])

  // Per-run state — set before hookRun(), read inside onEvent and the cleanup effect
  const runStateRef = useRef<{
    assistantId: string
    finalContent: string
    assistantPersisted: boolean
  } | null>(null)

  // Stable refs so onEvent (empty deps) always reads current values without recreating
  const dispatchRef = useRef(dispatch)
  dispatchRef.current = dispatch
  const storeRef = useRef(store)
  storeRef.current = store
  const tRef = useRef(t)
  tRef.current = t

  // Handle app-specific events not covered by the hook's eventMap:
  // ui_action, suggestions, status, done, error (with our flat payload shape)
  const onEvent = useCallback((ev: any) => {
    const rs = runStateRef.current
    if (!rs) return
    const { assistantId } = rs
    const update = (updater: (m: UiMessage) => UiMessage) =>
      setUiMessages(prev => prev.map(m => m.id === assistantId ? updater(m) : m))

    if (ev.type === 'ui_action') {
      dispatchAgentAction(dispatchRef.current, ev.action)
    } else if (ev.type === 'status') {
      update(m => ({ ...m, statusText: ev.text }))
    } else if (ev.type === 'suggestions') {
      storeRef.current.setSuggestions(ev.items ?? [])
    } else if (ev.type === 'done') {
      update(m => ({ ...m, streaming: false, statusText: undefined }))
      if (!rs.assistantPersisted) {
        rs.assistantPersisted = true
        storeRef.current.addMessage({ id: rs.assistantId, role: 'assistant', content: rs.finalContent })
      }
    } else if (ev.type === 'error') {
      const errText = `\n\n⚠️ ${ev.message}`
      rs.finalContent += errText
      update(m => ({ ...m, content: m.content + errText, streaming: false, statusText: undefined }))
      if (!rs.assistantPersisted) {
        rs.assistantPersisted = true
        storeRef.current.addMessage({ id: rs.assistantId, role: 'assistant', content: rs.finalContent })
      }
    }
  }, []) // stable — external state accessed via refs

  const { run: hookRun, abort: hookAbort, isRunning, messages: hookMessages } = useAgentRun('/api/chat/stream', {
    eventField: 'type',
    channelField: null,
    eventMap: {
      'text':       'text_delta',  // hook accumulates streaming text natively
      'tool_start': 'tool_call',   // hook renders tool chip natively
      'tool_end':   'tool_result', // hook marks tool done natively
    },
    onEvent,
  })

  // Sync hook's natively-accumulated messages (text + tool chips) into our uiMessages.
  // The hook owns text content and toolCalls; onEvent owns statusText, streaming flag,
  // ui_action, suggestions, and persistence.
  useEffect(() => {
    const rs = runStateRef.current
    if (!rs || !hookMessages.length) return
    const assistantId = rs.assistantId
    setUiMessages(prev => prev.map(m => {
      if (m.id !== assistantId) return m
      // Merge hook's latest assistant message (text) and tool messages
      const hookAssistant = hookMessages.filter(hm => hm.role === 'assistant').slice(-1)[0]
      const hookTools = hookMessages.filter(hm => hm.role === 'tool')
      const content = hookAssistant?.content ?? m.content
      rs.finalContent = content
      const toolCalls: ToolCall[] = hookTools.map(hm => ({
        call_id: hm.callId ?? hm.id,
        name: hm.toolName ?? '',
        status: hm.isError !== undefined || !isRunning ? 'done' : 'running',
      }))
      return { ...m, content, toolCalls: toolCalls.length ? toolCalls : m.toolCalls }
    }))
  }, [hookMessages, isRunning])
  useEffect(() => {
    if (!isRunning && runStateRef.current) {
      const rs = runStateRef.current
      runStateRef.current = null
      setUiMessages(prev => prev.map(m => {
        if (m.id !== rs.assistantId || !m.streaming) return m
        return { ...m, content: m.content || tRef.current('copilot.stopped'), streaming: false, statusText: undefined }
      }))
      if (!clearedRef.current && !rs.assistantPersisted) {
        storeRef.current.addMessage({
          id: rs.assistantId,
          role: 'assistant',
          content: rs.finalContent || tRef.current('copilot.stopped'),
        })
      }
    }
  }, [isRunning])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [uiMessages])

  useEffect(() => {
    setUiMessages(prev => {
      if (prev[0]?.id === 'welcome') return [welcomeMessage(t), ...prev.slice(1)]
      return prev
    })
  }, [lang])

  useEffect(() => {
    const fn = (text: string) => {
      const el = inputRef.current
      if (!el) return
      const start = el.selectionStart ?? el.value.length
      const end = el.selectionEnd ?? el.value.length
      const next = el.value.slice(0, start) + text + el.value.slice(end)
      setInput(next)
      requestAnimationFrame(() => {
        el.focus()
        el.setSelectionRange(start + text.length, start + text.length)
      })
    }
    registerChatInsert(fn)
    return () => deregisterChatInsert(fn)
  }, [])

  function send(text: string) {
    if (!text.trim() || isRunning) return
    clearedRef.current = false

    const userMsgId = crypto.randomUUID()
    const assistantId = crypto.randomUUID()

    // Persist user message immediately
    store.addMessage({ id: userMsgId, role: 'user', content: text.trim() })

    // Send shortTermHistory (last 20 persisted) + new user message to LLM
    const outbound = [
      ...store.shortTermHistory,
      { role: 'user' as const, content: text.trim() },
    ]

    setUiMessages(prev => [
      ...prev,
      { id: userMsgId, role: 'user', content: text.trim() },
      { id: assistantId, role: 'assistant', content: '', streaming: true, toolCalls: [] },
    ])
    setInput('')
    store.setSuggestions([])

    // Initialise per-run state before firing the hook so onEvent can read it immediately
    runStateRef.current = { assistantId, finalContent: '', assistantPersisted: false }

    hookRun({
      task: '',  // required by hook signature; backend ignores this field
      messages: outbound,
      viewContext: serializeViewContext(documentStateRef.current),
      panelSessionId: getPanelSessionId(),
      locale: lang,
    })
  }

  const stop = () => { hookAbort() }

  const clear = () => {
    clearedRef.current = true
    // Null out run state before abort so the cleanup effect ignores the transition
    runStateRef.current = null
    if (isRunning) hookAbort()
    store.clear()
    setUiMessages([welcomeMessage(t)])
  }

  const canSend = input.trim().length > 0 && !isRunning

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: `linear-gradient(180deg,var(--jc-bg) 0%,var(--jc-bg-warm) 100%)` }}>

      {/* Header */}
      <div style={{
        position: 'relative', padding: '12px 16px', flexShrink: 0,
        background: `linear-gradient(135deg,var(--jc-accent-hdr) 0%,var(--jc-accent-mid) 50%,var(--jc-accent-dark) 100%)`,
        color: 'white', overflow: 'hidden',
        borderBottom: `1px solid rgba(var(--jc-white-rgb),0.08)`,
      }}>
        <div style={{
          position: 'absolute', top: -40, right: -40, width: 160, height: 160,
          background: `radial-gradient(circle,rgba(var(--jc-glow-rgb),0.22) 0%,transparent 70%)`,
          pointerEvents: 'none',
        }} />
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 1,
          background: `linear-gradient(90deg,transparent,rgba(var(--jc-shimmer-rgb),0.5) 30%,rgba(var(--jc-shimmer-rgb),0.5) 70%,transparent)`,
        }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
          <div style={{
            width: 32, height: 32, borderRadius: 9,
            background: `linear-gradient(135deg,rgba(var(--jc-shimmer-rgb),0.25),rgba(var(--jc-purple-light-rgb),0.4))`,
            border: `1.5px solid rgba(var(--jc-shimmer-rgb),0.45)`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            boxShadow: `0 2px 8px -2px rgba(var(--jc-purple-light-rgb),0.5)`,
          }}>
            <CopilotIcon size={18} color="white" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: '0.01em', lineHeight: 1.1 }}>Copilot</div>
            <div style={{ fontSize: 10, color: `rgba(var(--jc-white-rgb),0.55)`, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600, marginTop: 2 }}>
              Procurement Copilot
            </div>
          </div>
          <button onClick={clear} title={t('copilot.clearChat')} style={{
            padding: 7, background: `rgba(var(--jc-white-rgb),0.06)`,
            border: `1px solid rgba(var(--jc-white-rgb),0.12)`, borderRadius: 6,
            color: `rgba(var(--jc-white-rgb),0.75)`, cursor: 'pointer',
            display: 'flex', alignItems: 'center',
          }}
            onMouseEnter={e => (e.currentTarget.style.background = `rgba(var(--jc-white-rgb),0.14)`)}
            onMouseLeave={e => (e.currentTarget.style.background = `rgba(var(--jc-white-rgb),0.06)`)}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px' }}>
        {uiMessages.map(msg => (
          <div key={msg.id} style={{
            marginBottom: 14, display: 'flex', flexDirection: 'column',
            alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            {/* Tool call chips */}
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 6, maxWidth: '90%' }}>
                {msg.toolCalls.filter(tc => tc.name !== 'ui_action').map(tc => {
                  const running = tc.status === 'running'
                  return (
                    <span key={tc.call_id} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      fontSize: 10.5, padding: '3px 9px', borderRadius: 999,
                      background: running
                        ? `linear-gradient(135deg,rgba(var(--jc-accent-rgb),0.10),rgba(var(--jc-blue-rgb),0.06))`
                        : `linear-gradient(135deg,rgba(var(--jc-green-rgb),0.10),rgba(var(--jc-green-rgb),0.04))`,
                      color: running ? 'var(--jc-accent)' : 'var(--jc-green)',
                      border: `1px solid ${running ? `rgba(var(--jc-accent-rgb),0.22)` : `rgba(var(--jc-green-rgb),0.22)`}`,
                      fontWeight: 600, letterSpacing: '0.01em', width: 'fit-content',
                    }}>
                      {running
                        ? <Loader2 size={10} style={{ animation: 'spin 1s linear infinite' }} />
                        : <Check size={10} strokeWidth={3} />}
                      {humaniseTool(t, tc.name)}
                    </span>
                  )
                })}
              </div>
            )}

            {/* Status line */}
            {msg.role === 'assistant' && msg.statusText && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: 6, maxWidth: '90%', marginBottom: 6,
                fontSize: 11.5, color: 'var(--jc-text-muted)', fontStyle: 'italic',
              }}>
                <Loader2 size={11} style={{ color: 'var(--jc-accent)', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
                {msg.statusText}
              </div>
            )}

            {/* Bubble */}
            {(msg.content || msg.streaming) && (
              <div style={{
                maxWidth: '90%',
                padding: msg.role === 'user' ? '9px 13px' : '11px 14px',
                borderRadius: msg.role === 'user' ? '14px 14px 3px 14px' : '14px 14px 14px 3px',
                background: msg.role === 'user'
                  ? `linear-gradient(135deg,var(--jc-accent),var(--jc-blue))`
                  : `linear-gradient(180deg,var(--jc-bg),var(--jc-bg-warm))`,
                color: msg.role === 'user' ? 'white' : 'var(--jc-text)',
                border: msg.role === 'user'
                  ? `1px solid rgba(var(--jc-accent-rgb),0.4)`
                  : `1px solid var(--jc-border-warm)`,
                fontSize: 13, lineHeight: 1.6, wordBreak: 'break-word',
                boxShadow: msg.role === 'user'
                  ? `0 4px 14px -4px rgba(var(--jc-accent-rgb),0.45)`
                  : `0 1px 2px rgba(var(--jc-dark-rgb),0.05)`,
              }}>
                {msg.role === 'assistant'
                  ? <MarkdownMessage content={msg.content} />
                  : <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                }
                {msg.streaming && !msg.content && (
                  <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
                    {[0, 1, 2].map(i => (
                      <span key={i} style={{
                        display: 'inline-block', width: 4, height: 4, borderRadius: '50%',
                        background: 'var(--jc-accent)', opacity: 0.6,
                        animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                      }} />
                    ))}
                  </span>
                )}
                {msg.streaming && msg.content && (
                  <span style={{
                    display: 'inline-block', width: 2, height: 13,
                    background: msg.role === 'user' ? 'white' : 'var(--jc-accent)',
                    marginLeft: 3, verticalAlign: 'middle',
                    animation: 'blink 1s step-end infinite',
                  }} />
                )}
              </div>
            )}
          </div>
        ))}

        <div ref={bottomRef} />

        {/* Quick reply chips */}
        {!isRunning && suggestions.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4, marginBottom: 8, animation: 'fadeUp 0.25s ease-out' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--jc-text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em', width: '100%', marginBottom: 2 }}>
              {t('copilot.quickReplies')}
            </div>
            {suggestions.map((s, i) => (
              <button key={i} onClick={() => send(s.text)} style={{
                fontSize: 11.5, padding: '5px 11px', borderRadius: 999,
                background: `linear-gradient(135deg,rgba(var(--jc-accent-rgb),0.06),var(--jc-bg))`,
                border: `1.5px solid rgba(var(--jc-accent-rgb),0.28)`,
                color: 'var(--jc-accent)', cursor: 'pointer', fontWeight: 600,
                transition: 'all 0.15s',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = `rgba(var(--jc-accent-rgb),0.12)`; e.currentTarget.style.borderColor = `rgba(var(--jc-accent-rgb),0.5)` }}
                onMouseLeave={e => { e.currentTarget.style.background = `linear-gradient(135deg,rgba(var(--jc-accent-rgb),0.06),var(--jc-bg))`; e.currentTarget.style.borderColor = `rgba(var(--jc-accent-rgb),0.28)` }}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ padding: '8px 14px 14px', flexShrink: 0, borderTop: `1px solid var(--jc-border)`, background: `linear-gradient(180deg,transparent,var(--jc-bg-warm))` }}>
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 6,
          border: `1px solid ${isRunning ? 'var(--jc-accent)' : inputFocused ? 'var(--jc-blue)' : 'var(--jc-border-muted)'}`,
          borderRadius: 12, padding: '6px 8px', background: 'var(--jc-bg)',
          boxShadow: inputFocused
            ? `0 0 0 3px rgba(var(--jc-blue-rgb),0.10),0 1px 2px rgba(var(--jc-dark-rgb),0.05)`
            : isRunning
              ? `0 0 0 3px rgba(var(--jc-accent-rgb),0.10),0 1px 2px rgba(var(--jc-dark-rgb),0.05)`
              : `0 1px 2px rgba(var(--jc-dark-rgb),0.04)`,
          transition: 'all 0.18s',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
            }}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder={t('copilot.placeholder')}
            rows={1}
            style={{
              flex: 1, fontSize: 13, border: 'none', outline: 'none', resize: 'none',
              background: 'transparent', color: 'var(--jc-text)',
              lineHeight: 1.55, maxHeight: 96, overflowY: 'auto',
              padding: '4px 2px', fontFamily: 'inherit',
            }}
          />
          {isRunning ? (
            <button onClick={stop} title={t('copilot.stop')} style={{
              padding: 7, borderRadius: 8,
              background: 'var(--jc-red-bg)', border: `1px solid rgba(var(--jc-red-rgb),0.22)`,
              cursor: 'pointer', color: 'var(--jc-red)', flexShrink: 0, display: 'flex', alignItems: 'center',
            }}>
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button onClick={() => send(input)} disabled={!canSend} title={t('copilot.send')} style={{
              padding: 7, borderRadius: 8,
              background: canSend ? `linear-gradient(135deg,var(--jc-accent),var(--jc-blue))` : 'var(--jc-bg-light)',
              border: canSend ? `1px solid rgba(var(--jc-accent-rgb),0.5)` : `1px solid var(--jc-border-warm)`,
              cursor: canSend ? 'pointer' : 'not-allowed',
              color: canSend ? 'white' : 'var(--jc-text-faint)', flexShrink: 0, display: 'flex', alignItems: 'center',
              boxShadow: canSend ? `0 2px 8px -2px rgba(var(--jc-accent-rgb),0.5)` : 'none',
              transition: 'all 0.15s',
            }}>
              <Send size={12} />
            </button>
          )}
        </div>
        <div style={{ marginTop: 5, fontSize: 10, color: 'var(--jc-text-faint)', letterSpacing: '0.04em', textAlign: 'center' }}>
          <kbd style={{ fontFamily: 'monospace', fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--jc-bg-light)', border: `1px solid var(--jc-border-warm)`, color: 'var(--jc-text-muted)' }}>Enter</kbd>
          {' '}{t('copilot.kbdSend')}
          <kbd style={{ fontFamily: 'monospace', fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--jc-bg-light)', border: `1px solid var(--jc-border-warm)`, color: 'var(--jc-text-muted)' }}>Shift+Enter</kbd>
          {' '}{t('copilot.kbdNewLine')}
        </div>
      </div>
    </div>
  )
}
