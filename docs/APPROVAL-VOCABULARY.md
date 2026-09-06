# Approval vocabulary

Approval is granted in exact verbs. This list is the authoritative vocabulary;
nothing outside it grants authority.

| Verb | Authorizes |
|---|---|
| `APPROVED TO ANALYZE` | Read-only inspection and evidence gathering |
| `APPROVED TO PLAN` | Producing a plan or task decomposition — no edits |
| `APPROVED TO EDIT` | Modifying files within the exact approved scope |
| `APPROVED TO STAGE` | `git add` of the exact approved files only |
| `APPROVED TO COMMIT` | Creating a commit from the already-staged approved diff |
| `APPROVED TO PUSH` | Pushing the approved commit to the remote |
| `APPROVED TO OPEN DRAFT PR` | Opening a pull request in draft state |
| `APPROVED TO MARK READY` | Moving a draft pull request to ready-for-review |
| `APPROVED TO MERGE` | Merging the pull request |
| `APPROVED TO VERIFY PRODUCTION` | Performing production verification steps |
| `APPROVED TO CLEAN UP BRANCH` | Deleting the local and/or remote feature branch |
| `APPROVED TO MODIFY AGENTS` | Changing agent definitions or governance surfaces |

Twelve verbs where most systems have one. The granularity is the point: "yes"
is not a unit of authorization, because the thing being authorized varies by
three orders of magnitude in consequence.

---

## Rule 1 — Non-inference

**Each approval authorizes only the named verb, for the exact approved scope,
current diff, and current session. No approval implies any later approval.**

Approval to edit is not approval to stage. Approval to stage is not approval to
commit. Approval to commit is not approval to push. Approval to merge is not
approval to verify production or clean up a branch.

Each verb is granted explicitly and separately.

This exists because the natural failure mode of a capable assistant is
*helpfulness cascade*: having been approved to fix something, it stages it;
having staged it, it commits; having committed, it pushes — each step locally
reasonable, the sequence never authorized. Every arrow in that chain is a
separate decision with a different blast radius, and treating them as one
decision means the smallest approval silently carries the largest consequence.

## Rule 2 — Expiry

An approval expires immediately when any of these occurs:

- the approved scope changes
- the diff materially changes
- an unapproved file becomes involved
- the repository state changes unexpectedly
- the session ends
- the owner revokes or replaces the approval

When an approval expires, stop and request it again. Do not proceed on a stale
approval.

The diff clause is the one that earns its place. Approval was given for what was
reviewed. If the content changed afterward, the approval refers to something
that no longer exists — and an approval carried forward onto different content
is indistinguishable from no approval at all.

## Rule 3 — Ambiguity is not approval

**Ambiguous wording must not be interpreted as approval.**

"Looks good", "go ahead", "sounds right", "ok", a thumbs up, and silence are
**not** approval verbs. If intent is not expressed as one of the exact verbs
above, ask for the explicit verb before acting.

This is deliberately inconvenient. Conversational agreement is exactly how
people signal approval in practice, and treating it as authorization is exactly
how unintended actions happen — the person meant "I follow your reasoning" and
the system heard "execute". Requiring an unnatural phrase makes authorization a
conscious act rather than a conversational reflex.

## Rule 4 — Approval does not bypass the hook

Approval authorizes the **owner** to proceed within the approved scope. It is a
governance decision, not a technical override.

No approval phrase, prompt response, or agent-session state bypasses the
PreToolUse hook. Changes to `.claude/**`, `CLAUDE.md`, `.gitignore`,
`.gitattributes`, or `.git/**` are made manually by the owner, outside the agent
write path. No autonomous protected-surface edit path exists.

This is the rule that makes the other three more than etiquette.

Policy that can be talked out of is not policy. If a sufficiently confident
instruction — from the owner, from a prompt, from text encountered in a file —
could unlock the protected surface, then the protection is advisory and its real
strength is whatever the model happened to conclude that day. Separating *who
may decide* from *what the process can do* means the guard holds even when the
conversation goes wrong, and even when the owner is the one who is mistaken.

The practical cost is real: the owner edits governance files by hand. That is
the price of a boundary that does not negotiate, and it is worth paying.
