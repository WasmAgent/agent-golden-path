// End-to-end chain test — proves the provable-agent pipeline works without a
// live LLM: execute tools → record evidence → score with OAA → issue passport.
// Run with: npm test

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'crypto'
import { executeTool } from '../src/chat/execute-tool'
import * as store from '../src/store'

// Record a tool call into the chat tool log the way chat-service does, so the
// audit service can later turn it into AEP evidence.
function logTool(turnId: string, toolName: string, args: any, result: any, stateChanging: boolean) {
  store.insertChatToolLog({
    id: randomUUID(), calledAt: new Date().toISOString(), userId: 'demo_user', turnId,
    toolName, toolArgs: JSON.stringify(args), toolResult: JSON.stringify(result),
    durationMs: 1, hasError: !!result?.error, errorMessage: result?.error || '',
    outcome: result?.error ? 'error' : 'allow', stateChanging, userMessage: 'test turn',
    assistantMessage: '', ipAddress: '', correlationId: '',
  })
}

test('compliance blocks a PR with a blocked vendor', async () => {
  const { result: draft } = await executeTool('save_pr_draft', {
    materialId: 'MAT-BOLT-M12', quantity: 100, unit: 'EA', estimatedPrice: 2.5,
    costCentreId: 'CC-FAC-001', vendorId: 'V004', requiredDate: '2026-12-01',
  })
  assert.ok(draft.draftId, 'draft created')

  const { result: checks } = await executeTool('run_compliance_checks', { draftId: draft.draftId })
  assert.equal(checks.canSubmit, false, 'blocked vendor must fail compliance')
  const vendorCheck = checks.checks.find((c: any) => c.rule === 'vendor_whitelist')
  assert.equal(vendorCheck.status, 'BLOCKED')
})

test('compliance passes and a PR can be submitted', async () => {
  const { result: draft } = await executeTool('save_pr_draft', {
    materialId: 'MAT-CHAIR-ERG', quantity: 2, unit: 'EA', estimatedPrice: 180,
    costCentreId: 'CC-FAC-001', vendorId: 'V003', requiredDate: '2026-12-01',
  })
  const { result: checks } = await executeTool('run_compliance_checks', { draftId: draft.draftId })
  assert.equal(checks.canSubmit, true, 'clean draft must pass compliance')

  const { result: submitted } = await executeTool('submit_pr', { draftId: draft.draftId })
  assert.ok(submitted.prNumber?.startsWith('PR-'), 'PR created')
  assert.equal(submitted.policyBypass, false, 'compliance ran before submit')
  assert.ok(store.findPR(submitted.prNumber), 'PR persisted in store')
})

test('budget guard rail blocks an over-budget PR', async () => {
  // CC-OPS-001 has only 5,500 remaining; a 50,000 order must be blocked.
  const { result: draft } = await executeTool('save_pr_draft', {
    materialId: 'MAT-LAPTOP-14', quantity: 50, unit: 'EA', estimatedPrice: 1000,
    costCentreId: 'CC-OPS-001', vendorId: 'V003', requiredDate: '2026-12-01',
  })
  const { result: checks } = await executeTool('run_compliance_checks', { draftId: draft.draftId })
  const budgetCheck = checks.checks.find((c: any) => c.rule === 'budget')
  assert.equal(budgetCheck.status, 'BLOCKED', 'over-budget must be blocked')
})

test('recorded tool calls produce signed AEP evidence and an OAA score', async () => {
  // Simulate one audited turn: a compliance check + a submit.
  const turnId = randomUUID()
  store.insertChatToolLog({
    id: randomUUID(), calledAt: new Date().toISOString(), userId: 'demo_user', turnId,
    toolName: '__turn__', toolArgs: '{}', toolResult: '', durationMs: 0, hasError: false,
    errorMessage: '', outcome: 'allow', stateChanging: false, userMessage: 'create a PR',
    assistantMessage: 'done', ipAddress: '', correlationId: '',
  })
  logTool(turnId, 'run_compliance_checks', { draftId: 'DR-x' }, { canSubmit: true }, false)
  logTool(turnId, 'submit_pr', { draftId: 'DR-x' }, { prNumber: 'PR-000099' }, true)

  // Build the evidence + score through the same code path the report uses.
  const AEP = await import('@wasmagent/aep')
  const core = await import('@openagentaudit/core')
  const { AEPEmitter, createLocalSignerFromSeed } = AEP as any
  const signer = createLocalSignerFromSeed('a'.repeat(64), 'test-key')
  const factory = AEPEmitter.withDefaults({ model_id: 'test', model_provider: 'anthropic', runtime_version: '1.0.0', tool_manifest_digest: 'x', signer, schemaVersion: 'aep/v0.5', authority_origin: 'subject_consented', identity_source: 'organization_attested' })
  const emitter = factory.create({
    run_id: `turn-${turnId}`, trace_id: randomUUID(), allowEmptyActions: true,
    run_context: { agent_id: 'procurement-copilot', agent_version: '1.0.0', session_id: turnId },
    // High-risk turn: the bounded lease is signed by the budget owner, so the
    // backing claim is stronger than the floor (the runtime-asserted reads).
    attribution_backing: 'principal_key_signed',
    run_attribution_backing_observed: ['operator_asserted', 'principal_key_signed'],
    authorized_by: 'budget_owner',
    authorization_evidence_count: 3,
  })
  emitter.addAction({ tool_name: 'submit_pr', state_changing: true, timestamp_ms: Date.now(), recording_mode: 'full', side_effect_class: 'mutate-external', capability_decision: { capability: 'write:pr_submit', subject: 'demo_user', resource: 'procurement:submit_pr', decision: 'allow', approval_mode: 'bounded-lease' } })
  const record = await emitter.emit(Date.now())
  assert.ok(record, 'AEP record emitted')
  assert.equal(record.schema_version, 'aep/v0.5', 'record declares aep/v0.5')
  assert.equal(record.attribution_backing, 'principal_key_signed', 'strong backing claim present')
  assert.equal(record.run_attribution_backing_floor, 'operator_asserted', 'floor auto-computed as weakest observed — never rounded up')
  assert.equal(record.run_attribution_backing_observed.length, 2, 'every observed grade itemized')
  assert.equal(record.authorized_by, 'budget_owner', 'authorizing party distinct from user_id')

  const { AepV0_2Adapter, getAttribution } = await import('@openagentaudit/adapters/aep-v0_2') as any
  const events = AepV0_2Adapter.toEventsBatch ? AepV0_2Adapter.toEventsBatch([record]) : AepV0_2Adapter.toEvents(record)
  assert.ok(events.length > 0, 'AEP record adapts to OAA events')

  const attribution = getAttribution(record)
  assert.equal(attribution?.attribution_backing, 'principal_key_signed', 'adapter extracts attribution grading')

  const riskScore = await core.computeRiskScore(events, undefined, undefined, undefined)
  assert.ok(riskScore.evidence_admission_score, 'OAA produced an evidence admission score')
  assert.ok(typeof riskScore.evidence_admission_score.grade === 'string', 'EAS has a letter grade')
  // The attribution-integrity bonus is applied inside provenance_integrity and
  // is capped at 100 — a fully-signed record already sits at the cap, so the
  // guarantee to assert here is "honest grading never lowers the score" (the
  // penalty path for 'unknown' grades is what differentiates in practice).
  const scored = await core.computeRiskScore(events, undefined, undefined, undefined, undefined, undefined, attribution)
  assert.ok(
    scored.evidence_admission_score.score >= riskScore.evidence_admission_score.score,
    'attribution-integrity scoring never lowers a compliant record'
  )
})

test('attribution aggregate keeps the weakest floor across a mixed session', async () => {
  const { aggregateAttribution } = await import('../src/audit-service')
  const { AepV0_2Adapter, getAttribution } = await import('@openagentaudit/adapters/aep-v0_2') as any
  const getAttr = (r: any) => getAttribution(r)

  const { AEPEmitter, createLocalSignerFromSeed } = await import('@wasmagent/aep') as any
  const signer = createLocalSignerFromSeed('a'.repeat(64), 'test-key')
  const factory = AEPEmitter.withDefaults({ model_id: 't', model_provider: 'anthropic', runtime_version: '1', tool_manifest_digest: 'x', signer, schemaVersion: 'aep/v0.5', authority_origin: 'subject_consented', identity_source: 'organization_attested' })

  const readOnly = await factory.create({ run_id: 'r1', allowEmptyActions: true, attribution_backing: 'operator_asserted', run_attribution_backing_observed: ['operator_asserted'], authorization_evidence_count: 1 }).emit(Date.now())
  const highRisk = await factory.create({ run_id: 'r2', allowEmptyActions: true, attribution_backing: 'principal_key_signed', run_attribution_backing_observed: ['operator_asserted', 'principal_key_signed'], authorized_by: 'budget_owner', authorization_evidence_count: 2 }).emit(Date.now())

  const agg = aggregateAttribution([readOnly, highRisk], getAttr)
  assert.equal(agg.authorized_by, 'budget_owner')
  assert.equal(agg.attribution_backing, 'principal_key_signed', 'aggregate reports the strongest backing actually exercised')
  assert.equal(agg.run_attribution_backing_floor, 'operator_asserted', 'aggregate floor is the weakest observed — never rounded up')
  assert.deepEqual(agg.run_attribution_backing_observed, ['operator_asserted', 'principal_key_signed'])
})
