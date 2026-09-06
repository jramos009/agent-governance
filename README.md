# Agent governance: enforced, not declared

A working guardrail layer for coding agents with real tool access — the hooks,
the policy, and the tests that prove the hooks do what the policy says.

Extracted from a governed agent setup I built and run on my own production
application: 16 agent definitions, two PreToolUse hooks, an approval-gate model,
and an evidence standard.

```
npm test        # 15 tests against the live hook, no dependencies
```

---

## The problem this solves

Most "AI agent governance" is a document. It says the agent may not deploy, may
not touch credentials, may not edit its own configuration. Then the agent is
given `Bash` and the document becomes a suggestion.

The gap has a name worth using: **declared authority versus effective
authority.**

Declared authority is what the configuration says — frontmatter tool lists,
project settings, the policy document, the scope you approved. It holds exactly
as long as configuration is correct, instructions are followed, and nothing
persuasive appears in the context window.

Effective authority is what the process can actually do.

The distance between those two is where incidents live. This repository is about
closing it with something that runs on every tool call and does not read intent.

---

## What is here

| | |
|---|---|
| [`.claude/hooks/protect-governance-surfaces.js`](.claude/hooks/protect-governance-surfaces.js) | Default-deny PreToolUse guard, 471 lines |
| [`.claude/hooks/enforce-tool-allowlist.js`](.claude/hooks/enforce-tool-allowlist.js) | Narrower guard for one MCP namespace |
| [`.claude/settings.example.json`](.claude/settings.example.json) | How both are registered |
| [`GOVERNANCE.md`](GOVERNANCE.md) | The policy layer |
| [`docs/APPROVAL-VOCABULARY.md`](docs/APPROVAL-VOCABULARY.md) | Twelve approval verbs and four rules |
| [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) | What this defends against, and what it does not |
| [`agents/`](agents/) | Three representative agent definitions |
| [`test/`](test/) | Behavioural tests against the real hook |

---

## The guard

**Tool-level default deny.** Every PreToolUse event is denied unless it matches
an explicit allow rule. Omission never yields allow — a tool name nobody
anticipated is denied because it is unrecognized, not permitted because it is
unlisted.

That inversion is most of the value. An allowlist that has to be updated when a
new capability appears fails safe; a denylist fails open, silently, on exactly
the tool nobody thought to add.

The five rules, in order:

1. `Bash` → **deny unconditionally**, without inspecting the command. Command
   inspection is a parsing problem with no clean win; declining to play is
   cheaper and correct.
2. Exact core allowlist → allow. `Read`, `Grep`, `Glob`, plus control-plane
   operations that touch no filesystem and spawn no process.
3. Controlled MCP retrieval → allow **only** when the calling agent is one of
   four named agents *and* the tool is one of eight retrieval-only names. Both
   conditions, independently checked.
4. `Edit` / `Write` / `NotebookEdit` → allow only when every supplied path
   passes repository confinement and is not a protected surface.
5. Everything else → **deny**. Delegation tools, browser execution, scheduled
   tasks, other MCP servers, plugins, connectors, unknown and future names, and
   any malformed input.

### Path confinement is the part that took real work

Rule 4 is where a naive implementation quietly fails. Comparing a normalized
string against a root prefix looks sufficient and is not. The guard applies
**dual confinement** — the lexical path *and* the fully canonicalized path must
both resolve inside the repository, and neither may be a protected surface.

It also refuses several aliasing routes that a prefix check misses entirely:

- **Symlinks and outside aliases** that canonically resolve back inside — denied
  rather than allowed, because an approved-looking path reached by an unapproved
  route is not the approved path.
- **Hard links.** A hardlinked file can alias a protected file under a
  non-protected path, and its real path looks innocent. An existing file with
  suspicious link count fails closed.
- **NTFS alternate data streams** (`file.md:hidden`).
- **8.3 short-name segments** that cannot be expanded because the target does
  not exist.
- **Trailing dot or space** on a real segment — an OS-normalized alias for a
  different file than the string suggests.

Matching is exact `Set` identity throughout, so every near-miss falls to
default-deny: differing case, leading or trailing whitespace, prefixed or
suffixed names, Unicode-confusable and zero-width variants, and prototype-shaped
names like `__proto__`, `constructor`, or `toString`.

### It fails closed

Malformed JSON, a missing `tool_name`, a wrongly typed path field, or an
internal error all produce **deny**. A guard whose failure mode is "allow" is
not a guard — it is a guard-shaped availability risk, and the first thing an
attacker looks for is how to make it error.

---

## The tests are the point

A hook nobody exercised is a hypothesis.

[`test/governance-surface-hook.test.js`](test/governance-surface-hook.test.js)
spawns the real hook exactly as the runtime does — JSON on stdin, a decision on
stdout — rather than importing internals. A guard is worth what it does at its
actual interface.

```
✔ Bash is denied without inspecting the command
✔ read-only inspection tools are permitted
✔ allowlist membership is exact — every near-miss falls through to deny
✔ prototype-shaped names do not resolve through the prototype chain
✔ unknown and future tool names are denied by default
✔ delegation and execution tools are denied
✔ writes to protected governance surfaces are denied
✔ writes outside the repository root are denied
✔ a missing or wrongly typed path field is denied, not ignored
✔ an allowlisted MCP tool is permitted only for a pilot agent
✔ a pilot agent still cannot reach a mutating MCP tool
✔ MCP servers outside the pilot are denied entirely
✔ malformed input fails closed
✔ a missing or non-string tool_name fails closed
```

One test is platform-guarded and skips off Windows. A drive-letter path is
absolute on Windows and therefore outside the root; on POSIX the same string is
a legal *relative* filename inside the root, so permitting it there is correct
rather than a gap. Asserting the Windows result on Linux would encode a false
expectation — so the case is skipped rather than deleted or fudged.

**These tests found a real defect.** The live hook had four lines of unrelated
config text pasted onto the end and would not parse — meaning every protection
above had been silently inert. Hash verification had passed, because the file
was unmodified since its last recorded hash. *A hash proves a file is unchanged.
It does not prove it runs.* A `node --check` in the verification gate would have
caught it on day one; it is in the gate now.

---

## Design decisions worth arguing with

**The orchestrator cannot invoke anything.** It holds no `Task` or delegation
tool. It classifies work and recommends a chain; a human launches every agent
and transfers every handoff. Autonomous orchestration is off — not because
autonomy is wrong, but because an orchestrator that can invoke agents that can
write files is a single prompt away from an unbounded change, and nothing in the
chain is positioned to notice. The absence of the tool is the enforcement.

**No agent may certify its own work.** Implementation routes to independent
audit, then evidence collection, then an independent verdict. An implementer
reporting its own change as verified is the failure the whole chain exists to
prevent, and it is the one that feels most reasonable in the moment.

**No persistent agent memory.** Not during a pilot. Memory is state that
outlives review, and state that outlives review is where quietly-wrong
assumptions accumulate.

**Approval does not bypass the guard.** Twelve exact approval verbs, none
implying any other, all expiring when the diff changes — and none of them able
to unlock a protected surface. Governance-file edits are made by hand, outside
the agent write path. Policy that can be talked out of is not policy. The cost
is manual edits; that is the price of a boundary that does not negotiate, and it
holds even when the owner is the one who is mistaken.

**Retrieval is not verification.** Index output is indexed evidence. It does not
establish runtime, deployment, or production behaviour, and citing it as though
it does produces a confident false verification — worse than no verification,
because it closes the question.

---

## Honest scope

- **One operator, one application.** Not a multi-tenant or enterprise
  deployment, and untested at that scale.
- **The hooks are real and running**; they are the same files in use, sanitized
  for publication. The agent definitions here are written for this repository —
  representative of the structure and authority model, not copies of internal
  ones.
- **The real boundary is the hook plus whatever the runtime guarantees** — not
  the policy document. Layers of declared authority still depend on
  configuration being right and instructions being followed. Only the hook is
  enforced independently of what an agent was told. `GOVERNANCE.md` §14 says
  this plainly rather than burying it.
- **This is a guardrail layer, not a security product.** It constrains a
  cooperative agent operating on a local repository. It is not a sandbox, and it
  does not defend against a compromised runtime.

## Running it

```bash
git clone <this repo>
cd agent-governance
npm test
```

No dependencies. Node 18 or newer, using the built-in test runner.

## License

MIT — see [LICENSE](LICENSE).
