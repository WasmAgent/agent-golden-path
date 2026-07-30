// documentModel — pure types, reducer, and helpers for the left-panel state.
// Kept separate from DocumentContext.tsx so that file exports ONLY React
// components/hooks, which lets Vite Fast Refresh work (mixing component and
// non-component exports disables it and forces a full remount on every edit).
//
// The reducer here is mirrored 1:1 by srv/chat/panel-store.ts — keep them in step.

import type React from 'react'

export type DocumentPage = 'prs' | 'pos' | 'invoices' | 'audit'
export type DetailMode = 'view' | 'edit'
export type DocumentKind = 'pr' | 'po' | 'invoice'

export interface DocumentState {
  activePage: DocumentPage
  selectedId: string | null
  highlightedIds: string[]
  filters: Record<string, string>
  // Detail and form are the SAME record view in two modes:
  //   detailMode 'view' → read-only detail   ·   'edit' → editable form.
  detailOpen: boolean
  detailMode: DetailMode
  detailKind: DocumentKind | null
  formDraftId: string | null
  formFields: Record<string, unknown>
  formBaseline: Record<string, unknown>  // last agent/server-known values — dirty = formFields[k] !== formBaseline[k]
  detailVersion: number   // increments on every OPEN_DETAIL/OPEN_FORM — forces detail re-fetch
  listVersion: number     // increments on every OPEN_DETAIL — forces list re-fetch
}

export type DocumentAction =
  | { type: 'NAVIGATE'; page: DocumentPage }
  | { type: 'HIGHLIGHT'; id: string }
  | { type: 'HIGHLIGHT_MANY'; ids: string[] }
  | { type: 'SET_FILTER'; filters: Record<string, string>; page?: DocumentPage }
  | { type: 'REPLACE_FILTER'; filters: Record<string, string>; page?: DocumentPage }
  | { type: 'REMOVE_FILTER'; key: string }
  | { type: 'CLEAR_FILTERS' }
  | { type: 'OPEN_DETAIL'; id: string; page?: DocumentPage; kind?: DocumentKind }
  | { type: 'OPEN_FORM'; id?: string; page?: DocumentPage; kind?: DocumentKind; draftId?: string; fields?: Record<string, unknown> }
  | { type: 'SET_FORM_FIELDS'; draftId?: string; fields?: Record<string, unknown> }
  | { type: 'EDIT_FORM_FIELD'; key: string; value: unknown }  // user edit — marks dirty
  | { type: 'COMMIT_FORM'; draftId?: string }                  // draft saved — clears dirty
  | { type: 'CLOSE_DETAIL' }
  | { type: 'CLEAR' }
  | { type: 'REPLACE_STATE'; state: DocumentState }   // external sync from server SSE

// ─── Hash routing helpers ─────────────────────────────────────────────────────
const VALID_PAGES: DocumentPage[] = ['prs', 'pos', 'invoices', 'audit']

export function parseHash(hash: string): { page: DocumentPage; id?: string } {
  const path = hash.replace(/^#\/?/, '')
  const [seg, id] = path.split('/')
  const page = VALID_PAGES.includes(seg as DocumentPage) ? (seg as DocumentPage) : 'prs'
  return { page, id: id || undefined }
}

export function buildHash(page: DocumentPage, id?: string | null): string {
  return id ? `#/${page}/${id}` : `#/${page}`
}

// ─── Reducer ──────────────────────────────────────────────────────────────────
export function documentReducer(state: DocumentState, action: DocumentAction): DocumentState {
  switch (action.type) {
    case 'NAVIGATE':
      return { ...state, activePage: action.page, selectedId: null, highlightedIds: [], detailOpen: false, detailMode: 'view', formFields: {}, formBaseline: {}, formDraftId: null, filters: {} }

    case 'HIGHLIGHT':
      return { ...state, selectedId: action.id, highlightedIds: [action.id] }

    case 'HIGHLIGHT_MANY':
      return { ...state, highlightedIds: action.ids, selectedId: action.ids[0] ?? null }

    case 'SET_FILTER': {
      const base = action.page && action.page !== state.activePage
        ? { ...state, activePage: action.page, selectedId: null, highlightedIds: [], detailOpen: false, filters: {} }
        : state.detailOpen
          ? { ...state, selectedId: null, highlightedIds: [], detailOpen: false }
          : state
      return { ...base, filters: { ...base.filters, ...action.filters } }
    }

    case 'REPLACE_FILTER': {
      const base = action.page && action.page !== state.activePage
        ? { ...state, activePage: action.page, selectedId: null, highlightedIds: [], detailOpen: false, filters: {} }
        : state.detailOpen
          ? { ...state, selectedId: null, highlightedIds: [], detailOpen: false }
          : state
      return { ...base, filters: action.filters }
    }

    case 'REMOVE_FILTER': {
      const next = { ...state.filters }
      delete next[action.key]
      return { ...state, filters: next }
    }

    case 'CLEAR_FILTERS':
      return { ...state, filters: {} }

    case 'OPEN_DETAIL': {
      const base = action.page && action.page !== state.activePage
        ? { ...state, activePage: action.page, selectedId: null, highlightedIds: [], filters: {} }
        : state
      return {
        ...base,
        selectedId: action.id,
        detailOpen: true,
        detailMode: 'view',
        detailKind: action.kind ?? base.detailKind,
        detailVersion: state.detailVersion + 1,
        listVersion: state.listVersion + 1,
      }
    }

    case 'OPEN_FORM': {
      const base = action.page && action.page !== state.activePage
        ? { ...state, activePage: action.page, selectedId: null, highlightedIds: [], filters: {} }
        : state
      const fields = action.fields ? { ...action.fields } : base.formFields
      return {
        ...base,
        selectedId: action.id ?? base.selectedId,
        detailOpen: true,
        detailMode: 'edit',
        detailKind: action.kind ?? base.detailKind ?? 'pr',
        formDraftId: action.draftId ?? base.formDraftId,
        formFields: fields,
        formBaseline: action.fields ? { ...action.fields } : base.formBaseline,
        detailVersion: state.detailVersion + 1,
        listVersion: state.listVersion + 1,
      }
    }

    // Agent-authoritative merge — baseline moves with the values (not dirty).
    case 'SET_FORM_FIELDS':
      return {
        ...state,
        formDraftId: action.draftId ?? state.formDraftId,
        formFields: { ...state.formFields, ...(action.fields || {}) },
        formBaseline: { ...state.formBaseline, ...(action.fields || {}) },
        detailVersion: state.detailVersion + 1,
      }

    // User typed in a field — value changes, baseline does not → dirty.
    case 'EDIT_FORM_FIELD':
      return { ...state, formFields: { ...state.formFields, [action.key]: action.value } }

    // Draft persisted — align baseline to current values, clearing all dirty marks.
    case 'COMMIT_FORM':
      return { ...state, formDraftId: action.draftId ?? state.formDraftId, formBaseline: { ...state.formFields } }

    case 'CLOSE_DETAIL':
      return { ...state, detailOpen: false, detailMode: 'view' }

    case 'CLEAR':
      return { ...state, selectedId: null, highlightedIds: [], detailOpen: false, detailMode: 'view', formFields: {}, formBaseline: {}, formDraftId: null, filters: {} }

    case 'REPLACE_STATE':
      return action.state

    default:
      return state
  }
}

export function makeInitialState(): DocumentState {
  const { page, id } = parseHash(window.location.hash)
  return {
    activePage: page,
    selectedId: id ?? null,
    highlightedIds: [],
    filters: {},
    detailOpen: !!id,
    detailMode: 'view',
    detailKind: null,
    formDraftId: null,
    formFields: {},
    formBaseline: {},
    detailVersion: 0,
    listVersion: 0,
  }
}

// Stable per-browser panel session id. Sent with every chat turn and used as the
// key for the server-side panel store, so the agent's ui_action writes and the
// browser's own state stay mirrored. Persisted so reloads keep the same session.
const PANEL_SESSION_KEY = 'copilot_panel_session'
export function getPanelSessionId(): string {
  try {
    let id = localStorage.getItem(PANEL_SESSION_KEY)
    if (!id) {
      id = `panel-${crypto.randomUUID()}`
      localStorage.setItem(PANEL_SESSION_KEY, id)
    }
    return id
  } catch {
    return 'panel-ephemeral'
  }
}

// ─── View context serializer ──────────────────────────────────────────────────
// Returns a compact object describing what the user currently sees.
// Sent with every chat turn so the LLM always knows the current view.
export function serializeViewContext(state: DocumentState): Record<string, unknown> {
  const ctx: Record<string, unknown> = { page: state.activePage }
  if (state.selectedId) ctx.selectedId = state.selectedId
  if (state.highlightedIds.length > 0) ctx.highlightedIds = state.highlightedIds
  if (Object.keys(state.filters).length > 0) ctx.filters = state.filters
  if (state.detailOpen) {
    ctx.detailOpen = true
    ctx.detailMode = state.detailMode           // 'view' (detail) or 'edit' (form)
    if (state.detailKind) ctx.detailKind = state.detailKind
    if (state.detailMode === 'edit') {
      if (state.formDraftId) ctx.formDraftId = state.formDraftId
      if (Object.keys(state.formFields).length > 0) ctx.formFields = state.formFields
      const dirty = dirtyFieldKeys(state)
      if (dirty.length > 0) ctx.dirtyFields = dirty
    }
  }
  return ctx
}

// Field keys whose current value differs from the baseline (user-edited, unsaved).
export function dirtyFieldKeys(state: DocumentState): string[] {
  const keys = new Set([...Object.keys(state.formFields), ...Object.keys(state.formBaseline)])
  return [...keys].filter(k => state.formFields[k] !== state.formBaseline[k])
}

// ─── Agent action dispatcher ──────────────────────────────────────────────────
// Called by CopilotChat when a ui_action SSE event arrives.
export function dispatchAgentAction(
  dispatch: React.Dispatch<DocumentAction>,
  action: { type: string; page?: string; id?: string; ids?: string[]; kind?: string; draftId?: string; fields?: Record<string, unknown>; filters?: Record<string, string> }
) {
  const kind = action.kind as DocumentKind | undefined
  switch (action.type) {
    case 'NAVIGATE':
      if (action.page) dispatch({ type: 'NAVIGATE', page: action.page as DocumentPage })
      break

    case 'HIGHLIGHT':
      if (action.page) dispatch({ type: 'NAVIGATE', page: action.page as DocumentPage })
      if (action.ids && action.ids.length > 1) {
        dispatch({ type: 'HIGHLIGHT_MANY', ids: action.ids })
      } else if (action.ids && action.ids.length === 1) {
        dispatch({ type: 'HIGHLIGHT', id: action.ids[0] })
      } else if (action.id) {
        dispatch({ type: 'HIGHLIGHT', id: action.id })
      }
      break

    case 'HIGHLIGHT_MANY':
      if (action.page) dispatch({ type: 'NAVIGATE', page: action.page as DocumentPage })
      if (action.ids && action.ids.length > 0) {
        dispatch({ type: 'HIGHLIGHT_MANY', ids: action.ids })
      }
      break

    case 'SET_FILTER':
      if (action.filters) {
        dispatch({ type: 'REPLACE_FILTER', filters: action.filters, page: action.page as DocumentPage | undefined })
      } else if (action.page) {
        dispatch({ type: 'NAVIGATE', page: action.page as DocumentPage })
      }
      break

    case 'OPEN_DETAIL':
      if (action.id) {
        dispatch({ type: 'OPEN_DETAIL', id: action.id, page: action.page as DocumentPage | undefined, kind })
      }
      break

    case 'OPEN_FORM':
      dispatch({ type: 'OPEN_FORM', id: action.id, page: action.page as DocumentPage | undefined, kind, draftId: action.draftId, fields: action.fields })
      break

    case 'SET_FORM_FIELDS':
      dispatch({ type: 'SET_FORM_FIELDS', draftId: action.draftId, fields: action.fields })
      break

    case 'CLOSE_DETAIL':
      dispatch({ type: 'CLOSE_DETAIL' })
      break

    case 'CLEAR':
      dispatch({ type: 'CLEAR' })
      break
  }
}
