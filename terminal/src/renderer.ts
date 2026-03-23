/**
 * Terminal renderer using true-color ANSI half-block characters.
 *
 * Each terminal row represents 2 "pixel rows" of the scene:
 *   top half  → ▀ foreground color
 *   bottom half → ▀ background color
 * Each terminal column represents CELL_PX sprite pixels wide.
 *
 * Scale is auto-calculated to fit the office in the current terminal size.
 */

import * as os from 'os';
import type { PixelBuffer, AgentState, Assets, LayoutData } from './types';
import { averageBlock } from './pixelBuffer';
import { buildScene, agentPixelPositions } from './scene';

const ENTER_ALT = '\x1b[?1049h';
const EXIT_ALT = '\x1b[?1049l';
const HIDE_CUR = '\x1b[?25l';
const SHOW_CUR = '\x1b[?25h';
const HOME = '\x1b[H';
const RESET = '\x1b[0m';
const VOID_BG = '\x1b[48;2;18;18;30m'; // dark navy void color

const TICK_MS = 350;
const LABEL_MAX = 18;

// ─── Color helpers ────────────────────────────────────────────────────────────

const fg = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
const bg = (r: number, g: number, b: number) => `\x1b[48;2;${r};${g};${b}m`;

function statusDot(status: AgentState['status']): string {
  switch (status) {
    case 'active':
      return fg(80, 220, 80) + '●' + RESET;
    case 'waiting':
      return fg(220, 180, 40) + '●' + RESET;
    case 'permission':
      return fg(220, 60, 60) + '●' + RESET;
    default:
      return fg(100, 100, 120) + '●' + RESET;
  }
}

// ─── Half-block scene rendering ───────────────────────────────────────────────

function renderScene(scene: PixelBuffer, scale: number): string {
  const termCols = Math.floor(scene.width / scale);
  const termRows = Math.floor(scene.height / (scale * 2));
  const lines: string[] = [];

  for (let ty = 0; ty < termRows; ty++) {
    let line = '';
    for (let tx = 0; tx < termCols; tx++) {
      const sx = tx * scale;
      const syTop = ty * scale * 2;
      const syBot = syTop + scale;

      const [tr, tg, tb, ta] = averageBlock(scene, sx, syTop, scale, scale);
      const [br, bgr, bb, ba] = averageBlock(scene, sx, syBot, scale, scale);

      const topVis = ta > 20;
      const botVis = ba > 20;

      if (!topVis && !botVis) {
        line += VOID_BG + '  ' + RESET;
      } else if (topVis && !botVis) {
        line += fg(tr, tg, tb) + VOID_BG + '▀▀' + RESET;
      } else if (!topVis && botVis) {
        line += VOID_BG + bg(br, bgr, bb) + '▄▄' + RESET;
      } else {
        line += fg(tr, tg, tb) + bg(br, bgr, bb) + '▀▀' + RESET;
      }
    }
    lines.push(line);
  }
  return lines.join('\r\n');
}

// ─── Agent label overlay ──────────────────────────────────────────────────────
// Returns a sparse map of termRow → [(termCol, labelStr)] for overlaying text

function buildLabelMap(
  agents: AgentState[],
  seats: Array<{ col: number; row: number }>,
  sceneW: number,
  sceneH: number,
  scale: number,
): Map<number, Array<[number, string]>> {
  const map = new Map<number, Array<[number, string]>>();
  const positions = agentPixelPositions(agents, seats);

  for (const { agent, px, py } of positions) {
    // Convert pixel coords → terminal coords
    const termCol = Math.floor(px / scale);
    const termRow = Math.floor(py / (scale * 2));
    if (termCol < 0 || termRow < 0) continue;

    // Build label: "● name: activity"
    const name = agent.projectName.slice(-10);
    const act = agent.currentActivity.slice(0, LABEL_MAX);
    const label = `${statusDot(agent.status)} ${name}: ${act}`;

    if (!map.has(termRow)) map.set(termRow, []);
    map.get(termRow)!.push([termCol, label]);
  }
  return map;
}

// ─── Renderer class ───────────────────────────────────────────────────────────

export class Renderer {
  private tick = 0;
  private timer?: ReturnType<typeof setInterval>;
  private getAgents: () => AgentState[];
  private getLayout: () => LayoutData;
  private getAssets: () => Assets | null;
  private getSeats: () => Array<{ col: number; row: number }>;

  constructor(opts: {
    getAgents: () => AgentState[];
    getLayout: () => LayoutData;
    getAssets: () => Assets | null;
    getSeats: () => Array<{ col: number; row: number }>;
  }) {
    this.getAgents = opts.getAgents;
    this.getLayout = opts.getLayout;
    this.getAssets = opts.getAssets;
    this.getSeats = opts.getSeats;
  }

  start(): void {
    process.stdout.write(ENTER_ALT + HIDE_CUR);
    this.renderFrame();
    this.timer = setInterval(() => {
      this.tick++;
      this.renderFrame();
    }, TICK_MS);

    process.stdout.on('resize', () => this.renderFrame());
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    process.stdout.write(SHOW_CUR + EXIT_ALT);
  }

  requestRender(): void {
    this.renderFrame();
  }

  private renderFrame(): void {
    const assets = this.getAssets();
    const agents = this.getAgents();
    const layout = this.getLayout();
    const seats = this.getSeats();
    const termW = process.stdout.columns || 120;
    const termH = process.stdout.rows || 40;

    // ── Header ──────────────────────────────────────────────────────────────
    const active = agents.filter((a) => a.status === 'active').length;
    const waiting = agents.filter((a) => a.status === 'waiting').length;
    const perm = agents.filter((a) => a.status === 'permission').length;
    const header = [
      bg(30, 30, 60) + fg(200, 200, 255),
      '  PIXEL AGENTS  ',
      RESET + bg(30, 30, 60) + fg(150, 150, 200),
      `  ${agents.length} sessions `,
      fg(80, 220, 80) + `  ${active} active ` + fg(150, 150, 200),
      fg(220, 180, 40) + `  ${waiting} waiting `,
      perm ? fg(220, 60, 60) + `  ${perm} need permission ` : '',
      fg(120, 120, 160) + '  [q] quit  ',
      RESET,
    ].join('');

    // ── Loading screen ──────────────────────────────────────────────────────
    if (!assets) {
      const msg = 'Loading assets…';
      const row = Math.floor(termH / 2);
      const col = Math.floor((termW - msg.length) / 2);
      let out = HOME + header + '\r\n';
      for (let i = 1; i < row; i++) out += '\r\n';
      out += ' '.repeat(col) + fg(200, 200, 200) + msg + RESET;
      process.stdout.write(out);
      return;
    }

    // ── Auto scale ──────────────────────────────────────────────────────────
    const officeW = layout.cols * 16;
    const officeH = layout.rows * 16;
    const availW = termW;
    const availH = termH - 3; // header + footer + gap
    const scaleH = Math.ceil(officeH / (availH * 2));
    const scaleW = Math.ceil(officeW / (availW / 2)); // 2 chars per pixel
    const scale = Math.max(scaleW, scaleH, 1);

    // ── Build scene ─────────────────────────────────────────────────────────
    const scene = buildScene(layout, assets, agents, seats, this.tick);

    // ── Render to string ─────────────────────────────────────────────────────
    const sceneStr = renderScene(scene, scale);
    const sceneRows = sceneStr.split('\r\n');
    const labelMap = buildLabelMap(agents, seats, scene.width, scene.height, scale);

    // ── Footer ───────────────────────────────────────────────────────────────
    const footer =
      bg(20, 20, 40) +
      fg(100, 100, 140) +
      `  Watching ~/.claude/projects/  |  scale 1:${scale}  |  ` +
      `office ${layout.cols}×${layout.rows} tiles` +
      RESET;

    // ── Assemble output ──────────────────────────────────────────────────────
    let out = HOME + header + '\r\n';

    for (let r = 0; r < sceneRows.length; r++) {
      let row = sceneRows[r];
      // Overlay any labels for this row
      const labels = labelMap.get(r);
      if (labels) {
        // We just append them as a side panel after the scene
        for (const [, labelStr] of labels) {
          row += '  ' + labelStr;
        }
      }
      out += row + RESET + '\r\n';
    }

    out += footer;
    process.stdout.write(out);
  }
}
