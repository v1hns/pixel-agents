/**
 * Extends ../src/fileWatcher.ts + ../src/agentManager.ts
 *
 * Where the VS Code extension monitors a single workspace project directory,
 * this module scans ALL directories under ~/.claude/projects/ so every
 * concurrent `claude` terminal instance is picked up automatically — no VS
 * Code or workspace context required.
 *
 * File-watching strategy (fs.watch + polling) is identical to the original.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EventEmitter } from 'events';
import {
  processTranscriptLine,
  cancelWaitingTimer,
  cancelPermissionTimer,
} from './parser';
import type { AgentState } from './types';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const SCAN_INTERVAL_MS = 2000;
const FILE_POLL_INTERVAL_MS = 1000;
// Sessions modified within last 2 hours are considered active
const SESSION_ACTIVE_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * Decode a Claude Code project directory name back to a human-readable project name.
 * Claude encodes: workspacePath.replace(/[^a-zA-Z0-9-]/g, '-')
 * e.g. '-Users-vihaanshringi-my-project' -> 'my-project'
 */
function decodeProjectName(encoded: string): string {
  // Strip leading dash
  const s = encoded.replace(/^-+/, '');
  // Pattern: home dir + username + project path
  // e.g. 'Users-username-path-to-project' -> take everything after 'Users-{name}-'
  const m = s.match(/^[A-Za-z]+?-[^-]+?-(.+)$/);
  if (m) return m[1];
  return s || encoded;
}

export class AgentMonitor extends EventEmitter {
  private agents = new Map<string, AgentState>(); // key: jsonlFile
  private agentById = new Map<number, AgentState>(); // key: agent.id
  private idCounter = 1;
  private pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  private waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
  private scanTimer?: ReturnType<typeof setInterval>;

  start(): void {
    this.scan();
    this.scanTimer = setInterval(() => this.scan(), SCAN_INTERVAL_MS);
  }

  stop(): void {
    if (this.scanTimer) clearInterval(this.scanTimer);
    for (const t of this.pollingTimers.values()) clearInterval(t);
    for (const t of this.waitingTimers.values()) clearTimeout(t);
    for (const t of this.permissionTimers.values()) clearTimeout(t);
  }

  getAgents(): AgentState[] {
    return Array.from(this.agents.values()).sort((a, b) => a.id - b.id);
  }

  private scan(): void {
    if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return;

    let projectDirs: string[];
    try {
      projectDirs = fs
        .readdirSync(CLAUDE_PROJECTS_DIR, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => path.join(CLAUDE_PROJECTS_DIR, d.name));
    } catch {
      return;
    }

    const now = Date.now();
    const activeFiles = new Set<string>();

    for (const projectDir of projectDirs) {
      try {
        const files = fs
          .readdirSync(projectDir)
          .filter((f) => f.endsWith('.jsonl'))
          .map((f) => path.join(projectDir, f))
          .filter((f) => {
            try {
              const stat = fs.statSync(f);
              return now - stat.mtimeMs < SESSION_ACTIVE_WINDOW_MS;
            } catch {
              return false;
            }
          });
        for (const f of files) activeFiles.add(f);
      } catch {
        // skip unreadable dirs
      }
    }

    // Add newly discovered agents
    for (const file of activeFiles) {
      if (!this.agents.has(file)) this.createAgent(file);
    }

    // Remove agents whose files fell outside the activity window
    for (const [file, agent] of this.agents) {
      if (!activeFiles.has(file)) this.removeAgent(agent.id);
    }
  }

  private createAgent(jsonlFile: string): void {
    const projectDir = path.dirname(jsonlFile);
    const projectName = decodeProjectName(path.basename(projectDir));
    const id = this.idCounter++;
    const agent: AgentState = {
      id,
      projectDir,
      projectName,
      jsonlFile,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      status: 'idle',
      currentActivity: 'Idle',
      paletteIndex: (id - 1) % 6,
      lastActivity: Date.now(),
    };

    // Start reading from current end of file — only react to NEW lines
    try {
      const stat = fs.statSync(jsonlFile);
      agent.fileOffset = stat.size;
    } catch { /* ignore */ }

    this.agents.set(jsonlFile, agent);
    this.agentById.set(id, agent);
    this.emit('agentCreated', agent);
    this.startPolling(agent);
  }

  private removeAgent(agentId: number): void {
    const agent = this.agentById.get(agentId);
    if (!agent) return;

    const t = this.pollingTimers.get(agentId);
    if (t) clearInterval(t);
    this.pollingTimers.delete(agentId);

    try { fs.unwatchFile(agent.jsonlFile); } catch { /* ignore */ }

    cancelWaitingTimer(agentId, this.waitingTimers);
    cancelPermissionTimer(agentId, this.permissionTimers);

    this.agents.delete(agent.jsonlFile);
    this.agentById.delete(agentId);
    this.emit('agentRemoved', agentId);
  }

  private startPolling(agent: AgentState): void {
    const { id } = agent;

    // Use both fs.watch and polling for reliability (mirrors original extension)
    try {
      fs.watchFile(agent.jsonlFile, { interval: FILE_POLL_INTERVAL_MS }, () => {
        this.readNewLines(id);
      });
    } catch { /* ignore */ }

    const interval = setInterval(() => {
      if (!this.agentById.has(id)) {
        clearInterval(interval);
        try { fs.unwatchFile(agent.jsonlFile); } catch { /* ignore */ }
        return;
      }
      this.readNewLines(id);
    }, FILE_POLL_INTERVAL_MS);
    this.pollingTimers.set(id, interval);
  }

  private readNewLines(agentId: number): void {
    const agent = this.agentById.get(agentId);
    if (!agent) return;
    try {
      const stat = fs.statSync(agent.jsonlFile);
      if (stat.size <= agent.fileOffset) return;

      const buf = Buffer.alloc(stat.size - agent.fileOffset);
      const fd = fs.openSync(agent.jsonlFile, 'r');
      fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
      fs.closeSync(fd);
      agent.fileOffset = stat.size;

      const text = agent.lineBuffer + buf.toString('utf-8');
      const lines = text.split('\n');
      agent.lineBuffer = lines.pop() || '';

      const hasLines = lines.some((l) => l.trim());
      if (hasLines) {
        cancelWaitingTimer(agentId, this.waitingTimers);
        cancelPermissionTimer(agentId, this.permissionTimers);
        if (agent.permissionSent) {
          agent.permissionSent = false;
          this.cb(agentId, 'agentToolPermissionClear', {});
        }
      }

      for (const line of lines) {
        if (!line.trim()) continue;
        processTranscriptLine(
          agentId,
          line,
          this.agentById,
          this.waitingTimers,
          this.permissionTimers,
          this.cb.bind(this),
        );
      }

      // Emit a general update so renderer can repaint
      this.emit('agentUpdated', agent);
    } catch { /* file may disappear */ }
  }

  private cb(id: number, type: string, data?: Record<string, unknown>): void {
    const agent = this.agentById.get(id);
    if (!agent) return;

    // Sync status fields from event
    if (type === 'agentStatus') {
      const s = data?.status as string | undefined;
      if (s === 'waiting') { agent.status = 'waiting'; agent.currentActivity = 'Waiting for input...'; }
      else if (s === 'active') { agent.status = 'active'; }
    } else if (type === 'agentToolPermission') {
      agent.status = 'permission';
      agent.currentActivity = 'Needs permission!';
    } else if (type === 'agentToolPermissionClear') {
      agent.status = 'active';
    } else if (type === 'agentToolsClear') {
      agent.status = 'active';
      agent.currentActivity = 'Working...';
    } else if (type === 'agentToolStart') {
      agent.status = 'active';
      if (data?.status) agent.currentActivity = data.status as string;
    } else if (type === 'agentToolDone') {
      if (agent.activeToolIds.size === 0) {
        agent.currentActivity = 'Working...';
      }
    }

    this.emit('agentEvent', { id, type, data, agent });
    this.emit('agentUpdated', agent);
  }
}
