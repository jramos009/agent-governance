# Threat model

What this guardrail layer defends against, what it does not, and why the line is
drawn where it is.

## The setting

A coding agent operating on a local repository with real tool access: it can
read files, write files, and — unless something prevents it — run commands. One
human owner. No second reviewer on staff.

The agent is assumed **cooperative but fallible**, and its context is assumed
**untrusted**. That combination is the whole problem. The agent is not trying to
cause harm; it is trying to be helpful, using instructions and file contents it
cannot fully authenticate.

---

## What this defends against

### 1. Helpfulness cascade

The most likely failure, and the least dramatic. An agent approved to fix a
defect stages the fix; having staged it, commits; having committed, pushes. Each
step is locally reasonable. The sequence was never authorized.

**Defence:** twelve separate approval verbs, none implying any other, each
expiring when the diff changes. Plus the structural one — no agent holds Git
tools at all, so the cascade has nowhere to go.

### 2. Self-certification

An agent implements a change and reports it as verified. This is the failure
that feels most reasonable in the moment and is hardest to catch by reading
output, because the report is fluent and internally consistent.

**Defence:** implementation agents cannot certify readiness. The chain routes
through independent audit, evidence collection, and an independent verdict. An
implementer must not route its own change directly to the verdict.

### 3. Scope drift

Approved to touch four files, the agent touches a fifth because the fix
genuinely needed it. Reasonable, undisclosed, and cumulative.

**Defence:** procedurally, approval names an exact file scope and widening
requires re-approval. Structurally, the hook denies writes outside the
repository and to protected surfaces regardless of what scope was claimed.
Reporting-wise, the handoff contract has a *files not changed* field, so an
approved scope of four with two touched is visible rather than inferred.

### 4. Configuration self-modification

An agent that can edit `.claude/**` can edit the rules constraining it, or the
hook enforcing them. This is the one that matters most, because it converts
every other control into a suggestion.

**Defence:** `.claude/**`, `CLAUDE.md`, `.gitignore`, `.gitattributes` and
`.git/**` are protected surfaces. Edit, Write and NotebookEdit against them are
denied by the hook. **No approval phrase unlocks this.** The owner edits those
files by hand, outside the agent write path.

### 5. Path aliasing to reach a protected file

A write is directed at a path that looks unprotected but resolves — via symlink,
hard link, alternate data stream, 8.3 short name, or a trailing dot or space —
to a protected file or somewhere outside the repository.

**Defence:** dual confinement. The lexical path *and* the canonical path must
both resolve inside the repository and neither may be protected. Ambiguous or
non-canonicalizable forms are denied rather than resolved optimistically. An
existing file with suspicious link count fails closed, because a hard link
aliases a protected file under a path whose real path looks innocent.

### 6. Prompt injection reaching a tool call

Instructions embedded in a file, a web page, or tool output persuade the agent
to take an action it would otherwise decline.

**Partial defence, and the honest framing matters.** Nothing here stops an agent
being *persuaded* — that is a model-behaviour problem, not a hook problem. What
the hook does is bound the consequence. A persuaded agent still cannot run a
command, still cannot write outside the repository, still cannot touch its own
configuration, and still cannot reach a mutating MCP tool. The attack surface
becomes what an agent can do with `Read`, `Grep`, `Glob`, and writes confined to
non-protected repository paths.

That is a meaningfully smaller blast radius. It is not immunity, and this
document does not claim it is.

### 7. Unknown and future capabilities

A new tool appears in the runtime and nobody updates the policy.

**Defence:** default deny. Absence from the allowlist yields deny, never allow.
The cost is real — a legitimate new tool is blocked until deliberately added —
and that is the correct direction for the cost to fall.

---

## What this does NOT defend against

Stated plainly, because a threat model that only lists wins is marketing.

- **A compromised runtime or host.** If the agent runtime itself is malicious or
  compromised, a hook it invokes is not a boundary. This assumes an honest
  runtime enforcing its own hook contract.
- **Anything outside the tool-call path.** The hook sees tool calls. It does not
  see what the model reasons, remembers within a session, or writes into a
  message.
- **Data exfiltration through allowed reads.** `Read`, `Grep` and `Glob` are
  permitted. An agent can read any repository file and reproduce it in its
  output. There is no read-side classification here, and secrets in the
  repository remain readable — the mitigation for that is not committing them.
- **The owner's own mistakes.** Approving the wrong scope, or hand-editing a
  governance file incorrectly, is not caught. The guard constrains agents, not
  people. It is not a compensating control for a distracted owner at 2am.
- **Supply chain.** Dependencies, MCP server implementations, and the runtime's
  own updates are out of scope. A controlled-MCP pilot constrains *which* tools
  an agent may call; it says nothing about what the server does with the call.
- **Multi-tenant or team environments.** Single owner, single machine. Shared
  approval state, per-user scoping and audit attribution across a team are not
  addressed and would need real design.

---

## The assumption everything rests on

**The hook runs, and its decision is honoured.**

If the runtime does not invoke it, or ignores a deny, every control in this
repository evaporates at once. That is a single point of failure and it should
be named as one.

It is also not hypothetical. The live hook in this project spent a period
unable to parse — four lines of unrelated text had been appended — and therefore
enforcing nothing, while hash verification continued to pass because the file
was unchanged since its last recorded hash.

The lesson generalizes past this codebase: **verify that a control executes, not
merely that its bytes are unmodified.** Integrity checking and functional
verification answer different questions, and only one of them tells you the
guard is on.
