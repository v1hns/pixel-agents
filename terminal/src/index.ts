#!/usr/bin/env node
/**
 * pixel-agents-terminal
 *
 * Renders the pixel-agents office in your terminal using true-color ANSI
 * half-block characters, powered by the actual PNG sprite assets.
 * Monitors all active Claude Code sessions concurrently.
 *
 * Usage (from repo root):
 *   npm run terminal:build && npm run terminal:start
 */

import { AgentMonitor } from './monitor';
import { Renderer } from './renderer';
import { loadAssets } from './assetLoader';
import { readLayout, findSeats } from './layoutReader';
import type { Assets, LayoutData } from './types';

let assets: Assets | null = null;
let layout: LayoutData = { version: 1, cols: 10, rows: 8, tiles: [], furniture: [] };
let seats: Array<{ col: number; row: number }> = [];

const monitor = new AgentMonitor();
const renderer = new Renderer({
  getAgents: () => monitor.getAgents(),
  getLayout: () => layout,
  getAssets: () => assets,
  getSeats: () => seats,
});

// Load layout immediately (sync)
layout = readLayout();
seats = findSeats(layout);

// Start rendering right away (shows loading screen until assets ready)
monitor.start();
renderer.start();

// Load assets async (PNGs can take a moment)
loadAssets()
  .then((a) => {
    assets = a;
    renderer.requestRender();
  })
  .catch((err) => {
    process.stderr.write(`Asset load error: ${err}\n`);
  });

monitor.on('agentCreated', () => renderer.requestRender());
monitor.on('agentRemoved', () => renderer.requestRender());
monitor.on('agentUpdated', () => renderer.requestRender());

// Quit on q / Ctrl-C
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (key: string) => {
  if (key === 'q' || key === '\u0003') {
    monitor.stop();
    renderer.stop();
    process.exit(0);
  }
});

process.on('SIGINT', () => {
  monitor.stop();
  renderer.stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  monitor.stop();
  renderer.stop();
  process.exit(0);
});
