// Smoke test: seed chat tool logs in-process, then boot the server so the
// audit endpoints see them. Exercises /api/audit/export and /report html.
import { randomUUID } from 'crypto'
import * as store from '../src/store'

const turnId = randomUUID()
const row = (toolName: string, stateChanging: boolean) => ({
  id: randomUUID(), calledAt: new Date().toISOString(), userId: 'demo_user', turnId,
  toolName, toolArgs: '{}', toolResult: '{"ok":true}', durationMs: 1, hasError: false,
  errorMessage: '', outcome: 'allow', stateChanging, userMessage: toolName === '__turn__' ? 'create a PR' : '',
  assistantMessage: toolName === '__turn__' ? 'done' : '', ipAddress: '', correlationId: '',
})
store.insertChatToolLog(row('__turn__', false) as any)
store.insertChatToolLog(row('run_compliance_checks', false) as any)
store.insertChatToolLog(row('submit_pr', true) as any)

import('../src/server')
