import { EventEmitter } from 'events'

export const VALID_PAGES = ['prs', 'pos', 'invoices', 'audit'] as const
export type ActivePage = typeof VALID_PAGES[number]
export type DetailMode = 'view' | 'edit'
export type DetailKind = 'pr' | 'po' | 'invoice' | null

export interface DocumentState {
  activePage: ActivePage
  selectedId: string | null
  highlightedIds: string[]
  filters: Record<string, string>
  detailOpen: boolean
  detailMode: DetailMode
  detailKind: DetailKind
  formDraftId: string | null
  formFields: Record<string, unknown>
  formBaseline: Record<string, unknown>
  detailVersion: number
  listVersion: number
}

export interface ViewContext {
  page: ActivePage
  selectedId?: string
  highlightedIds?: string[]
  filters?: Record<string, string>
  detailOpen?: boolean
  detailMode?: DetailMode
  detailKind?: DetailKind
  formDraftId?: string
  formFields?: Record<string, unknown>
  dirtyFields?: string[]
  [key: string]: unknown
}

interface ChangeEvent {
  sessionId: string
  state: DocumentState
  source: string
}

type ChangeListener = (evt: ChangeEvent) => void

interface ReducerAction {
  type: string
  page?: string
  id?: string
  ids?: string[]
  kind?: DetailKind
  draftId?: string
  fields?: Record<string, unknown>
  filters?: Record<string, string>
  key?: string
  value?: unknown
  [key: string]: unknown
}

export function makeInitialState(): DocumentState {
  return {
    activePage: 'prs',
    selectedId: null,
    highlightedIds: [],
    filters: {},
    detailOpen: false,
    detailMode: 'view',
    detailKind: null,
    formDraftId: null,
    formFields: {},
    formBaseline: {},
    detailVersion: 0,
    listVersion: 0,
  }
}

function reduce(state: DocumentState, action: ReducerAction): DocumentState {
  switch (action.type) {
    case 'NAVIGATE':
      return { ...state, activePage: action.page as ActivePage, selectedId: null, highlightedIds: [], detailOpen: false, detailMode: 'view', formFields: {}, formBaseline: {}, formDraftId: null, filters: {} }

    case 'HIGHLIGHT':
      return { ...state, selectedId: action.id ?? null, highlightedIds: action.id ? [action.id] : [] }

    case 'HIGHLIGHT_MANY':
      return { ...state, highlightedIds: action.ids ?? [], selectedId: (action.ids ?? [])[0] ?? null }

    case 'SET_FILTER': {
      const base = action.page && action.page !== state.activePage
        ? { ...state, activePage: action.page as ActivePage, selectedId: null, highlightedIds: [], detailOpen: false, filters: {} }
        : state.detailOpen
          ? { ...state, selectedId: null, highlightedIds: [], detailOpen: false }
          : state
      return { ...base, filters: { ...base.filters, ...action.filters } }
    }

    case 'REPLACE_FILTER': {
      const base = action.page && action.page !== state.activePage
        ? { ...state, activePage: action.page as ActivePage, selectedId: null, highlightedIds: [], detailOpen: false, filters: {} }
        : state.detailOpen
          ? { ...state, selectedId: null, highlightedIds: [], detailOpen: false }
          : state
      return { ...base, filters: action.filters ?? {} }
    }

    case 'REMOVE_FILTER': {
      const next = { ...state.filters }
      delete next[action.key as string]
      return { ...state, filters: next }
    }

    case 'CLEAR_FILTERS':
      return { ...state, filters: {} }

    case 'OPEN_DETAIL': {
      const base = action.page && action.page !== state.activePage
        ? { ...state, activePage: action.page as ActivePage, selectedId: null, highlightedIds: [], filters: {} }
        : state
      return {
        ...base,
        selectedId: action.id ?? null,
        detailOpen: true,
        detailMode: 'view',
        detailKind: action.kind ?? base.detailKind,
        detailVersion: state.detailVersion + 1,
        listVersion: state.listVersion + 1,
      }
    }

    case 'OPEN_FORM': {
      const base = action.page && action.page !== state.activePage
        ? { ...state, activePage: action.page as ActivePage, selectedId: null, highlightedIds: [], filters: {} }
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

    case 'SET_FORM_FIELDS':
      return {
        ...state,
        formDraftId: action.draftId ?? state.formDraftId,
        formFields: { ...state.formFields, ...(action.fields || {}) },
        formBaseline: { ...state.formBaseline, ...(action.fields || {}) },
        detailVersion: state.detailVersion + 1,
      }

    case 'EDIT_FORM_FIELD':
      return {
        ...state,
        formFields: { ...state.formFields, [action.key as string]: action.value },
      }

    case 'COMMIT_FORM':
      return {
        ...state,
        formDraftId: action.draftId ?? state.formDraftId,
        formBaseline: { ...state.formFields },
      }

    case 'CLOSE_DETAIL':
      return { ...state, detailOpen: false, detailMode: 'view' }

    case 'CLEAR':
      return { ...state, selectedId: null, highlightedIds: [], detailOpen: false, detailMode: 'view', formFields: {}, formBaseline: {}, formDraftId: null, filters: {} }

    default:
      return state
  }
}

export function agentActionToReducerActions(action: ReducerAction): ReducerAction[] {
  const out: ReducerAction[] = []
  const page = VALID_PAGES.includes(action.page as ActivePage) ? action.page : undefined
  switch (action.type) {
    case 'NAVIGATE':
      if (page) out.push({ type: 'NAVIGATE', page })
      break
    case 'HIGHLIGHT':
      if (page) out.push({ type: 'NAVIGATE', page })
      if (Array.isArray(action.ids) && action.ids.length > 1) out.push({ type: 'HIGHLIGHT_MANY', ids: action.ids })
      else if (Array.isArray(action.ids) && action.ids.length === 1) out.push({ type: 'HIGHLIGHT', id: action.ids[0] })
      else if (action.id) out.push({ type: 'HIGHLIGHT', id: action.id })
      break
    case 'HIGHLIGHT_MANY':
      if (page) out.push({ type: 'NAVIGATE', page })
      if (Array.isArray(action.ids) && action.ids.length > 0) out.push({ type: 'HIGHLIGHT_MANY', ids: action.ids })
      break
    case 'SET_FILTER':
      if (action.filters) out.push({ type: 'REPLACE_FILTER', filters: action.filters, page })
      else if (page) out.push({ type: 'NAVIGATE', page })
      break
    case 'OPEN_DETAIL':
      if (action.id) out.push({ type: 'OPEN_DETAIL', id: action.id, page, kind: action.kind })
      break
    case 'OPEN_FORM':
      out.push({ type: 'OPEN_FORM', id: action.id, page, kind: action.kind, draftId: action.draftId, fields: action.fields })
      break
    case 'SET_FORM_FIELDS':
      out.push({ type: 'SET_FORM_FIELDS', draftId: action.draftId, fields: action.fields })
      break
    case 'CLOSE_DETAIL':
      out.push({ type: 'CLOSE_DETAIL' })
      break
    case 'CLEAR':
      out.push({ type: 'CLEAR' })
      break
  }
  return out
}

const _states = new Map<string, DocumentState>()
const _bus = new EventEmitter()
_bus.setMaxListeners(0)
const MAX_SESSIONS = 5000

export function getState(sessionId: string): DocumentState {
  return _states.get(sessionId) ?? makeInitialState()
}

function _commit(sessionId: string, next: DocumentState, source: string): DocumentState {
  if (!_states.has(sessionId) && _states.size >= MAX_SESSIONS) {
    const oldest = _states.keys().next().value
    if (oldest) _states.delete(oldest)
  }
  _states.set(sessionId, next)

  _bus.emit('change', { sessionId, state: next, source: source || 'unknown' })
  return next
}

export function replaceState(sessionId: string, patch: Partial<DocumentState>, source: string): DocumentState {
  const base = getState(sessionId)
  const next: DocumentState = {
    activePage: VALID_PAGES.includes(patch.activePage as ActivePage) ? patch.activePage as ActivePage : base.activePage,
    selectedId: typeof patch.selectedId === 'string' ? patch.selectedId : (patch.selectedId === null ? null : base.selectedId),
    highlightedIds: Array.isArray(patch.highlightedIds) ? patch.highlightedIds.filter(x => typeof x === 'string') : base.highlightedIds,
    filters: (patch.filters && typeof patch.filters === 'object') ? patch.filters : base.filters,
    detailOpen: typeof patch.detailOpen === 'boolean' ? patch.detailOpen : base.detailOpen,
    detailMode: (patch.detailMode === 'view' || patch.detailMode === 'edit') ? patch.detailMode : base.detailMode,
    detailKind: typeof patch.detailKind === 'string' ? patch.detailKind as DetailKind : (patch.detailKind === null ? null : base.detailKind),
    formDraftId: typeof patch.formDraftId === 'string' ? patch.formDraftId : (patch.formDraftId === null ? null : base.formDraftId),
    formFields: (patch.formFields && typeof patch.formFields === 'object') ? patch.formFields : base.formFields,
    formBaseline: (patch.formBaseline && typeof patch.formBaseline === 'object') ? patch.formBaseline : base.formBaseline,
    detailVersion: Number.isFinite(patch.detailVersion) ? patch.detailVersion as number : base.detailVersion,
    listVersion: Number.isFinite(patch.listVersion) ? patch.listVersion as number : base.listVersion,
  }
  return _commit(sessionId, next, source)
}

export function dirtyFields(sessionId: string): string[] {
  const s = getState(sessionId)
  const keys = new Set([...Object.keys(s.formFields || {}), ...Object.keys(s.formBaseline || {})])
  const dirty: string[] = []
  for (const k of keys) {
    if ((s.formFields || {})[k] !== (s.formBaseline || {})[k]) dirty.push(k)
  }
  return dirty
}

export function applyAction(sessionId: string, action: ReducerAction, source: string): DocumentState {
  let state = getState(sessionId)
  const reducerActions = agentActionToReducerActions(action)
  const toApply = reducerActions.length > 0 ? reducerActions : [action]
  for (const a of toApply) state = reduce(state, a)
  return _commit(sessionId, state, source)
}

export function serializeViewContext(sessionId: string): ViewContext {
  const s = getState(sessionId)
  const ctx: ViewContext = { page: s.activePage }
  if (s.selectedId) ctx.selectedId = s.selectedId
  if (s.highlightedIds.length > 0) ctx.highlightedIds = s.highlightedIds
  if (Object.keys(s.filters).length > 0) ctx.filters = s.filters
  if (s.detailOpen) {
    ctx.detailOpen = true
    ctx.detailMode = s.detailMode
    if (s.detailKind) ctx.detailKind = s.detailKind
    if (s.detailMode === 'edit') {
      if (s.formDraftId) ctx.formDraftId = s.formDraftId
      if (Object.keys(s.formFields).length > 0) ctx.formFields = s.formFields
      const dirty = dirtyFields(sessionId)
      if (dirty.length > 0) ctx.dirtyFields = dirty
    }
  }
  return ctx
}

export function subscribe(sessionId: string, listener: ChangeListener): () => void {
  const handler = (evt: ChangeEvent) => { if (evt.sessionId === sessionId) listener(evt) }
  _bus.on('change', handler)
  return () => _bus.off('change', handler)
}
