# Milestones

## Milestone 1 — Core Execution & Tool Guardrails

- [ ] Implement `src/agent/copilot.ts` using `@wasmagent/core` `ToolCallingAgent` for P2P intent parsing and requisition drafting
- [ ] Configure `@wasmagent/mcp-firewall` rules in `config/firewall.json` to vet incoming tool descriptors
- [ ] Implement intent guardrail hooks in `src/guardrails/intent.ts` to gate high-risk financial tool calls
- [ ] Create procurement service interface in `src/services/procurement.ts` for purchase requisition (PR) creation and status tracking
- [ ] Implement CLI entry point `bin/copilot.js` accepting prompt inputs (`npx copilot ask "<request>"`)
- [ ] Add integration test suite `tests/agent-execution.test.ts` verifying blocked high-risk calls and valid PR generation

## Milestone 2 — Compliance Verification & Signed Evidence

- [ ] Implement deterministic compliance checks in `src/compliance/p2p-rules.ts` using `@wasmagent/compliance` for spending thresholds
- [ ] Integrate `@wasmagent/aep` in `src/evidence/aep-logger.ts` to record and cryptographically sign tool execution traces
- [ ] Expand `src/services/procurement.ts` to track full P2P lifecycle state transitions (PR -> PO -> Goods Receipt -> Invoice)
- [ ] Add CLI command `bin/copilot.js verify --evidence <path>` to validate signed AEP evidence chains
- [ ] Export signed evidence bundles to `.aep` archive files in `out/evidence/`
- [ ] Add test suite `tests/compliance-evidence.test.ts` validating signed evidence integrity across multi-step P2P transactions

## Milestone 3 — Risk Scoring & Trust Passport Issuance

- [ ] Implement risk scoring engine in `src/audit/risk-scorer.ts` using `@openagentaudit/core` for OWASP, EU AI Act, and NIST framework evaluations
- [ ] Integrate `@openagentaudit/passport` in `src/audit/passport-generator.ts` to issue verifiable agent trust passports
- [ ] Add NIST AI RMF compliance validation modules in `src/audit/nist-checks.ts`
- [ ] Implement CLI command `bin/copilot.js audit --bundle <path>` to execute audit rule sets on AEP evidence packages
- [ ] Add end-to-end test suite `tests/trust-passport.test.ts` asserting trust passport generation from audited execution traces
- [ ] Implement benchmark script `scripts/benchmark-risk.ts` measuring audit scoring performance across compliant and non-compliant trace samples

## Milestone 4 — Human-Readable Reporting & E2E Golden Path

- [ ] Implement multi-format report exporter in `src/reports/exporter.ts` generating HTML, Markdown, and CSV audit reports
- [ ] Create interactive HTML report template in `templates/audit-report.html` featuring visual risk scores and trace timelines
- [ ] Add CLI command `bin/copilot.js report --bundle <path> --format html|md|csv` for generating human-readable audit reports
- [ ] Implement end-to-end golden path test `tests/golden-path-e2e.test.ts` validating user request -> agent execution -> evidence signing -> passport -> report generation
- [ ] Configure CI pipeline `.github/workflows/golden-path-ci.yml` running automated verification and publishing report artifacts