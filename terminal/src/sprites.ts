/**
 * Pixel art character sprites rendered using ANSI 256-color background codes.
 * Each "pixel" = 2 spaces with a background color → square-ish appearance.
 * Sprite grid: 6 pixels wide, 10 pixels tall → 12 terminal cols × 10 rows.
 */

import type { AgentStatus } from './types';

// ─── Color palette ────────────────────────────────────────────────────────────
// Index 0 = transparent (no bg), 1–6 per-agent-palette, 7+ shared

const SKIN  = 216; // ansi256 #ffaf87 — warm skin tone
const EYES  = 234; // ansi256 very dark
const SHOES = 52;  // ansi256 dark brown

// Per-agent palettes: [hair, shirt, pants]
const AGENT_PALETTES: [number, number, number][] = [
  [94,  202, 17 ], // brown hair, orange shirt, dark blue pants
  [234, 27,  52 ], // black hair, blue shirt, brown pants
  [220, 40,  232], // blonde, green shirt, very dark pants
  [166, 93,  17 ], // red hair, purple shirt, blue pants
  [130, 196, 236], // auburn hair, red shirt, light blue pants
  [234, 226, 17 ], // black hair, yellow shirt, blue pants
];

// Sprite color codes (each cell = index into per-frame color map)
// 0 = transparent, 1 = skin, 2 = hair, 3 = shirt, 4 = pants, 5 = eyes, 6 = shoes
type SpriteFrame = number[][];

// ─── Sprite frames ─────────────────────────────────────────────────────────────

// Idle / standing
const IDLE_A: SpriteFrame = [
  [0,0,2,2,0,0],
  [0,2,2,2,2,0],
  [0,1,1,1,1,0],
  [0,1,5,1,5,0],
  [0,1,1,1,1,0],
  [3,3,3,3,3,3],
  [3,0,3,3,0,3],
  [0,0,4,4,0,0],
  [0,0,4,4,0,0],
  [0,0,6,6,0,0],
];

// Idle blink (eyes closed)
const IDLE_B: SpriteFrame = [
  [0,0,2,2,0,0],
  [0,2,2,2,2,0],
  [0,1,1,1,1,0],
  [0,1,1,1,1,0],  // blink
  [0,1,1,1,1,0],
  [3,3,3,3,3,3],
  [3,0,3,3,0,3],
  [0,0,4,4,0,0],
  [0,0,4,4,0,0],
  [0,0,6,6,0,0],
];

// Typing / active frame A (arms at keyboard)
const TYPING_A: SpriteFrame = [
  [0,0,2,2,0,0],
  [0,2,2,2,2,0],
  [0,1,1,1,1,0],
  [0,1,5,1,5,0],
  [0,1,1,1,1,0],
  [3,3,3,3,3,3],
  [0,3,3,3,3,0],
  [3,3,0,0,3,3],  // hands at keyboard level
  [0,0,4,4,0,0],
  [0,0,6,6,0,0],
];

// Typing frame B (slight variation)
const TYPING_B: SpriteFrame = [
  [0,0,2,2,0,0],
  [0,2,2,2,2,0],
  [0,1,1,1,1,0],
  [0,1,5,1,5,0],
  [0,1,1,1,1,0],
  [3,3,3,3,3,3],
  [3,3,0,0,3,3],
  [0,3,3,3,3,0],  // arms shifted
  [0,0,4,4,0,0],
  [0,0,6,6,0,0],
];

// Waiting (arms crossed, head tilted)
const WAITING_FRAME: SpriteFrame = [
  [0,0,2,2,0,0],
  [0,2,2,2,2,0],
  [0,1,1,1,1,0],
  [0,1,5,1,5,0],
  [0,1,1,1,1,0],
  [3,3,3,3,3,3],
  [0,3,3,3,3,0],  // arms crossed
  [0,3,3,3,3,0],
  [0,0,4,4,0,0],
  [0,0,6,6,0,0],
];

// Permission needed (one hand raised, ? expression)
const PERMISSION_FRAME: SpriteFrame = [
  [0,0,2,2,0,0],
  [0,2,2,2,2,0],
  [0,1,1,1,1,0],
  [0,1,5,1,5,0],
  [0,1,1,1,0,0],  // mouth open (row 4 shifted)
  [3,3,3,3,3,0],
  [3,0,3,3,3,0],
  [0,3,3,0,0,3],  // one arm raised
  [0,0,4,4,0,0],
  [0,0,6,6,0,0],
];

// ─── Animation sequences ──────────────────────────────────────────────────────

const ANIMATIONS: Record<AgentStatus, SpriteFrame[]> = {
  idle:       [IDLE_A, IDLE_A, IDLE_A, IDLE_A, IDLE_B, IDLE_A],  // slow blink
  active:     [TYPING_A, TYPING_B, TYPING_A, TYPING_B],
  waiting:    [WAITING_FRAME],
  permission: [PERMISSION_FRAME, IDLE_A],  // flicker effect
};

// ─── Renderer ─────────────────────────────────────────────────────────────────

const RESET = '\x1b[0m';
const BG = (n: number) => `\x1b[48;5;${n}m`;

function colorForIndex(idx: number, palette: [number, number, number]): number | null {
  switch (idx) {
    case 0: return null; // transparent
    case 1: return SKIN;
    case 2: return palette[0]; // hair
    case 3: return palette[1]; // shirt
    case 4: return palette[2]; // pants
    case 5: return EYES;
    case 6: return SHOES;
    default: return null;
  }
}

export function renderSprite(status: AgentStatus, paletteIndex: number, tick: number): string[] {
  const frames = ANIMATIONS[status] ?? ANIMATIONS.idle;
  const frame = frames[tick % frames.length];
  const palette = AGENT_PALETTES[paletteIndex % AGENT_PALETTES.length];
  const lines: string[] = [];

  for (const row of frame) {
    let line = '';
    for (const colorIdx of row) {
      const ansiColor = colorForIndex(colorIdx, palette);
      if (ansiColor === null) {
        line += '  '; // transparent — 2 spaces
      } else {
        line += `${BG(ansiColor)}  ${RESET}`;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Returns the visual width of each sprite line (always 12 for 6-pixel-wide sprites). */
export const SPRITE_VISUAL_WIDTH = 12;
export const SPRITE_VISUAL_HEIGHT = 10;

/** Status bubble shown above the sprite */
export function statusBubble(status: AgentStatus, activity: string): string {
  switch (status) {
    case 'active':     return ` \x1b[32m>\x1b[0m ${activity}`;
    case 'waiting':    return ` \x1b[33mz\x1b[0m ${activity}`;
    case 'permission': return ` \x1b[31m!\x1b[0m ${activity}`;
    default:           return ` \x1b[90m~\x1b[0m ${activity}`;
  }
}

/** Returns ANSI color sequence for an agent status indicator dot */
export function statusColor(status: AgentStatus): string {
  switch (status) {
    case 'active':     return '\x1b[32m'; // green
    case 'waiting':    return '\x1b[33m'; // yellow
    case 'permission': return '\x1b[31m'; // red
    default:           return '\x1b[90m'; // gray
  }
}
