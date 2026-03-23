export type AgentStatus = 'idle' | 'active' | 'waiting' | 'permission';

export interface AgentState {
  id: number;
  projectDir: string;
  projectName: string;
  jsonlFile: string;
  fileOffset: number;
  lineBuffer: string;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>;
  activeSubagentToolNames: Map<string, Map<string, string>>;
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  status: AgentStatus;
  currentActivity: string;
  paletteIndex: number;
  lastActivity: number;
}

// ─── Layout types (mirrors webview-ui/src/office/types.ts) ───────────────────

export const TileType = {
  WALL: 0,
  FLOOR_1: 1,
  FLOOR_2: 2,
  FLOOR_3: 3,
  FLOOR_4: 4,
  FLOOR_5: 5,
  FLOOR_6: 6,
  FLOOR_7: 7,
  FLOOR_8: 8,
  FLOOR_9: 9,
  VOID: 255,
} as const;

export interface FloorColor {
  h: number;
  s: number;
  b: number;
  c: number;
  colorize?: boolean;
}

export interface PlacedFurniture {
  uid: string;
  type: string;
  col: number;
  row: number;
  rotation?: number;
  color?: FloorColor;
}

export interface LayoutData {
  version: number;
  cols: number;
  rows: number;
  tiles: number[];
  furniture: PlacedFurniture[];
  tileColors?: (FloorColor | null)[];
}

// ─── Pixel buffer ─────────────────────────────────────────────────────────────

export interface PixelBuffer {
  data: Uint8Array; // RGBA, 4 bytes per pixel
  width: number;
  height: number;
}

// ─── Loaded assets ────────────────────────────────────────────────────────────

export interface FurnitureAsset {
  sprite: PixelBuffer;
  footprintW: number;
  footprintH: number;
}

export interface Assets {
  floors: PixelBuffer[]; // floor_0.png … floor_8.png, colorized
  wall: PixelBuffer; // generic wall tile piece (16×16)
  characters: PixelBuffer[]; // char_0.png … char_5.png
  furniture: Map<string, FurnitureAsset>;
}
