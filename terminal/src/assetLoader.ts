/**
 * Loads PNG sprites from ../webview-ui/public/assets/ using pngjs.
 * Applies Photoshop-style colorize to floor tiles (same algorithm as colorize.ts).
 */

import * as fs from 'fs';
import * as path from 'path';
import { PNG } from 'pngjs';
import type { Assets, FurnitureAsset, FloorColor, PixelBuffer } from './types';
import { createBuffer, blit } from './pixelBuffer';

// Path to the original extension's public assets (sibling directory)
const ASSETS_DIR = path.resolve(__dirname, '../../webview-ui/public/assets');

const DEFAULT_FLOOR_COLOR: FloorColor = { h: 35, s: 30, b: 15, c: 0 };

// ─── PNG loading ──────────────────────────────────────────────────────────────

function loadPng(filePath: string): PixelBuffer {
  const raw = fs.readFileSync(filePath);
  const png = PNG.sync.read(raw);
  const buf = createBuffer(png.width, png.height);
  buf.data.set(png.data);
  return buf;
}

// ─── Photoshop colorize (mirrors colorize.ts Colorize mode) ──────────────────

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function colorizeSprite(src: PixelBuffer, fc: FloorColor): PixelBuffer {
  const out = createBuffer(src.width, src.height);
  const { h, s, b: brightness, c: contrast } = fc;
  for (let i = 0; i < src.width * src.height; i++) {
    const si = i * 4;
    const a = src.data[si + 3];
    if (a < 2) continue;
    let lum = (0.299 * src.data[si] + 0.587 * src.data[si + 1] + 0.114 * src.data[si + 2]) / 255;
    if (contrast !== 0) {
      const f = (259 * (contrast + 255)) / (255 * (259 - contrast));
      lum = Math.max(0, Math.min(1, f * (lum - 0.5) + 0.5));
    }
    lum = Math.max(0, Math.min(1, lum + brightness / 100));
    const [r, g, bl] = hslToRgb(h / 360, s / 100, lum);
    out.data[si] = r;
    out.data[si + 1] = g;
    out.data[si + 2] = bl;
    out.data[si + 3] = a;
  }
  return out;
}

// ─── Furniture catalog ────────────────────────────────────────────────────────

function loadFurnitureCatalog(): Map<string, FurnitureAsset> {
  const map = new Map<string, FurnitureAsset>();
  const furnitureDir = path.join(ASSETS_DIR, 'furniture');
  if (!fs.existsSync(furnitureDir)) return map;

  for (const group of fs.readdirSync(furnitureDir)) {
    const groupDir = path.join(furnitureDir, group);
    const manifestPath = path.join(groupDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) continue;

    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }

    const members: Array<{ id: string; file: string; footprintW?: number; footprintH?: number }> =
      manifest.type === 'group'
        ? (manifest.members as typeof members)
        : [manifest as (typeof members)[0]];

    for (const m of members) {
      if (!m.file || !m.id) continue;
      const pngPath = path.join(groupDir, m.file);
      if (!fs.existsSync(pngPath)) continue;
      try {
        const sprite = loadPng(pngPath);
        map.set(m.id, {
          sprite,
          footprintW: m.footprintW ?? 1,
          footprintH: m.footprintH ?? 1,
        });
      } catch {
        /* skip unreadable */
      }
    }
  }
  return map;
}

// ─── Wall tile (take a 16×16 slice from wall_0.png) ──────────────────────────

function loadWallTile(): PixelBuffer {
  const wallPath = path.join(ASSETS_DIR, 'walls', 'wall_0.png');
  const TILE = 16;
  if (!fs.existsSync(wallPath)) {
    // Solid dark fallback
    const buf = createBuffer(TILE, TILE);
    buf.data.fill(60, 0); // dark grey-ish
    for (let i = 3; i < buf.data.length; i += 4) buf.data[i] = 255;
    return buf;
  }
  const src = loadPng(wallPath);
  // wall_0.png is 64×128 (4×4 grid of 16×32 pieces).
  // Take the top-left piece top 16px for a generic wall look.
  const out = createBuffer(TILE, TILE);
  blit(out, src, 0, 0, 0, 0, TILE, TILE);
  return out;
}

// ─── Public loader ────────────────────────────────────────────────────────────

export async function loadAssets(): Promise<Assets> {
  const floorsDir = path.join(ASSETS_DIR, 'floors');
  const charsDir = path.join(ASSETS_DIR, 'characters');

  // Floor tiles (colorized with default warm color)
  const floors: PixelBuffer[] = [];
  for (let i = 0; i <= 8; i++) {
    const fp = path.join(floorsDir, `floor_${i}.png`);
    if (fs.existsSync(fp)) {
      floors.push(colorizeSprite(loadPng(fp), DEFAULT_FLOOR_COLOR));
    } else {
      // Solid fallback
      const fb = createBuffer(16, 16);
      const [r, g, b] = [120, 90, 60];
      for (let j = 0; j < 16 * 16; j++) {
        fb.data[j * 4] = r;
        fb.data[j * 4 + 1] = g;
        fb.data[j * 4 + 2] = b;
        fb.data[j * 4 + 3] = 255;
      }
      floors.push(fb);
    }
  }

  // Character sprites
  const characters: PixelBuffer[] = [];
  for (let i = 0; i <= 5; i++) {
    const cp = path.join(charsDir, `char_${i}.png`);
    characters.push(fs.existsSync(cp) ? loadPng(cp) : createBuffer(112, 96));
  }

  const furniture = loadFurnitureCatalog();
  const wall = loadWallTile();

  return { floors, wall, characters, furniture };
}
