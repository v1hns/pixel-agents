/**
 * blessed-based terminal UI renderer.
 * Shows a grid of agent panels with animated pixel art characters.
 */

import * as blessed from 'blessed';
import * as path from 'path';
import type { AgentState } from './types';
import { renderSprite, statusColor, SPRITE_VISUAL_HEIGHT } from './sprites';

// Panel sizing
const PANEL_WIDTH  = 22;  // inner content width (chars)
const PANEL_HEIGHT = SPRITE_VISUAL_HEIGHT + 6; // sprite + title + activity + padding

// Animation tick (advances at TICK_INTERVAL_MS)
const TICK_INTERVAL_MS = 400;

export class Renderer {
  private screen: blessed.Widgets.Screen;
  private headerBox!: blessed.Widgets.BoxElement;
  private footerBox!: blessed.Widgets.BoxElement;
  private agentBoxes = new Map<number, blessed.Widgets.BoxElement>();
  private tick = 0;
  private tickTimer?: ReturnType<typeof setInterval>;
  private getAgents: () => AgentState[];

  constructor(getAgents: () => AgentState[]) {
    this.getAgents = getAgents;
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Pixel Agents Terminal',
      dockBorders: true,
      fullUnicode: true,
    });

    this.buildChrome();

    // Quit on q / ESC / Ctrl-C
    this.screen.key(['q', 'escape', 'C-c'], () => {
      this.stop();
      process.exit(0);
    });
  }

  // ─── Chrome ──────────────────────────────────────────────────────────────────

  private buildChrome(): void {
    this.headerBox = blessed.box({
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      tags: true,
      style: { fg: 'white', bg: 'blue', bold: true },
      content: this.headerContent(),
    });

    this.footerBox = blessed.box({
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: { fg: 'black', bg: 'cyan' },
      content: ' [q] quit  |  Watching ~/.claude/projects/ for active Claude Code sessions',
    });

    this.screen.append(this.headerBox);
    this.screen.append(this.footerBox);
  }

  private headerContent(): string {
    const agents = this.getAgents();
    const count = agents.length;
    const active = agents.filter((a) => a.status === 'active').length;
    return (
      `  Pixel Agents Terminal  |  ` +
      `${count} session${count !== 1 ? 's' : ''} detected  |  ` +
      `${active} active`
    );
  }

  // ─── Agent panels ────────────────────────────────────────────────────────────

  private rebuildPanels(): void {
    // Remove all old boxes
    for (const box of this.agentBoxes.values()) {
      this.screen.remove(box);
    }
    this.agentBoxes.clear();

    const agents = this.getAgents();
    if (agents.length === 0) {
      this.renderEmptyState();
      return;
    }

    const screenWidth  = this.screen.width as number;
    const screenHeight = this.screen.height as number;

    const cols = Math.max(1, Math.floor(screenWidth / (PANEL_WIDTH + 4)));
    let col = 0;
    let row = 0;

    for (const agent of agents) {
      const left = col * (PANEL_WIDTH + 4) + 2;
      const top  = 3 + row * (PANEL_HEIGHT + 2);

      if (top + PANEL_HEIGHT + 1 > screenHeight - 2) {
        // no more vertical space
        break;
      }

      const box = blessed.box({
        top,
        left,
        width: PANEL_WIDTH + 2,  // +2 for border
        height: PANEL_HEIGHT + 2,
        tags: false,
        border: { type: 'line' },
        style: {
          border: { fg: this.borderColor(agent) },
        },
        scrollable: false,
      });

      this.screen.append(box);
      this.agentBoxes.set(agent.id, box);

      col++;
      if (col >= cols) {
        col = 0;
        row++;
      }
    }
  }

  private borderColor(agent: AgentState): string {
    switch (agent.status) {
      case 'active':     return 'green';
      case 'waiting':    return 'yellow';
      case 'permission': return 'red';
      default:           return 'gray';
    }
  }

  private renderEmptyState(): void {
    const emptyBox = blessed.box({
      top:    '50%-4',
      left:   'center',
      width:  50,
      height: 7,
      border: { type: 'line' },
      content: [
        '',
        '  No active Claude Code sessions found.',
        '',
        '  Start a session: claude',
        '  Or run: claude --session-id <id>',
      ].join('\n'),
    });
    this.screen.append(emptyBox);
    this.agentBoxes.set(-1, emptyBox);
  }

  // ─── Per-frame render ─────────────────────────────────────────────────────────

  private renderFrame(): void {
    const agents = this.getAgents();

    // Rebuild layout if agent set changed
    const boxIds = new Set(this.agentBoxes.keys());
    const agentIds = new Set(agents.map((a) => a.id));
    const changed =
      boxIds.size !== agentIds.size ||
      [...agentIds].some((id) => !boxIds.has(id)) ||
      (boxIds.has(-1) && agents.length > 0);

    if (changed) this.rebuildPanels();

    this.headerBox.setContent(this.headerContent());

    for (const agent of agents) {
      const box = this.agentBoxes.get(agent.id);
      if (!box) continue;
      box.setContent(this.renderAgentContent(agent));
      // Update border color
      (box.style as { border: { fg: string } }).border.fg = this.borderColor(agent);
    }

    this.screen.render();
  }

  private renderAgentContent(agent: AgentState): string {
    const spriteLines = renderSprite(agent.status, agent.paletteIndex, this.tick);
    const statusCol = statusColor(agent.status);
    const RESET_SEQ = '\x1b[0m';

    // Truncate projectName + session ID suffix to panel width
    const sessionFile = path.basename(agent.jsonlFile, '.jsonl');
    const sessionShort = sessionFile.slice(0, 8); // first 8 chars of UUID
    const nameWidth = PANEL_WIDTH - 10;
    const projectDisplay = agent.projectName.length > nameWidth
      ? agent.projectName.slice(0, nameWidth - 1) + '…'
      : agent.projectName;

    // Activity line: truncate to panel width
    const actWidth = PANEL_WIDTH - 2;
    const act = agent.currentActivity.length > actWidth
      ? agent.currentActivity.slice(0, actWidth - 1) + '…'
      : agent.currentActivity;

    const lines: string[] = [];

    // Title row: project name + session ID
    lines.push(
      `${statusCol}●${RESET_SEQ} ${projectDisplay}  \x1b[90m${sessionShort}…${RESET_SEQ}`
    );
    lines.push(''); // spacer

    // Sprite rows (centered in panel)
    const spriteLeftPad = Math.max(0, Math.floor((PANEL_WIDTH - 12) / 2));
    const pad = ' '.repeat(spriteLeftPad);
    for (const spriteLine of spriteLines) {
      lines.push(pad + spriteLine);
    }

    lines.push(''); // spacer below sprite

    // Activity / status text
    lines.push(` ${statusCol}${act}${RESET_SEQ}`);

    // Tool list (show up to 2 active tools)
    const tools = [...agent.activeToolStatuses.values()].slice(0, 2);
    for (const t of tools) {
      const tw = PANEL_WIDTH - 4;
      const tShort = t.length > tw ? t.slice(0, tw - 1) + '…' : t;
      lines.push(` \x1b[36m+ ${tShort}${RESET_SEQ}`);
    }

    return lines.join('\n');
  }

  // ─── Lifecycle ────────────────────────────────────────────────────────────────

  start(): void {
    this.rebuildPanels();
    this.screen.render();

    this.tickTimer = setInterval(() => {
      this.tick++;
      this.renderFrame();
    }, TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.screen.destroy();
  }

  /** Call when agent data changes (immediate repaint on next tick). */
  requestRender(): void {
    // renderFrame is already called on tick, so no explicit call needed.
    // But force an immediate redraw for responsiveness:
    this.renderFrame();
  }
}
