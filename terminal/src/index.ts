#!/usr/bin/env node
/**
 * pixel-agents-terminal
 *
 * A terminal-based pixel art office dashboard for concurrent Claude Code agents.
 * Monitors ALL active Claude Code sessions across ~/.claude/projects/ and displays
 * each as an animated pixel art character, reflecting what they're currently doing.
 *
 * Usage:
 *   npx pixel-agents-terminal
 *   node dist/index.js
 */

import { AgentMonitor } from './monitor';
import { Renderer } from './renderer';

const monitor = new AgentMonitor();
const renderer = new Renderer(() => monitor.getAgents());

monitor.on('agentCreated', () => renderer.requestRender());
monitor.on('agentRemoved', () => renderer.requestRender());
monitor.on('agentUpdated', () => renderer.requestRender());

monitor.start();
renderer.start();

// Graceful shutdown
process.on('SIGINT',  () => { monitor.stop(); renderer.stop(); process.exit(0); });
process.on('SIGTERM', () => { monitor.stop(); renderer.stop(); process.exit(0); });
