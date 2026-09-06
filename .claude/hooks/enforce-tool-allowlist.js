"use strict";

const fs = require("fs");

const PILOT_AGENTS = new Set([
  "orchestrator",
  "app-architect",
  "task-planner",
  "workflow-architect",
]);

const ALLOWED_TOOLS = new Set([
  "mcp__codebase-memory-mcp__list_projects",
  "mcp__codebase-memory-mcp__index_status",
  "mcp__codebase-memory-mcp__get_architecture",
  "mcp__codebase-memory-mcp__get_graph_schema",
  "mcp__codebase-memory-mcp__search_code",
  "mcp__codebase-memory-mcp__search_graph",
  "mcp__codebase-memory-mcp__get_code_snippet",
  "mcp__codebase-memory-mcp__trace_path",
]);

function respond(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    })
  );
}

try {
  const raw = fs.readFileSync(0, "utf8");
  const input = JSON.parse(raw);
  const agentType = String(input.agent_type || "");
  const toolName = String(input.tool_name || "");

  if (!PILOT_AGENTS.has(agentType)) {
    respond(
      "deny",
      "Controlled MCP policy: this agent is not in the four-agent retrieval pilot."
    );
    process.exit(0);
  }

  if (!ALLOWED_TOOLS.has(toolName)) {
    respond(
      "deny",
      "Controlled MCP policy: this tool is not in the retrieval-only allowlist."
    );
    process.exit(0);
  }

  respond(
    "allow",
    "Controlled MCP policy: approved retrieval-only tool for the active pilot agent."
  );
} catch (error) {
  respond(
    "deny",
    "Controlled MCP policy failed closed because hook input could not be validated."
  );
}
