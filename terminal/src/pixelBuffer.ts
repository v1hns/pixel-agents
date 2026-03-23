/**
 * Low-level RGBA pixel buffer operations.
 * Used by scene.ts to composite floor / furniture / character layers.
 */

import type { PixelBuffer } from './types';

export function createBuffer(width: number, height: number): PixelBuffer {
  return { data: new Uint8Array(width * height * 4), width, height };
}

/** Alpha-composite src onto dst at (dx, dy). Supports horizontal flip. */
export function blit(
  dst: PixelBuffer,
  src: PixelBuffer,
  dx: number,
  dy: number,
  sx = 0,
  sy = 0,
  sw = src.width,
  sh = src.height,
  flipX = false,
): void {
  for (let py = 0; py < sh; py++) {
    for (let px = 0; px < sw; px++) {
      const srcCol = flipX ? sx + sw - 1 - px : sx + px;
      const si = ((sy + py) * src.width + srcCol) * 4;
      const srcA = src.data[si + 3];
      if (srcA < 2) continue;

      const destX = dx + px;
      const destY = dy + py;
      if (destX < 0 || destY < 0 || destX >= dst.width || destY >= dst.height) continue;

      const di = (destY * dst.width + destX) * 4;
      if (srcA >= 254) {
        dst.data[di] = src.data[si];
        dst.data[di + 1] = src.data[si + 1];
        dst.data[di + 2] = src.data[si + 2];
        dst.data[di + 3] = 255;
      } else {
        // Porter-Duff over
        const a = srcA / 255;
        const ia = 1 - a;
        const dA = dst.data[di + 3] / 255;
        const oA = a + dA * ia;
        if (oA > 0) {
          dst.data[di] = Math.round((src.data[si] * a + dst.data[di] * dA * ia) / oA);
          dst.data[di + 1] = Math.round((src.data[si + 1] * a + dst.data[di + 1] * dA * ia) / oA);
          dst.data[di + 2] = Math.round((src.data[si + 2] * a + dst.data[di + 2] * dA * ia) / oA);
          dst.data[di + 3] = Math.round(oA * 255);
        }
      }
    }
  }
}

/**
 * Returns the alpha-weighted average RGBA of a rectangular region.
 * Returns [0,0,0,0] if fully transparent.
 */
export function averageBlock(
  buf: PixelBuffer,
  x: number,
  y: number,
  w: number,
  h: number,
): [number, number, number, number] {
  let r = 0,
    g = 0,
    b = 0,
    weightSum = 0;
  const x1 = Math.min(x + w, buf.width);
  const y1 = Math.min(y + h, buf.height);
  const total = Math.max(1, (x1 - Math.max(0, x)) * (y1 - Math.max(0, y)));

  for (let py = Math.max(0, y); py < y1; py++) {
    for (let px = Math.max(0, x); px < x1; px++) {
      const i = (py * buf.width + px) * 4;
      const a = buf.data[i + 3];
      if (a === 0) continue;
      weightSum += a;
      r += buf.data[i] * a;
      g += buf.data[i + 1] * a;
      b += buf.data[i + 2] * a;
    }
  }

  if (weightSum === 0) return [0, 0, 0, 0];
  return [
    Math.round(r / weightSum),
    Math.round(g / weightSum),
    Math.round(b / weightSum),
    Math.min(255, Math.round(weightSum / total)),
  ];
}
