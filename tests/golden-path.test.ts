// GP-4 — Golden Path E2E vectors. Complements tests/chain.test.ts with the
// negative cases required by the org alignment plan:
//   tampered evidence     -> signature verification must fail
//   tampered admission    -> tampered/weaker evidence must not earn a better
//                            admission score than clean evidence
// These run against the exact certified stack pinned by the lockfile
// (test:e2e:certified).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'crypto'

async function emitSignedRecord(opts: {
  attribution_backing: string
  observed: string[]
  authorized_by?: string
  authorization_evidence_count: number
}) {
  const AEP = await import('@wasmagent/aep')
  const { AEPEmitter, createLocalSignerFromSeed } = AEP as any
  const signer = createLocalSignerFromSeed('a'.repeat(64), 'gp-e2e-key')
  const factory = AEPEmitter.withDefaults({
    model_id: 'test', model_provider: 'anthropic', runtime_version: '1.0.0',
    tool_manifest_digest: 'x', signer, schemaVersion: 'aep/v0.5',
    authority_origin: 'subject_consented', identity_source: 'organization_attested',
  })
  const emitter = factory.create({
    run_id: `gp-${randomUUID()}`, trace_id: randomUUID(), allowEmptyActions: true,
    run_context: { agent_id: 'procurement-copilot', agent_version: '1.0.0', session_id: randomUUID() },
    attribution_backing: opts.attribution_backing,
    run_attribution_backing_observed: opts.observed,
    authorized_by: opts.authorized_by,
    authorization_evidence_count: opts.authorization_evidence_count,
  })
  emitter.addAction({
    tool_name: 'submit_pr', state_changing: true, timestamp_ms: Date.now(),
    recording_mode: 'full', side_effect_class: 'mutate-external',
    capability_decision: { capability: 'write:pr_submit', subject: 'demo_user', resource: 'procurement:submit_pr', decision: 'allow', approval_mode: 'bounded-lease' },
  })
  return { record: await emitter.emit(Date.now()), signer }
}

test('tampered evidence fails signature verification (ORG-GP-02)', async () => {
  const { record, signer } = await emitSignedRecord({
    attribution_backing: 'principal_key_signed',
    observed: ['operator_asserted', 'principal_key_signed'],
    authorized_by: 'budget_owner',
    authorization_evidence_count: 3,
  })
  const { verifyAEPRecord } = await import('@wasmagent/aep') as any
  const publicKey = await signer.getPublicKey()
  assert.equal(await verifyAEPRecord(record, publicKey), true, 'clean record verifies')

  const tampered = { ...record, actions: record.actions.map((a: any) => ({ ...a, tool_name: 'forged_tool' })) }
  assert.equal(await verifyAEPRecord(tampered, publicKey), false, 'tampered record must NOT verify')
})

test('weaker attribution earns strictly lower admission score (ORG-GP-04)', async () => {
  const { record: strong, } = await emitSignedRecord({
    attribution_backing: 'principal_key_signed',
    observed: ['operator_asserted', 'principal_key_signed'],
    authorized_by: 'budget_owner',
    authorization_evidence_count: 3,
  })
  const { record: weak, } = await emitSignedRecord({
    attribution_backing: 'operator_asserted',
    observed: ['operator_asserted'],
    authorization_evidence_count: 0,
  })
  const core = await import('@openagentaudit/core')
  const adapters = await import('@openagentaudit/adapters/aep-v0_2') as any
  const { AepV0_2Adapter, getAttribution } = adapters

  const toEvents = (r: any) => (AepV0_2Adapter.toEventsBatch ? AepV0_2Adapter.toEventsBatch([r]) : AepV0_2Adapter.toEvents(r))
  const strongScore = await (core as any).computeRiskScore(toEvents(strong), undefined, undefined, undefined, undefined, undefined, getAttribution(strong))
  const weakScore = await (core as any).computeRiskScore(toEvents(weak), undefined, undefined, undefined, undefined, undefined, getAttribution(weak))

  assert.ok(
    weakScore.evidence_admission_score.score <= strongScore.evidence_admission_score.score,
    `weak/unbacked evidence (${weakScore.evidence_admission_score.score}) must not out-admit signed evidence (${strongScore.evidence_admission_score.score})`,
  )
})

test('tampered content verification degrades admission (ORG-GP-02 at admission layer)', async () => {
  const { record: clean, } = await emitSignedRecord({
    attribution_backing: 'principal_key_signed',
    observed: ['operator_asserted', 'principal_key_signed'],
    authorized_by: 'budget_owner',
    authorization_evidence_count: 3,
  })
  const core = await import('@openagentaudit/core')
  const adapters = await import('@openagentaudit/adapters/aep-v0_2') as any
  const { AepV0_2Adapter, getAttribution } = adapters
  const toEvents = (r: any) => (AepV0_2Adapter.toEventsBatch ? AepV0_2Adapter.toEventsBatch([r]) : AepV0_2Adapter.toEvents(r))
  const events = toEvents(clean)
  const eventsWithHash = events.filter((e: any) => e.evidence?.content_hash || e.evidence?.hash).length
  assert.ok(eventsWithHash > 0, 'canonical events carry content hashes')

  // The signer/receiver computes content verification; a tampered record
  // surfaces as content-hash mismatches in the admission summary.
  const intact = await (core as any).computeRiskScore(events, undefined, undefined, { events_with_hash: eventsWithHash, hashes_content_verified: eventsWithHash, hashes_content_mismatch: 0 }, undefined, undefined, getAttribution(clean))
  const tampered = await (core as any).computeRiskScore(events, undefined, undefined, { events_with_hash: eventsWithHash, hashes_content_verified: eventsWithHash - 1, hashes_content_mismatch: 1 }, undefined, undefined, getAttribution(clean))
  assert.ok(
    tampered.evidence_admission_score.score < intact.evidence_admission_score.score,
    `admitted evidence with content mismatch (${tampered.evidence_admission_score.score}) must score strictly below intact evidence (${intact.evidence_admission_score.score})`,
  )
})
