#!/usr/bin/env node
/**
 * Agent governance-surface protection (PreToolUse hook) — P0 Option A-hardened, v6.2.4.
 *
 * TOOL-LEVEL DEFAULT DENY. Every PreToolUse event is DENIED unless it matches one of the
 * explicit ALLOW rules below. Omission from any inventory never yields ALLOW.
 *
 *   1. tool_name === "Bash"                          -> DENY unconditionally (no inspection).
 *   2. tool_name in the CORE EXACT ALLOWLIST below   -> ALLOW.
 *   3. tool_name in the CONTROLLED MCP READ SET      -> ALLOW only when agent_type is one
 *      of the four exact pilot agents; otherwise DENY.
 *   4. tool_name in { Edit, Write, NotebookEdit }    -> ALLOW only when the tool_input and
 *      its path fields pass strict input typing AND EVERY supplied target passes repository
 *      write-confinement AND is not a protected surface; otherwise DENY.
 *   5. Every other tool_name — Agent/Task, computer-use, browser preview/exec, scheduled
 *      tasks, all other MCP tools, plugin tools, connectors, unknown or future names, and
 *      any malformed/non-string tool_name -> DENY by default.
 *
 * CORE EXACT ALLOWLIST (v6.2.3 retained). Exactly these tool names ALLOW. Membership is decided by
 * exact, case-sensitive string identity against a Set — never by prefix, suffix,
 * substring, normalization, trimming, or pattern:
 *
 *      Read  Grep  Glob                                  (read-only inspection)
 *      AskUserQuestion  EnterPlanMode  ExitPlanMode
 *      ToolSearch                                        (control-plane, added v6.2.2)
 *      TaskCreate  TaskUpdate  TaskGet  TaskList         (session task list, added v6.2.3)
 *
 * The control-plane names are permitted ONLY because they are intended as non-filesystem,
 * non-process-execution operations: they prompt the owner, enter or leave plan mode,
 * resolve deferred tool schemas, or maintain the session task list. They do not read or
 * write the filesystem, spawn a process, reach the network, or delegate work to another
 * executor. Skill is deliberately NOT allowlisted. Agent, Task, any other task-execution
 * tool, Bash, non-pilot MCP, plugin, connector, computer-use, browser execution,
 * scheduled-task, remote-trigger, unknown, and future tool names remain DENY.
 *
 * v6.2.3 CHANGE — STRUCTURED TASK-TOOL COMPATIBILITY. A disposable runtime test proved the
 * interactive runtime does not expose TodoWrite for task tracking; it exposes TaskCreate,
 * TaskUpdate, TaskGet, and TaskList, and the v6.2.2 hook correctly denied TaskCreate because
 * only TodoWrite was allowlisted. TodoWrite is therefore REMOVED from the allowlist and
 * returns to default-deny, and exactly those four names are added.
 *
 * These four are authorized ONLY as structured session task-list controls. The authorization
 * does NOT extend to background task execution, subagents, agent teams, workflows, or
 * scheduled execution. Task, TaskOutput, TaskStop, Agent, SendMessage, TeamCreate,
 * TeamDelete, Workflow, CronCreate/Delete/List, Monitor, RemoteTrigger, and ScheduleWakeup
 * are execution-capable and remain DENY.
 *
 * v6.2.4 CHANGE — CONTROLLED CODEBASE-MEMORY MCP RETRIEVAL PILOT. Exactly eight
 * retrieval-only codebase-memory-mcp tool names may DEFER only when payload.agent_type is
 * exactly one of: orchestrator, app-architect, task-planner, or
 * workflow-architect. Missing, malformed, differently cased, or non-pilot agent_type
 * values DENY. The authorization does not extend to detect_changes, query_graph,
 * index_repository, ingest_traces, manage_adr, delete_project, any other MCP server, n8n,
 * connectors, credentials, external actions, writes, indexing, or autonomous delegation.
 * Exact Set membership is required for both the tool name and agent type.
 *
 * Because matching is exact Set identity, every near-miss of an allowlisted name falls
 * through to the rule-4 default DENY: differing case, leading or trailing whitespace,
 * prefixed or suffixed names, Unicode-confusable or zero-width-injected variants, and
 * prototype-like names such as "__proto__", "constructor", or "toString" (a Set is keyed
 * by value and consults no prototype chain). Adding a name to this allowlist is the ONLY
 * way a tool becomes permitted.
 *
 * REPOSITORY WRITE CONFINEMENT (Edit/Write/NotebookEdit). A target ALLOWs only when ALL:
 *   (a) it is a valid, unambiguous path (no null byte, no URI/scheme, no percent-encoding,
 *       no UNC/administrative share, no extended-length/device prefix, no NTFS alternate
 *       data stream, no drive-relative "D:foo", no root-relative "\\foo"/"/foo", no
 *       trailing-dot/space segment, no unexpandable 8.3 short name);
 *   (b) it is LEXICALLY rooted inside the repository (path.relative from the repo root
 *       does not escape, component-aware — never substring/startsWith);
 *   (c) it CANONICALLY resolves inside the repository — the OS real path, or the real path
 *       of the nearest existing ancestor plus the normalized tail, is inside the repo;
 *   (d) it does not resolve through a symlink, junction, hardlink, reparse point, short
 *       name, or any alias into a protected surface;
 *   (e) it is not itself a protected surface.
 *   Both (b) AND (c) are required. An OUTSIDE-repository alias whose canonical destination
 *   points INTO the repository is DENIED — the approved write namespace is the repository's
 *   own canonical namespace, not any external alias to it. Every outside-repository target
 *   denies (existing or not; parent-relative; absolute; user-profile; temp; global git
 *   config; PowerShell profile; VS Code user config; global Claude config; other drive;
 *   UNC/admin share; in-repo link whose canonical destination is outside).
 *
 * PROTECTED SURFACES (at minimum): .git/**, .claude/** (governance docs, agent matrix,
 * agents, hooks, agent-backups, settings — the whole tree), CLAUDE.md, .gitignore,
 * .gitattributes.
 *
 * TIME-OF-CHECK / TIME-OF-USE (TOCTOU). This hook validates the path and the filesystem
 * state OBSERVED AT CHECK TIME. It cannot prevent a concurrent trusted or malicious
 * process from swapping a filesystem object (replacing a file, directory, symlink,
 * junction, or hardlink) in the interval between this validation and the subsequent file
 * operation performed by the tool. No claim is made that validation here guarantees the
 * bytes ultimately written land on the same object that was inspected.
 *
 * SCOPE. Governs ONLY tool calls that reach this PreToolUse boundary: Bash, the three file
 * tools, the core read-only allowlist, and the exact controlled MCP retrieval exception.
 * It does NOT vouch for GUI automation, browser dev-server execution, scheduled routines,
 * or any invocation path that bypasses PreToolUse. The controlled MCP exception is also
 * independently gated by project permissions, agent frontmatter, and the dedicated
 * enforce-controlled-mcp.js hook. Defense-in-depth, not a complete security boundary.
 *
 * Repository root derives SOLELY from this hook's installed location via __dirname, then is
 * canonicalized with the OS real path. No REPO_ROOT env, no process.cwd(), no override.
 *
 * STRICT INPUT TYPING (v6.2.1) for Edit / Write / NotebookEdit. Before any path reasoning
 * occurs, the request's tool_input must be a non-null, non-array, plain JSON object, and the
 * tool's required path field (file_path for Edit/Write, notebook_path for NotebookEdit) must
 * be an OWN property whose value is exactly a primitive string that is neither empty nor
 * whitespace-only. No value is ever coerced with String(...) — objects, arrays, numbers,
 * booleans, null, undefined, boxed String objects, and prototype-inherited values are DENIED
 * outright rather than stringified into a path. Any additionally supplied known path field is
 * held to the same standard and is still validated. This closes a coercion bypass in which a
 * non-string such as 123 or ["index.html"] was stringified into an apparently in-repo target.
 *
 * FAIL-CLOSED throughout: malformed/unparseable input, missing target, ambiguous target,
 * malformed input types, canonicalization failure, suspicious multi-link target, or internal
 * error -> DENY.
 */

'use strict';

const path = require('path');
const fs = require('fs');

/* Exact, case-sensitive tool-name allowlist — see EXACT ALLOWLIST in the header. Tested
 * with Set.prototype.has: exact value identity, no prototype-chain lookup, no coercion. */
const READ_ONLY_ALLOW = new Set([
  'Read', 'Grep', 'Glob',
  'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'ToolSearch',
  'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList',
]);

const CONTROLLED_MCP_AGENTS = new Set([
  'orchestrator',
  'app-architect',
  'task-planner',
  'workflow-architect',
]);

const CONTROLLED_MCP_READ = new Set([
  'mcp__codebase-memory-mcp__list_projects',
  'mcp__codebase-memory-mcp__index_status',
  'mcp__codebase-memory-mcp__get_architecture',
  'mcp__codebase-memory-mcp__get_graph_schema',
  'mcp__codebase-memory-mcp__search_code',
  'mcp__codebase-memory-mcp__search_graph',
  'mcp__codebase-memory-mcp__get_code_snippet',
  'mcp__codebase-memory-mcp__trace_path',
]);

const WRITE_FILE_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

const realpath = (fs.realpathSync && fs.realpathSync.native) ? fs.realpathSync.native : fs.realpathSync;

let REPO_ROOT_REAL = null;
try {
  REPO_ROOT_REAL = realpath(path.resolve(__dirname, '../../'));
} catch {
  REPO_ROOT_REAL = null;
}

function deny(reason) { return { decision: 'deny', reason }; }
const DEFER = { decision: 'defer' };

/* ------------------------------------------------------------------ *
 * Canonical path validation (Edit / Write / NotebookEdit targets)
 * ------------------------------------------------------------------ */

function stripQuotes(value) {
  const t = String(value == null ? '' : value).trim();
  if (t.length >= 2) {
    const a = t[0];
    const z = t[t.length - 1];
    if ((a === '"' && z === '"') || (a === "'" && z === "'") || (a === '`' && z === '`')) {
      return t.slice(1, -1);
    }
  }
  return t;
}

/** A ':' that is not the drive-letter colon indicates an NTFS alternate data stream. */
function hasAdsColon(s) {
  return s.replace(/^[A-Za-z]:/, '').includes(':');
}

/** 8.3 short-name-looking segment, e.g. CLAUDE~1.MD. */
function hasShortNameSegment(s) {
  return /(^|[\\/])[^\\/]*~\d/.test(s);
}

/** Canonicalize an absolute path. Existing -> OS real path. Nonexistent -> real path of
 *  the nearest existing ancestor plus the remaining tail. Returns null on any non-ENOENT
 *  failure or if no existing ancestor is found. */
function canonicalize(abs) {
  try {
    return realpath(abs);
  } catch (e) {
    if (!e || e.code !== 'ENOENT') return null;
  }
  let cur = abs;
  const tail = [];
  for (;;) {
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    tail.unshift(path.basename(cur));
    cur = parent;
    try {
      const realParent = realpath(cur);
      return path.join(realParent, ...tail);
    } catch (e2) {
      if (!e2 || e2.code !== 'ENOENT') return null;
    }
  }
}

/**
 * Component-aware classification of a resolved absolute path against the repo root.
 * Returns 'protected', 'outside', or 'inside-ok'. Uses path.relative (never substring /
 * startsWith) for containment.
 */
function classifyResolved(resolvedAbs) {
  const rel = path.relative(REPO_ROOT_REAL, resolvedAbs);
  if (rel === '') return 'inside-ok'; // repo root itself (not a protected file)
  const firstComp = rel.split(/[\\/]/)[0];
  if (path.isAbsolute(rel) || firstComp === '..') return 'outside';
  const first = firstComp.toLowerCase();
  if (first === '.git' || first === '.claude') return 'protected';
  const relLow = rel.replace(/\\/g, '/').toLowerCase();
  if (relLow === 'claude.md' || relLow === '.gitignore' || relLow === '.gitattributes') return 'protected';
  return 'inside-ok';
}

/** Decide a single target: 'deny' or 'allow'. Denies conservatively — any form that
 *  cannot be conclusively proven both lexically and canonically inside the repository and
 *  non-protected is denied. */
function decideTarget(rawValue) {
  if (REPO_ROOT_REAL === null) return 'deny';

  const original = String(rawValue == null ? '' : rawValue);
  if (original.indexOf('\0') !== -1) return 'deny';        // null byte
  const s = stripQuotes(original);
  if (s === '') return 'deny';                             // empty / missing

  // Ambiguous or non-canonicalizable forms -> deny (never an ALLOW limitation).
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return 'deny';   // scheme:// (file://, etc.)
  if (/%[0-9a-fA-F]{2}/.test(s)) return 'deny';                 // percent-encoded / URI-like
  if (/^\\\\[?.]\\/.test(s)) return 'deny';                     // extended-length \\?\ / device \\.\
  if (/^(\\\\|\/\/)/.test(s)) return 'deny';                    // UNC / administrative share
  if (/^[A-Za-z]:(?![\\/])/.test(s)) return 'deny';            // drive-relative  D:relative-path
  if (/^[\\/](?![\\/])/.test(s)) return 'deny';                // root-relative   \path or /path
  if (hasAdsColon(s)) return 'deny';                            // NTFS alternate data stream

  // Trailing dot/space on a real segment is an OS-normalized alias -> deny.
  for (const seg of s.split(/[\\/]/)) {
    if (seg !== '' && seg !== '.' && seg !== '..' && /[ .]$/.test(seg)) return 'deny';
  }

  let abs;
  try {
    abs = path.isAbsolute(s) ? path.resolve(s) : path.resolve(REPO_ROOT_REAL, s);
  } catch {
    return 'deny';
  }

  // 8.3 short-name segment that cannot be expanded (target does not exist) -> deny.
  if (hasShortNameSegment(s)) {
    let existsAsGiven = false;
    try { existsAsGiven = fs.existsSync(abs); } catch { existsAsGiven = false; }
    if (!existsAsGiven) return 'deny';
  }

  const canon = canonicalize(abs);
  if (canon === null) return 'deny';

  // Suspicious multi-link (hardlink) existing file -> fail closed: a hardlink can alias a
  // protected file under a non-protected path, invisible to its real path.
  try {
    const st = fs.lstatSync(canon);
    if (st.isFile() && typeof st.nlink === 'number' && st.nlink > 1) return 'deny';
  } catch (e) {
    if (!e || e.code !== 'ENOENT') return 'deny'; // ENOENT = nonexistent -> no hardlink; continue
  }

  // DUAL CONFINEMENT: the lexical path AND the canonical path must BOTH be inside the repo
  // and neither may be a protected surface. Outside -> deny (even an outside alias that
  // canonically points back in). Protected (lexical or canonical/alias) -> deny.
  const lex = classifyResolved(abs);
  const can = classifyResolved(canon);
  if (lex !== 'inside-ok') return 'deny';
  if (can !== 'inside-ok') return 'deny';
  return 'allow';
}

/* ------------------------------------------------------------------ *
 * Strict input typing (Edit / Write / NotebookEdit tool_input)
 * ------------------------------------------------------------------ */

/** The path field each write-capable file tool is REQUIRED to supply. */
const REQUIRED_PATH_FIELD = new Map([
  ['Edit', 'file_path'],
  ['Write', 'file_path'],
  ['NotebookEdit', 'notebook_path'],
]);

/** Every path-bearing field this hook knows how to validate. */
const KNOWN_PATH_FIELDS = ['file_path', 'notebook_path'];

function hasOwn(obj, key) { return Object.prototype.hasOwnProperty.call(obj, key); }

/** A non-null, non-array object whose prototype is Object.prototype or null — i.e. what
 *  JSON.parse produces for an object literal. Anything else fails closed. */
function isPlainJsonObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** Human-readable type label used only in DENY reasons. */
function describeType(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'object') return 'an object';
  return `a ${typeof v}`;
}

/** Strictly read one path field. NEVER coerces: the value must be an OWN property whose
 *  type is exactly "string" and which is neither empty nor whitespace-only. A boxed
 *  String object has typeof "object" and is therefore rejected. Returns
 *  { ok: true, value } or { ok: false, reason }. */
function readPathField(input, field) {
  if (!hasOwn(input, field)) {
    return { ok: false, reason: `has no own "${field}" property` };
  }
  const value = input[field];
  if (typeof value !== 'string') {
    return { ok: false, reason: `supplied "${field}" as ${describeType(value)} rather than a string` };
  }
  if (value.trim() === '') {
    return { ok: false, reason: `supplied an empty or whitespace-only "${field}"` };
  }
  return { ok: true, value };
}

/* ------------------------------------------------------------------ *
 * Decision
 * ------------------------------------------------------------------ */

function decide(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return deny('hook payload was not a JSON object — failing closed.');
  }
  const tool = payload.tool_name;
  if (typeof tool !== 'string' || tool === '') {
    return deny('hook payload had a missing, null, or non-string tool_name — failing closed.');
  }

  if (tool === 'Bash') {
    return deny(
      'The Bash tool is disabled for the agent tool path under the P0 posture. All shell, '
      + 'git, build, package-manager, and script actions are owner-performed in the VS Code '
      + 'integrated PowerShell terminal.',
    );
  }

  if (CONTROLLED_MCP_READ.has(tool)) {
    const agentType = payload.agent_type;
    if (typeof agentType !== 'string' || !CONTROLLED_MCP_AGENTS.has(agentType)) {
      return deny(
        `Controlled MCP retrieval tool "${tool}" was requested without an exact approved `
        + 'pilot agent_type. Main-session, missing, malformed, and non-pilot agent contexts '
        + 'remain BLOCKED under P0 default-deny.',
      );
    }
    return DEFER;
  }

  if (WRITE_FILE_TOOLS.has(tool)) {
    const input = payload.tool_input;
    if (!isPlainJsonObject(input)) {
      return deny(
        `${tool} request supplied ${describeType(input)} as tool_input rather than a plain JSON `
        + 'object — failing closed.',
      );
    }

    // The tool's own required path field must be present as an own, non-blank string.
    const required = REQUIRED_PATH_FIELD.get(tool);
    const requiredField = readPathField(input, required);
    if (!requiredField.ok) {
      return deny(
        `${tool} request ${requiredField.reason}. Its required target path must be an own `
        + 'property holding a non-empty string; no other value is coerced into a path. '
        + 'Failing closed.',
      );
    }
    const candidates = [requiredField.value];

    // Any additionally supplied known path field is held to the same standard and is still
    // subject to full confinement and protected-surface validation below.
    for (const field of KNOWN_PATH_FIELDS) {
      if (field === required || !hasOwn(input, field)) continue;
      const extraField = readPathField(input, field);
      if (!extraField.ok) {
        return deny(
          `${tool} request ${extraField.reason}. Every supplied target path must be an own `
          + 'property holding a non-empty string; no other value is coerced into a path. '
          + 'Failing closed.',
        );
      }
      candidates.push(extraField.value);
    }
    for (const value of candidates) {
      if (decideTarget(value) === 'deny') {
        return deny(
          `${tool} targets a protected surface, an outside-repository path, or a path that `
          + 'cannot be proven both lexically and canonically inside the repository. BLOCKED. '
          + 'Writes are confined to the repository\'s own canonical namespace; protected-surface '
          + 'and out-of-repo changes are owner-performed outside the agent tool path.',
        );
      }
    }
    return DEFER;
  }

  if (READ_ONLY_ALLOW.has(tool)) {
    return DEFER;
  }

  return deny(
    `Tool "${tool}" is not on the P0 read-only allowlist and is not a path-gated file tool. `
    + 'Under tool-level default-deny it is BLOCKED.',
  );
}

/* ------------------------------------------------------------------ *
 * I/O — fail-closed
 * ------------------------------------------------------------------ */

function emit(result) {
  if (!result || result.decision === 'defer') {
    process.exit(0);
  }
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `[governance guard] ${result.reason}`,
    },
  }));
  process.exit(0);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    process.stderr.write('[governance guard] malformed hook input; denying (fail-closed).\n');
    emit(deny('hook input was not valid JSON — failing closed.'));
    return;
  }
  try {
    emit(decide(payload));
  } catch (err) {
    process.stderr.write(`[governance guard] internal error; denying (fail-closed): ${err && err.message}\n`);
    emit(deny(`internal hook error — failing closed: ${err && err.message}`));
  }
});
