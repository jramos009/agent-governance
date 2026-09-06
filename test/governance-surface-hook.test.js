'use strict';
/**
 * Behavioural tests for the governance-surface PreToolUse hook.
 *
 * These spawn the hook exactly as an agent runtime does — JSON on stdin, a
 * permission decision on stdout — rather than importing internals. A guard is
 * only worth what it does at its real interface, so that is what is tested.
 *
 * Convention: the hook emits nothing when it defers, meaning the tool is
 * permitted and the decision passes to the normal permission system.
 * Silence is allow; anything else is an explicit decision.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const HOOK = path.join(__dirname, '..', '.claude', 'hooks', 'protect-governance-surfaces.js');

/** @returns {'deny'|'allow'|'defer'} */
function decide(payload) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: 'utf8' });
  const out = (r.stdout || '').trim();
  if (!out) return 'defer';
  return JSON.parse(out).hookSpecificOutput.permissionDecision;
}

// --- Rule 1: Bash is denied unconditionally --------------------------------

test('Bash is denied without inspecting the command', () => {
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'echo hello' } }), 'deny');
  assert.equal(decide({ tool_name: 'Bash', tool_input: { command: 'rm -rf /' } }), 'deny');
});

// --- Rule 2: the exact read-only allowlist ---------------------------------

test('read-only inspection tools are permitted', () => {
  for (const tool_name of ['Read', 'Grep', 'Glob']) {
    assert.equal(decide({ tool_name, tool_input: { file_path: 'README.md' } }), 'defer', tool_name);
  }
});

test('allowlist membership is exact — every near-miss falls through to deny', () => {
  for (const tool_name of ['read', 'READ', ' Read', 'Read ', 'ReadFile', 'XRead']) {
    assert.equal(decide({ tool_name, tool_input: {} }), 'deny', JSON.stringify(tool_name));
  }
});

test('prototype-shaped names do not resolve through the prototype chain', () => {
  for (const tool_name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.equal(decide({ tool_name, tool_input: {} }), 'deny', tool_name);
  }
});

// --- Rule 5: default deny --------------------------------------------------

test('unknown and future tool names are denied by default', () => {
  for (const tool_name of ['SomeFutureTool', 'WebFetch', 'WebSearch', 'computer', 'Skill']) {
    assert.equal(decide({ tool_name, tool_input: {} }), 'deny', tool_name);
  }
});

test('delegation and execution tools are denied', () => {
  for (const tool_name of ['Task', 'Agent', 'TaskStop', 'SendMessage']) {
    assert.equal(decide({ tool_name, tool_input: {} }), 'deny', tool_name);
  }
});

// --- Rule 4: write confinement and protected surfaces ----------------------

test('writes to protected governance surfaces are denied', () => {
  const targets = [
    '.claude/agents/orchestrator.md',
    '.claude/settings.local.json',
    'CLAUDE.md',
    '.gitignore',
    '.gitattributes',
    '.git/config',
  ];
  for (const file_path of targets) {
    assert.equal(decide({ tool_name: 'Write', tool_input: { file_path } }), 'deny', `Write ${file_path}`);
    assert.equal(decide({ tool_name: 'Edit', tool_input: { file_path } }), 'deny', `Edit ${file_path}`);
  }
});

test('writes outside the repository root are denied', () => {
  const targets = ['/etc/passwd', '../outside.txt', '../../escape.md'];
  for (const file_path of targets) {
    assert.equal(decide({ tool_name: 'Write', tool_input: { file_path } }), 'deny', file_path);
  }
});

// Platform-specific by necessity, not by oversight. A drive-letter path is
// absolute on Windows and therefore outside the repository root; on POSIX the
// same string is a legal *relative* filename inside the root, so permitting it
// there is correct behaviour rather than a gap. Asserting the Windows result on
// Linux would encode a false expectation, so the case is guarded instead.
test('drive-letter absolute paths are denied on Windows', { skip: process.platform !== 'win32' }, () => {
  const targets = [
    'C:\\Windows\\System32\\drivers\\etc\\hosts',
    'C:/Windows/System32/drivers/etc/hosts',
    '\\\\server\\share\\file.txt',
  ];
  for (const file_path of targets) {
    assert.equal(decide({ tool_name: 'Write', tool_input: { file_path } }), 'deny', file_path);
  }
});

test('a missing or wrongly typed path field is denied, not ignored', () => {
  assert.equal(decide({ tool_name: 'Write', tool_input: {} }), 'deny');
  assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: null } }), 'deny');
  assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: 42 } }), 'deny');
  assert.equal(decide({ tool_name: 'Write', tool_input: { file_path: ['a'] } }), 'deny');
  assert.equal(decide({ tool_name: 'Write', tool_input: 'not-an-object' }), 'deny');
});

// --- Rule 3: the controlled MCP retrieval pilot ----------------------------

test('an allowlisted MCP tool is permitted only for a pilot agent', () => {
  const tool_name = 'mcp__codebase-memory-mcp__search_code';
  assert.equal(decide({ tool_name, agent_type: 'orchestrator', tool_input: {} }), 'defer');
  assert.equal(decide({ tool_name, agent_type: 'security-code-auditor', tool_input: {} }), 'deny');
  assert.equal(decide({ tool_name, tool_input: {} }), 'deny');
  assert.equal(decide({ tool_name, agent_type: 'Orchestrator', tool_input: {} }), 'deny');
});

test('a pilot agent still cannot reach a mutating MCP tool', () => {
  for (const t of ['delete_project', 'index_repository', 'ingest_traces', 'manage_adr']) {
    assert.equal(
      decide({ tool_name: `mcp__codebase-memory-mcp__${t}`, agent_type: 'orchestrator', tool_input: {} }),
      'deny', t,
    );
  }
});

test('MCP servers outside the pilot are denied entirely', () => {
  assert.equal(
    decide({ tool_name: 'mcp__some-other-server__read', agent_type: 'orchestrator', tool_input: {} }),
    'deny',
  );
});

// --- Fail-closed behaviour -------------------------------------------------

test('malformed input fails closed', () => {
  for (const raw of ['this is not json', '', '[]', 'null']) {
    assert.equal(decide(raw), 'deny', JSON.stringify(raw));
  }
});

test('a missing or non-string tool_name fails closed', () => {
  assert.equal(decide({ tool_input: {} }), 'deny');
  assert.equal(decide({ tool_name: 123, tool_input: {} }), 'deny');
  assert.equal(decide({ tool_name: null, tool_input: {} }), 'deny');
});
