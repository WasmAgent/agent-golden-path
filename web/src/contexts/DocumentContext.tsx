// DocumentContext — React provider + hook for the left-panel state.
// Pure types/reducer/helpers live in ./documentModel so this file exports ONLY
// components/hooks (keeps Vite Fast Refresh working — see documentModel.ts).
//
// Hash routing: #/prs, #/pos, #/invoices, #/audit, #/prs/PR-000001, etc.
// NAVIGATE and OPEN_DETAIL write the hash; DocumentProvider reads it on mount.

import React, { createContext, useContext, useReducer, useEffect, useRef, useState, useCallback } from 'react'
import {
  documentReducer, makeInitialState, getPanelSessionId, parseHash, buildHash,
  type DocumentState, type DocumentAction,
} from './documentModel'

const DocumentContext = createContext<{
  state: DocumentState
  dispatch: React.Dispatch<DocumentAction>
} | null>(null)

export function DocumentProvider({ children }: { children: React.ReactNode }) {
  const [state, rawDispatch] = useReducer(documentReducer, undefined, makeInitialState)
  const ignoringHashChange = useRef(false)

  // Panel session + per-tab source token. The session keys the server store; the
  // source token lets us ignore SSE echoes of our own writes.
  const sessionId = useRef(getPanelSessionId())
  const tabSource = useRef(`browser-${Math.random().toString(36).slice(2, 10)}`)
  // JSON of the last state we sent to / received from the server. Guards against
  // PUT→broadcast→REPLACE→PUT ping-pong: we only PUT when state genuinely differs.
  const lastSyncedRef = useRef<string>('')
  // Blocks the PUT effect until we've hydrated from the server on mount, so the
  // browser's initial (hash-derived) state can't clobber state a headless caller
  // / demo script / Copilot already set in the server store before we connected.
  // State (not a ref) so the PUT effect re-runs once hydration completes.
  const [hydrated, setHydrated] = useState(false)

  const writeHash = useCallback((hash: string) => {
    if (window.location.hash === hash) return
    ignoringHashChange.current = true
    window.location.hash = hash
    setTimeout(() => { ignoringHashChange.current = false }, 0)
  }, [])

  const dispatch: React.Dispatch<DocumentAction> = useCallback((action) => {
    rawDispatch(action)
    if (action.type === 'NAVIGATE') {
      writeHash(buildHash(action.page))
    }
  }, [writeHash])

  // Sync hash → state on back/forward navigation only (not our own writes)
  useEffect(() => {
    const onHashChange = () => {
      if (ignoringHashChange.current) return
      const { page, id } = parseHash(window.location.hash)
      rawDispatch({ type: 'NAVIGATE', page })
      if (id) rawDispatch({ type: 'OPEN_DETAIL', id })
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  // Sync state → hash whenever activePage or detailOpen+selectedId changes
  useEffect(() => {
    const expected = state.detailOpen && state.selectedId
      ? buildHash(state.activePage, state.selectedId)
      : buildHash(state.activePage)
    writeHash(expected)
  }, [state.activePage, state.detailOpen, state.selectedId, writeHash])

  // ── Server mirror: hydrate from the store on mount BEFORE we start PUTing.
  // If a headless caller / demo script / Copilot already set meaningful state, we
  // adopt it; otherwise the browser's hash-derived initial state wins and is PUT.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/panel/${encodeURIComponent(sessionId.current)}`)
      .then(r => r.ok ? r.json() : null)
      .then(body => {
        if (cancelled) return
        const s = body?.state as DocumentState | undefined
        const meaningful = !!s && (
          s.detailOpen || s.selectedId || s.formDraftId ||
          (s.highlightedIds?.length ?? 0) > 0 ||
          Object.keys(s.filters ?? {}).length > 0 ||
          Object.keys(s.formFields ?? {}).length > 0
        )
        if (meaningful) {
          lastSyncedRef.current = JSON.stringify(s)   // adopt server state; blocks re-PUT
          rawDispatch({ type: 'REPLACE_STATE', state: s as DocumentState })
        }
      })
      .catch(() => { /* server down — fall through to local state */ })
      .finally(() => { if (!cancelled) setHydrated(true) })
    return () => { cancelled = true }
  }, [])

  // ── Server mirror: subscribe to external panel changes (tester / other tab / agent)
  useEffect(() => {
    const es = new EventSource(`/api/panel/${encodeURIComponent(sessionId.current)}/events`)
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data)
        if (evt.type !== 'state' || !evt.state) return
        if (evt.source === tabSource.current) return   // our own echo — ignore
        const json = JSON.stringify(evt.state)
        if (json === lastSyncedRef.current) return      // no real change
        lastSyncedRef.current = json                     // adopt server state; blocks re-PUT
        rawDispatch({ type: 'REPLACE_STATE', state: evt.state as DocumentState })
      } catch { /* skip malformed */ }
    }
    return () => es.close()
  }, [])

  // ── Server mirror: PUT local state changes so headless callers + the agent see them
  useEffect(() => {
    if (!hydrated) return                                // wait until we've read the server store
    const json = JSON.stringify(state)
    if (json === lastSyncedRef.current) return           // came from server or unchanged
    lastSyncedRef.current = json
    fetch(`/api/panel/${encodeURIComponent(sessionId.current)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Panel-Source': tabSource.current },
      body: json,
      keepalive: true,
    }).catch(() => { /* offline / server down — non-fatal */ })
  }, [state, hydrated])

  return (
    <DocumentContext.Provider value={{ state, dispatch }}>
      {children}
    </DocumentContext.Provider>
  )
}

export function useDocument() {
  const ctx = useContext(DocumentContext)
  if (!ctx) throw new Error('useDocument must be used within DocumentProvider')
  return ctx
}
