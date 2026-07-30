# Procurement Copilot — Demo Script

A ~15-minute guided walkthrough of the full provable-agent chain, from a natural-language
request to a signed audit report.

## Prerequisites

```bash
# Terminal 1 — backend
npm install && cp .env.example .env
# edit .env: set ANTHROPIC_API_KEY
npm run dev            # http://localhost:4000

# Terminal 2 — web UI
npm run web:install
npm run web:dev        # http://localhost:5173
```

Open http://localhost:5173. The Copilot chat panel is on the right; the document
list/detail pages are on the left. All data is in-memory demo data and resets when you
restart the backend (or POST `/api/chat/reset-db`).

## The cast (seed data)

- **Vendors** — V001 Meridian Industrial Supply, V002 Northwind Tools & Hardware,
  V003 Apex Office Solutions, **V004 Blackline Fasteners Co. (BLOCKED)**, V005 Cascade Electrical.
- **Cost centres** — CC-IT-001 (IT), CC-OPS-001 (Operations, **near budget limit**),
  CC-FAC-001 (Facilities), CC-OLD-009 (**expired**).
- **Existing docs** — PR-000001 (approved), PR-000002 (pending), PR-000003 (approved),
  PO-000001 (partially received), INV-000001 (pending three-way match).

---

## Act 1 — Create a requisition

**Scene 1 — State the need in plain English**

> "I need to order 4 ergonomic office chairs for the facilities team, delivery by the end of November."

The agent should: search materials (finds `MAT-CHAIR-ERG`), start a draft, and either ask
for the missing fields (cost centre, vendor) or suggest values from historical PRs. Provide
`CC-FAC-001` and vendor `V003` when asked.

**Scene 2 — Run compliance and submit**

> "Run the compliance checks."

You should see ✅ for required fields, vendor whitelist, cost centre validity, and budget.

> "Submit it."

A new PR is created (`PR-0000xx`, status PENDING_APPROVAL). Watch the left panel navigate
to the requisitions list and highlight the new row.

---

## Act 2 — Governance guard rails

**Scene 3 — Blocked-vendor guard rail**

> "Create a PR for 200 hex bolts from Blackline Fasteners, cost centre CC-FAC-001, delivery Dec 1."

When you run compliance, the **Vendor Whitelist** check returns ❌ — V004 is blocked. The
agent must refuse to submit. This refusal is recorded as evidence.

**Scene 4 — Budget guard rail**

> "Create a PR for 50 laptops at $1,000 each on cost centre CC-OPS-001, delivery Dec 1."

CC-OPS-001 has only ~$5,500 remaining. The **Budget** check returns ❌ (exceeded). Again,
no submission — and the block is in the evidence trail.

---

## Act 3 — Fulfil the order

**Scene 5 — Convert an approved PR to a PO**

> "Convert PR-000003 to a purchase order."

PR-000003 is APPROVED, so this succeeds and creates a new PO. (Try it on PR-000002, which
is only PENDING_APPROVAL — the agent should refuse, because only approved PRs convert.)

**Scene 6 — Invoice three-way match**

> "Run the three-way match on INV-000001."

The agent matches invoice × PO × goods receipt. INV-000001's PO is only partially received,
so expect a PARTIAL match and a payment block.

---

## Act 4 — The payoff: signed, auditable evidence

**Scene 7 — What did the agent actually do?**

> "Show me the audit log."

The agent lists its recorded actions — including the compliance blocks and any policy
bypass from Act 1–2.

**Scene 8 — The signed audit report**

Open the audit report directly (it renders as a full HTML page):

```
http://localhost:4000/api/audit/report?format=html
```

You get:
- an **Evidence Admission Score** (EAS) and **Agent Risk Score** (ARS),
- per-tool call statistics and a turn-by-turn table,
- the **open-agent-audit** compliance analysis (OWASP Agentic Top 10, EU AI Act, NIST AI RMF),
- a **Trust Passport** badge summarising evidence quality — signed when `AEP_SIGNING_SEED` is set.

Also available:
- `…/api/audit/report?format=markdown`
- `…/api/audit/report?format=csv`
- `…/api/audit/passport` (JSON trust passport)
- `…/api/audit/analyze` (JSON score + findings)

That report is the whole point of the golden path: not just that the agent ran, but that
you can **prove what it did** — with signed, verifiable evidence a governance or compliance
tool can consume.

---

## Reset between runs

```bash
curl -X POST http://localhost:4000/api/chat/reset-db
```

or just restart `npm run dev` — all state is in memory.

## Appendix — headless panel control (no browser)

The left panel is a server-mirrored, API-addressable resource, so you can drive it without
a browser:

```bash
# Read what the panel currently shows
curl http://localhost:4000/api/panel/demo-session

# Open a read-only detail view
curl -X POST http://localhost:4000/api/panel/demo-session/action \
  -H 'content-type: application/json' \
  -d '{"type":"OPEN_DETAIL","page":"prs","id":"PR-000001","kind":"pr"}'

# Watch changes live
curl -N http://localhost:4000/api/panel/demo-session/events
```
