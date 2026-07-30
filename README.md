# Agent Golden Path — Procurement Copilot

> **The canonical golden path for the WasmAgent provable-agent stack.** This is the
> reference implementation the rest of the ecosystem points to: a single, runnable,
> real-world application that wires every layer of the stack together and proves the
> whole chain works — not a slide, not a stub. If you want to see how `@wasmagent/*`
> and `@openagentaudit/*` compose into a system that can *prove what an agent did*,
> start here.

A **reference application** that demonstrates the WasmAgent provable-agent stack end to end:

```
user request
   → agent execution            (@wasmagent/core   — ToolCallingAgent)
   → tool admission             (@wasmagent/mcp-firewall — vet tool descriptors)
   → intent guardrail           (@wasmagent/core   — high-risk tool calls gated)
   → compliance verification    (@wasmagent/compliance — deterministic checks)
   → signed evidence            (@wasmagent/aep    — every action recorded & signed)
   → risk scoring + findings    (@openagentaudit/core — OWASP / EU AI Act / NIST)
   → trust passport             (@openagentaudit/passport)
   → human-readable audit report (HTML / Markdown / CSV)
```

The application itself is an AI **Procure-to-Pay copilot**: describe what you need in
plain English and the agent collects fields, runs compliance guard rails, and submits a
purchase requisition — then tracks PRs → POs → goods receipts → invoices, and can produce
a signed audit report of everything the agent did.

Every package in the chain above is on public npm. This repo shows how they compose into
one working system — nothing is stubbed, the whole path runs on a fresh `npm install`.

## Why this exists

Most "agent" demos stop at "the agent called a tool." The hard, unsolved part is
**proving what the agent did** — with signed, verifiable, replayable evidence that a
downstream governance or compliance tool can consume. This app is the smallest complete
example of that full path, from a natural-language request to a signed audit report.

## Quick start

```bash
# 1. Install
npm install
npm run web:install

# 2. Configure
cp .env.example .env
# edit .env — set ANTHROPIC_API_KEY (get one at https://console.anthropic.com/)

# 3. Run (two terminals)
npm run dev        # backend on :4000
npm run web:dev    # web UI on :5173 (proxies /api to :4000)
```

Open http://localhost:5173. The Copilot panel is on the right.

No database, no external services, no API keys beyond Anthropic — all procurement data
lives in memory, seeded from `src/seed/seed-data.json`, and resets on restart.

## The evidence chain, endpoint by endpoint

| Endpoint | What it shows |
|---|---|
| `POST /api/chat/stream` | One agent turn. Tools are vetted at startup, high-risk calls are gated by an intent guardrail, and **every tool call is recorded** to the evidence log. |
| `GET /api/audit/analyze` | Turns the recorded activity into AEP evidence, scores it with open-agent-audit, and returns the Evidence Admission Score + policy findings. |
| `GET /api/audit/passport` | Issues a signed Trust Passport summarising the agent's evidence quality. |
| `GET /api/audit/report?format=html` | The human-readable payoff: a full audit report with score cards, per-tool statistics, the OAA compliance analysis, and the passport badge. Also `format=markdown` / `format=csv`. |

## Compliance guard rails

The copilot blocks non-compliant requisitions before they are ever submitted:

| Rule | Check | Severity |
|---|---|---|
| Required fields | material/description, quantity, unit, cost centre, delivery date | ❌ Blocked |
| Vendor approval | vendor must not be blocked | ❌ Blocked |
| Cost centre validity | must be active and within its valid date range | ❌ Blocked |
| Budget — exceeded | estimated total > remaining budget | ❌ Blocked |
| Budget — near limit | utilisation will exceed 80% | ⚠️ Warning |

A `submit` without a prior compliance check is allowed to proceed **but recorded as a
policy bypass in the evidence** — so the audit report surfaces it. That is the point:
the system does not just enforce, it *proves* what happened.

## Architecture

```
web/  — React + Vite UI (chat panel + list/detail pages + audit page)
src/
  server.ts            Express entry: vets tools, validates the tool BOM, mounts routers
  chat-service.ts      SSE chat endpoint — drives one agent turn, records every tool call
  agent-engine.ts      builds the @wasmagent/core ToolCallingAgent
  guardrails.ts        intent-alignment guardrail for high-risk tools
  audit-service.ts     AEP evidence → OAA scoring → trust passport → audit report
  memory-service.ts    per-user structured memory (@wasmagent/core)
  llm-client.ts        Anthropic streaming + JSON helpers
  store.ts             in-memory persistence, seeded from JSON
  chat/
    tool-definitions.ts  the agent's tools (@wasmagent/core tool objects)
    execute-tool.ts      the procurement domain logic behind each tool
    system-prompt.ts     the agent's instructions
    panel-store.ts       server-mirrored UI panel state (headless-testable)
    panel-router.ts      REST + SSE for the panel
```

## Optional integrations

All off by default; enable via `.env`:

- `OTEL_EXPORTER_OTLP_ENDPOINT` — export each chat turn as an OpenTelemetry span (`@wasmagent/otel-exporter`)
- `A2A_ENABLED=1` — mount an agent-to-agent server at `/api/a2a` (`@wasmagent/a2a`)
- `AG_UI_ENABLED=1` — stream turns over the AG-UI protocol at `/api/chat/ag-ui/events` (`@wasmagent/ag-ui`)

## Tests

```bash
npm test
```

The chain test (`tests/chain.test.ts`) proves the pipeline works **without a live LLM**:
it exercises the compliance guard rails and then runs a recorded turn through AEP signing
and OAA scoring, asserting a real evidence admission score comes out the other end.

**CI runs it two ways.** On every push/PR, `.github/workflows/ci.yml` runs the chain test
against the pinned dependency versions. In addition, `.github/workflows/canary.yml` runs
daily (06:00 UTC) and re-runs the chain test against the **latest published**
`@wasmagent/*` and `@openagentaudit/*` packages — so an upstream release that breaks the
golden path is caught within a day, independent of this repo's pinned versions.

## Demo

See [DEMO_SCRIPT.md](DEMO_SCRIPT.md) for a guided walkthrough (~15 min): PR creation,
compliance guard rails, PR→PO conversion, invoice three-way match, and the signed audit
report.

## License

MIT — see [LICENSE](LICENSE).
