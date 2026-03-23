/**
 * Reads the Claude office layout from:
 *   1. ~/.pixel-agents/layout.json  (user's saved layout)
 *   2. ../webview-ui/public/assets/default-layout-1.json  (bundled default)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { LayoutData } from './types';

const USER_LAYOUT = path.join(os.homedir(), '.pixel-agents', 'layout.json');
const DEFAULT_LAYOUT = path.resolve(
  __dirname,
  '../../webview-ui/public/assets/default-layout-1.json',
);

export function readLayout(): LayoutData {
  for (const p of [USER_LAYOUT, DEFAULT_LAYOUT]) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as LayoutData;
      if (raw.version === 1 && Array.isArray(raw.tiles)) return raw;
    } catch {
      /* try next */
    }
  }
  // Minimal fallback: solid 10×8 floor
  const cols = 10,
    rows = 8;
  return {
    version: 1,
    cols,
    rows,
    tiles: Array(cols * rows).fill(1),
    furniture: [],
  };
}

// ─── Seat finder ─────────────────────────────────────────────────────────────

const CHAIR_TYPES = new Set([
  'CUSHIONED_CHAIR_FRONT',
  'CUSHIONED_CHAIR_BACK',
  'CUSHIONED_CHAIR_SIDE',
  'WOODEN_CHAIR_FRONT',
  'WOODEN_CHAIR_BACK',
  'WOODEN_CHAIR_SIDE',
  'SOFA_FRONT',
  'SOFA_BACK',
  'SOFA_SIDE',
  'CUSHIONED_BENCH',
  'WOODEN_BENCH',
]);

/** Returns tile positions of all chair-like furniture (used for agent placement). */
export function findSeats(layout: LayoutData): Array<{ col: number; row: number }> {
  return layout.furniture
    .filter((f) => CHAIR_TYPES.has(f.type))
    .map((f) => ({ col: f.col, row: f.row }));
}
