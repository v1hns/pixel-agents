/**
 * Composes a full RGBA pixel buffer of the office:
 *   Layer 1 — floor tiles
 *   Layer 2 — furniture (z-sorted by row)
 *   Layer 3 — characters (z-sorted by row, animated per status)
 *
 * Mirrors the rendering logic in webview-ui/src/office/engine/renderer.ts
 * but outputs a flat pixel buffer instead of a canvas.
 */

import type { Assets, LayoutData, AgentState, PixelBuffer } from './types';
import type { AgentStatus } from './types';
import { TileType } from './types';
import { createBuffer, blit } from './pixelBuffer';

const TILE = 16; // sprite pixels per tile
const CHAR_W = 16; // character sprite frame width
const CHAR_H = 32; // character sprite frame height

// Character sprite sheet layout (112×96):
//   7 frames × 16px wide
//   3 direction rows × 32px tall
//   Row 0 = down, Row 1 = up, Row 2 = right (left = flip)
const DIR_DOWN = 0;

// Frame columns: walk1=0 walk2=1 walk3=2 type1=3 type2=4 read1=5 read2=6
function charFrame(status: AgentStatus, activity: string, tick: number): number {
  if (status === 'active') {
    if (/read|search|grep|glob|fetch/i.test(activity)) return tick % 2 === 0 ? 5 : 6;
    return tick % 2 === 0 ? 3 : 4;
  }
  return 1; // standing (walk2)
}

// ─── Scene builder ────────────────────────────────────────────────────────────

export function buildScene(
  layout: LayoutData,
  assets: Assets,
  agents: AgentState[],
  seats: Array<{ col: number; row: number }>,
  tick: number,
): PixelBuffer {
  const W = layout.cols * TILE;
  const H = layout.rows * TILE;
  const buf = createBuffer(W, H);

  // ── Layer 1: floor & walls ────────────────────────────────────────────────
  for (let ty = 0; ty < layout.rows; ty++) {
    for (let tx = 0; tx < layout.cols; tx++) {
      const tileVal = layout.tiles[ty * layout.cols + tx];
      const px = tx * TILE;
      const py = ty * TILE;

      if (tileVal === TileType.VOID || tileVal === undefined) {
        // void: leave transparent (black bg set by renderer)
        continue;
      }

      if (tileVal === TileType.WALL) {
        // Tile tiling: repeat 16×16 wall sprite
        blit(buf, assets.wall, px, py);
        continue;
      }

      // Floor tile: index = tileVal - 1 (FLOOR_1=1 → index 0)
      const floorIdx = Math.max(0, Math.min(assets.floors.length - 1, tileVal - 1));
      blit(buf, assets.floors[floorIdx], px, py);
    }
  }

  // ── Layer 2: furniture (z-sort by row, then col) ──────────────────────────
  const sortedFurniture = [...layout.furniture].sort((a, b) =>
    a.row !== b.row ? a.row - b.row : a.col - b.col,
  );

  for (const f of sortedFurniture) {
    const asset = assets.furniture.get(f.type);
    if (!asset) continue;
    const px = f.col * TILE;
    const py = f.row * TILE;
    blit(buf, asset.sprite, px, py);
  }

  // ── Layer 3: characters (z-sort by row) ──────────────────────────────────
  // Assign agents to seats, fall back to default positions
  const defaultPositions = [
    { col: 2, row: 3 },
    { col: 6, row: 3 },
    { col: 10, row: 3 },
    { col: 14, row: 3 },
    { col: 2, row: 8 },
    { col: 6, row: 8 },
    { col: 10, row: 8 },
    { col: 14, row: 8 },
  ];

  const charEntities: Array<{ agent: AgentState; col: number; row: number }> = [];
  for (let i = 0; i < agents.length; i++) {
    const pos = seats[i] ?? defaultPositions[i % defaultPositions.length];
    charEntities.push({ agent: agents[i], col: pos.col, row: pos.row });
  }

  // Sort by row for correct z-order
  charEntities.sort((a, b) => a.row - b.row);

  for (const { agent, col, row } of charEntities) {
    const charSheet = assets.characters[agent.paletteIndex % assets.characters.length];
    const frame = charFrame(agent.status, agent.currentActivity, tick);
    const srcX = frame * CHAR_W;
    const srcY = DIR_DOWN * CHAR_H;

    // Draw character: bottom of sprite aligns to seat tile bottom
    const px = col * TILE;
    const py = (row + 1) * TILE - CHAR_H; // sprite is 2 tiles tall

    blit(buf, charSheet, px, py, srcX, srcY, CHAR_W, CHAR_H);
  }

  return buf;
}

/** Returns pixel coords (center-x, top-y) of each agent in the scene, for label rendering. */
export function agentPixelPositions(
  agents: AgentState[],
  seats: Array<{ col: number; row: number }>,
): Array<{ agent: AgentState; px: number; py: number }> {
  const defaultPositions = [
    { col: 2, row: 3 },
    { col: 6, row: 3 },
    { col: 10, row: 3 },
    { col: 14, row: 3 },
    { col: 2, row: 8 },
    { col: 6, row: 8 },
    { col: 10, row: 8 },
    { col: 14, row: 8 },
  ];
  return agents.map((agent, i) => {
    const pos = seats[i] ?? defaultPositions[i % defaultPositions.length];
    return {
      agent,
      px: pos.col * TILE + CHAR_W / 2,
      py: pos.row * TILE - CHAR_H,
    };
  });
}
