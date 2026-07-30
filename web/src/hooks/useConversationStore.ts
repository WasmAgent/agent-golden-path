/**
 * useConversationStore — localStorage-backed conversation history.
 * Short-term window (last MAX_SHORT_TERM messages) is sent to the LLM each turn.
 * History persists across page reloads.
 */
import { useState, useCallback, useMemo } from 'react'

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  ts: number
}

export interface StoredSuggestion {
  label: string
  text: string
}

const MAX_SHORT_TERM = 20
const MAX_STORED = 200
const HISTORY_KEY = 'copilot_history'
const SUGGESTIONS_KEY = 'copilot_suggestions'

function loadHistory(): StoredMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    return raw ? (JSON.parse(raw) as StoredMessage[]) : []
  } catch { return [] }
}

function saveHistory(messages: StoredMessage[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(messages))
  } catch {
    // QuotaExceededError: trim oldest half and retry once
    try {
      const trimmed = messages.slice(-Math.floor(messages.length / 2))
      localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed))
    } catch { /* storage unavailable; history not persisted this turn */ }
  }
}

function loadSuggestions(): StoredSuggestion[] {
  try {
    const raw = localStorage.getItem(SUGGESTIONS_KEY)
    return raw ? (JSON.parse(raw) as StoredSuggestion[]) : []
  } catch { return [] }
}

function saveSuggestions(suggestions: StoredSuggestion[]) {
  try {
    localStorage.setItem(SUGGESTIONS_KEY, JSON.stringify(suggestions))
  } catch { /* storage unavailable; suggestions not persisted this turn */ }
}

export interface ConversationStore {
  messages: StoredMessage[]
  shortTermHistory: { role: 'user' | 'assistant'; content: string }[]
  suggestions: StoredSuggestion[]
  addMessage: (msg: Omit<StoredMessage, 'ts'>) => void
  setSuggestions: (suggestions: StoredSuggestion[]) => void
  clear: () => void
}

export function useConversationStore(): ConversationStore {
  const [messages, setMessages] = useState<StoredMessage[]>(() => loadHistory())
  // Suggestions persist alongside history so quick-reply chips survive a
  // CopilotChat remount (panel toggle, mobile drawer, breakpoint cross, reload).
  const [suggestions, setSuggestionsState] = useState<StoredSuggestion[]>(() => loadSuggestions())

  const addMessage = useCallback((msg: Omit<StoredMessage, 'ts'>) => {
    const newMsg: StoredMessage = { ...msg, ts: Date.now() }
    setMessages(prev => {
      const next = [...prev, newMsg].slice(-MAX_STORED)
      saveHistory(next)
      return next
    })
  }, [])

  const setSuggestions = useCallback((next: StoredSuggestion[]) => {
    setSuggestionsState(next)
    saveSuggestions(next)
  }, [])

  const clear = useCallback(() => {
    setMessages([])
    setSuggestionsState([])
    localStorage.removeItem(HISTORY_KEY)
    localStorage.removeItem(SUGGESTIONS_KEY)
  }, [])

  const shortTermHistory = useMemo(() =>
    messages
      .slice(-MAX_SHORT_TERM)
      .map(m => ({ role: m.role, content: m.content })),
    [messages]
  )

  return { messages, shortTermHistory, suggestions, addMessage, setSuggestions, clear }
}
