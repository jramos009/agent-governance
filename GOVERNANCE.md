# Agent governance

The policy layer. [`README.md`](README.md) argues why; this states what.

Written for a specific situation — a single owner, a production application, and
coding agents with real tool access — and generalized here. The numbering
matches the source document's structure so cross-references in the agent
definitions resolve.

---

## 1. Owner authority

One person is the final authority for scope, implementation, source control,
production changes, deployment, data, security, credentials, and every
irreversible action. Agents advise, plan, implement within an approved scope,
test, and audit. They do not decide.

This is not deference for its own sake. It is the answer to a specific question:
*when this goes wrong, who is accountable?* If the answer is "the agent", the
system has no accountability at all.

## 2. Authority classes

| Class | Role | May edit source? | May certify readiness? |
|---|---|---|---|
| **Coordination** | Intake, routing, sequencing, gate tracking | No | No |
| **Planning** | Product, task, workflow planning | No | No |
| **Architecture** | System and data design, trade-offs | No — design only | No |
| **Implementation** | Scoped code changes | Yes, approved scope only | **No — cannot certify own work** |
| **Auditor** | Independent security, secrets, accessibility review | No | Findings only |
| **Testing** | Test design and evidence | Approved test files only | No |

The column that matters is the last one. **No agent that produces work may
certify it.** Every other rule follows from that.

## 3. Tool access

Each agent definition declares an explicit minimum `tools:` allowlist. In the
reference set:

- Read-only agents declare `Read, Grep, Glob`.
- Four coordination and architecture agents additionally declare `ToolSearch`
  and exactly eight retrieval-only MCP tools.
- Four implementation agents declare `Read, Grep, Glob, Edit, Write`.
- **No agent declares** `Bash`, `WebSearch`, `WebFetch`, browser automation,
  agent-executed Git, workflow automation, or any mutation-capable MCP tool.

No named-agent path can commit, push, checkout, merge, deploy, mutate a
database, modify production data, rotate credentials, install dependencies,
send communications, or delete data.

## 4. Controlled MCP allowlist

MCP is denied unless an agent definition names **both** the server and the exact
tool. In the reference pilot, four agents may call eight retrieval-only tools.
Everything else on the same server — indexing, ingestion, mutation, deletion —
is denied to every agent including those four.

Retrieval output is **indexed evidence only**. It does not establish runtime,
Git, browser, deployment, database, or production behaviour, and an agent that
cites it as though it does has produced a false verification.

If the index is stale or missing, the agent records the gap and falls back to
direct reads. It never triggers a re-index — that is a mutation.

## 5. Memory

No persistent agent memory. No active definition configures a `memory` field.

Credentials, customer data, health information, government-sensitive
information, production records, and private communications must never be
persisted in agent memory under any future configuration.

## 6. Evidence standards

- Separate **confirmed evidence** from **assumptions** and **hypotheses**.
- Never fabricate performance figures, test results, completed work, production
  behaviour, or user outcomes.
- Screenshots, logs, or reproducible steps are required to claim a runtime
  result.
- **"Verified" means an authoritative system was checked and the check is
  cited.** Anything written down in an earlier document is *documentary* and is
  labelled that way.
- Conflicts between sources are recorded and escalated, never silently
  reconciled. A silent reconciliation is indistinguishable from an error.

## 7. The 17-field handoff contract

Every handoff contains these fields, in this order. The owner transfers the
contract manually; it does not invoke the next agent.

1. Handoff ID
2. Source agent
3. Recommended next agent
4. Owner-approved task and file scope
5. Evidence inspected
6. Work completed
7. Files changed
8. **Files not changed**
9. Tests or checks performed
10. **Tests or checks not performed**
11. Findings and unresolved risks
12. Required owner-run actions
13. Required downstream verification
14. Readiness status
15. Approval required
16. Confidence
17. Evidence-source labels

Fields 8, 10 and 17 are the ones that matter, and they are the ones a summary
naturally omits. Field 17 uses exactly four labels per item: **directly
inspected**, **owner-supplied**, **agent-reported**, **unavailable**.

## 8. Approval gates

See [`docs/APPROVAL-VOCABULARY.md`](docs/APPROVAL-VOCABULARY.md) for the twelve
verbs and the four rules that govern them. In summary: approval is granted in
exact verbs, each verb authorizes only itself, approvals expire, ambiguity is
never approval, and **approval does not bypass the hook**.

## 9. Escalation and stop-work

**Escalate** when scope is ambiguous or expanding; a gated action is required;
evidence is insufficient to certify; a security or secrets issue is suspected;
or an assumption cannot be confirmed against repository evidence.

**Stop and report** when an action would exceed approved scope; a destructive or
irreversible action is implied; credentials would be exposed; production data or
deployment would be affected without approval; or repository evidence
contradicts the task's stated assumptions.

## 10. Rollback

Every production-impacting change has a documented rollback plan **before** it
is approved. Rollback readiness — how to revert, and verification that reverting
restores prior behaviour — is part of the release gate.

If the reverse operation cannot be stated in advance, the change is not ready.

## 11. Independent verification chain

1. Planning or architecture
2. Owner-approved implementation
3. Independent audit and/or test design
4. Evidence collection
5. Independent readiness verdict
6. Release review
7. Owner final decision

The coordination agent may track this chain but cannot replace, merge, perform,
or certify any stage.

An implementation agent must not route its own change directly to the readiness
verdict without intervening independent evidence. A proposal or implementation
must not route directly to release review.

## 12. Declared versus effective authority

Five layers can restrict what an agent may do:

1. Agent frontmatter `tools:` declarations
2. Project settings
3. User-level settings
4. **The PreToolUse hook**
5. Procedural owner-approved task and file scope

**The narrowest effective restriction governs.**

This distinction is the most important idea in the document. Layers 1–3 and 5
are *declarations* — they describe intent, and they hold only while
configuration is correct and instructions are followed. Layer 4 is
*enforcement*: it runs on every tool call and does not read intent.

A system whose safety rests only on declared authority is a system that is safe
until something is misconfigured, misread, or overridden by a persuasive
instruction. The gap between what a configuration says and what a process can
actually do is where incidents live.

Current enforcement in the reference implementation:

- `Bash` is denied unconditionally.
- `Edit`, `Write`, `NotebookEdit` are denied for targets not proven inside the
  repository, and for protected surfaces: `.claude/**`, `CLAUDE.md`,
  `.gitignore`, `.gitattributes`, `.git/**`.
- Controlled MCP is denied unless both agent identity and exact tool name match.
- Unknown and future tool names are denied by default.
- Malformed input is denied.
- **No approval phrase, prompt response, or session state changes any hook
  decision.**

Consequence: approved governance-surface edits are performed manually by the
owner, outside the agent write path. No autonomous protected-surface path
exists — including for the agent that would edit the guard itself.

## 13. Development versus production readiness

Passing static checks is not readiness. A readiness verdict names the
environment it applies to, and development readiness never implies production
readiness. Where runtime, device, browser, or deployment behaviour was not
observed, the verdict says so rather than inferring it.

## 14. A limitation this document does not hide

Layers 1–3 and 5 depend on configuration and instruction-following. Only layer 4
is enforced independently of what an agent was told.

That means the honest security boundary of this system is **the hook, plus
whatever the runtime itself guarantees** — not the policy. This document is how
the boundary is decided and reviewed; the hook is what holds it.

A governance framework that claims otherwise is describing intentions and
calling them controls.
