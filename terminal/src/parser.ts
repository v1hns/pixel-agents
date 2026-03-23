/**
 * Adapted from ../src/transcriptParser.ts + ../src/timerManager.ts
 *
 * Original logic is unchanged — VS Code's `vscode.Webview.postMessage` calls
 * are replaced with a generic `Callback` function so this module can run
 * outside of VS Code without any extension host dependency.
 */

import * as path from 'path';
import type { AgentState } from './types';

const BASH_COMMAND_DISPLAY_MAX_LENGTH = 30;
const TASK_DESCRIPTION_DISPLAY_MAX_LENGTH = 40;
const TEXT_IDLE_DELAY_MS = 5000;
const TOOL_DONE_DELAY_MS = 300;
const PERMISSION_TIMER_DELAY_MS = 7000;

export const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'Agent', 'AskUserQuestion']);

type Callback = (id: number, type: string, data?: Record<string, unknown>) => void;

export function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case 'Read':      return `Reading ${base(input.file_path)}`;
    case 'Edit':      return `Editing ${base(input.file_path)}`;
    case 'Write':     return `Writing ${base(input.file_path)}`;
    case 'Bash': {
      const cmd = (input.command as string) || '';
      return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '...' : cmd}`;
    }
    case 'Glob':          return 'Searching files';
    case 'Grep':          return 'Searching code';
    case 'WebFetch':      return 'Fetching web content';
    case 'WebSearch':     return 'Searching the web';
    case 'Task':
    case 'Agent': {
      const desc = typeof input.description === 'string' ? input.description : '';
      return desc
        ? `Subtask: ${desc.length > TASK_DESCRIPTION_DISPLAY_MAX_LENGTH ? desc.slice(0, TASK_DESCRIPTION_DISPLAY_MAX_LENGTH) + '...' : desc}`
        : 'Running subtask';
    }
    case 'AskUserQuestion': return 'Waiting for your answer';
    case 'EnterPlanMode':   return 'Planning';
    case 'NotebookEdit':    return 'Editing notebook';
    default:                return `Using ${toolName}`;
  }
}

// ─── Timer helpers ────────────────────────────────────────────────────────────

export function cancelWaitingTimer(agentId: number, waitingTimers: Map<number, ReturnType<typeof setTimeout>>): void {
  const t = waitingTimers.get(agentId);
  if (t) { clearTimeout(t); waitingTimers.delete(agentId); }
}

export function cancelPermissionTimer(agentId: number, permissionTimers: Map<number, ReturnType<typeof setTimeout>>): void {
  const t = permissionTimers.get(agentId);
  if (t) { clearTimeout(t); permissionTimers.delete(agentId); }
}

export function startWaitingTimer(
  agentId: number,
  delayMs: number,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  cb: Callback,
): void {
  cancelWaitingTimer(agentId, waitingTimers);
  const t = setTimeout(() => {
    waitingTimers.delete(agentId);
    const agent = agents.get(agentId);
    if (agent) { agent.isWaiting = true; agent.status = 'waiting'; }
    cb(agentId, 'agentStatus', { status: 'waiting' });
  }, delayMs);
  waitingTimers.set(agentId, t);
}

export function startPermissionTimer(
  agentId: number,
  agents: Map<number, AgentState>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  cb: Callback,
): void {
  cancelPermissionTimer(agentId, permissionTimers);
  const t = setTimeout(() => {
    permissionTimers.delete(agentId);
    const agent = agents.get(agentId);
    if (!agent) return;
    let hasNonExempt = false;
    for (const toolId of agent.activeToolIds) {
      if (!PERMISSION_EXEMPT_TOOLS.has(agent.activeToolNames.get(toolId) || '')) {
        hasNonExempt = true; break;
      }
    }
    if (hasNonExempt) {
      agent.permissionSent = true;
      agent.status = 'permission';
      cb(agentId, 'agentToolPermission', {});
    }
  }, PERMISSION_TIMER_DELAY_MS);
  permissionTimers.set(agentId, t);
}

export function clearAgentActivity(
  agent: AgentState,
  agentId: number,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  cb: Callback,
): void {
  agent.activeToolIds.clear();
  agent.activeToolStatuses.clear();
  agent.activeToolNames.clear();
  agent.activeSubagentToolIds.clear();
  agent.activeSubagentToolNames.clear();
  agent.isWaiting = false;
  agent.permissionSent = false;
  agent.status = 'active';
  agent.currentActivity = 'Working...';
  cancelPermissionTimer(agentId, permissionTimers);
  cb(agentId, 'agentToolsClear', {});
}

// ─── Main transcript line processor ──────────────────────────────────────────

export function processTranscriptLine(
  agentId: number,
  line: string,
  agents: Map<number, AgentState>,
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
  cb: Callback,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;
  try {
    const record = JSON.parse(line);
    agent.lastActivity = Date.now();

    if (record.type === 'assistant' && Array.isArray(record.message?.content)) {
      const blocks = record.message.content as Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown> }>;
      const hasToolUse = blocks.some((b) => b.type === 'tool_use');

      if (hasToolUse) {
        cancelWaitingTimer(agentId, waitingTimers);
        agent.isWaiting = false;
        agent.hadToolsInTurn = true;
        agent.status = 'active';
        let hasNonExempt = false;
        for (const block of blocks) {
          if (block.type === 'tool_use' && block.id) {
            const toolName = block.name || '';
            const status = formatToolStatus(toolName, block.input || {});
            agent.activeToolIds.add(block.id);
            agent.activeToolStatuses.set(block.id, status);
            agent.activeToolNames.set(block.id, toolName);
            agent.currentActivity = status;
            if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) hasNonExempt = true;
            cb(agentId, 'agentToolStart', { toolId: block.id, status });
          }
        }
        if (hasNonExempt) startPermissionTimer(agentId, agents, permissionTimers, cb);
        cb(agentId, 'agentStatus', { status: 'active' });

      } else if (blocks.some((b) => b.type === 'text') && !agent.hadToolsInTurn) {
        startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, cb);
      }

    } else if (record.type === 'progress') {
      // bash/mcp progress restarts permission timer
      const parentToolId = record.parentToolUseID as string | undefined;
      const data = record.data as Record<string, unknown> | undefined;
      const dataType = data?.type as string | undefined;
      if ((dataType === 'bash_progress' || dataType === 'mcp_progress') && parentToolId) {
        if (agent.activeToolIds.has(parentToolId)) {
          startPermissionTimer(agentId, agents, permissionTimers, cb);
        }
      }

    } else if (record.type === 'user') {
      const content = record.message?.content;
      if (Array.isArray(content)) {
        const blocks = content as Array<{ type: string; tool_use_id?: string }>;
        const hasToolResult = blocks.some((b) => b.type === 'tool_result');
        if (hasToolResult) {
          for (const block of blocks) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              const completedId = block.tool_use_id;
              agent.activeToolIds.delete(completedId);
              agent.activeToolStatuses.delete(completedId);
              agent.activeToolNames.delete(completedId);
              if (agent.activeToolIds.size === 0) {
                agent.hadToolsInTurn = false;
                agent.currentActivity = 'Working...';
              } else {
                // update activity to most recent remaining tool
                const remaining = [...agent.activeToolStatuses.values()];
                if (remaining.length) agent.currentActivity = remaining[remaining.length - 1];
              }
              const tid = completedId;
              setTimeout(() => cb(agentId, 'agentToolDone', { toolId: tid }), TOOL_DONE_DELAY_MS);
            }
          }
        } else {
          cancelWaitingTimer(agentId, waitingTimers);
          clearAgentActivity(agent, agentId, permissionTimers, cb);
          agent.hadToolsInTurn = false;
        }
      } else if (typeof content === 'string' && content.trim()) {
        cancelWaitingTimer(agentId, waitingTimers);
        clearAgentActivity(agent, agentId, permissionTimers, cb);
        agent.hadToolsInTurn = false;
      }

    } else if (record.type === 'system' && record.subtype === 'turn_duration') {
      cancelWaitingTimer(agentId, waitingTimers);
      cancelPermissionTimer(agentId, permissionTimers);
      agent.activeToolIds.clear();
      agent.activeToolStatuses.clear();
      agent.activeToolNames.clear();
      agent.isWaiting = true;
      agent.permissionSent = false;
      agent.hadToolsInTurn = false;
      agent.status = 'waiting';
      agent.currentActivity = 'Waiting for input...';
      cb(agentId, 'agentStatus', { status: 'waiting' });
    }
  } catch {
    // malformed line
  }
}
