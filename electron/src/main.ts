import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { app, BrowserWindow, ipcMain } from 'electron';

import { buildFurnitureCatalog } from '../../shared/assets/build.js';
import {
  decodeAllCharacters,
  decodeAllFloors,
  decodeAllFurniture,
  decodeAllWalls,
} from '../../shared/assets/loader.js';
import { AgentMonitor } from '../../terminal/src/monitor.js';

// ── Paths ─────────────────────────────────────────────────────────────────────

// __dirname = <abs>/pixel-agents/electron/dist/electron/src/
// Repo root  = 4 levels up (src/ → electron/ → dist/ → electron/ → pixel-agents/)
const REPO_ROOT = path.join(__dirname, '../../../../');
const WEBVIEW_DIST = path.join(REPO_ROOT, 'dist', 'webview', 'index.html');
const ASSETS_DIR = path.join(REPO_ROOT, 'webview-ui', 'public', 'assets');
const PRELOAD_PATH = path.join(__dirname, 'preload.js');
const LAYOUT_FILE = path.join(os.homedir(), '.pixel-agents', 'layout.json');

// ── Layout helpers ─────────────────────────────────────────────────────────────

function readLayout(): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(LAYOUT_FILE)) return null;
    return JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeLayout(layout: Record<string, unknown>): void {
  const dir = path.dirname(LAYOUT_FILE);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = LAYOUT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(layout, null, 2), 'utf-8');
    fs.renameSync(tmp, LAYOUT_FILE);
  } catch (err) {
    console.error('[electron] Failed to write layout:', err);
  }
}

function loadDefaultLayout(): Record<string, unknown> | null {
  try {
    let bestRev = 0;
    let bestPath: string | null = null;
    if (fs.existsSync(ASSETS_DIR)) {
      for (const f of fs.readdirSync(ASSETS_DIR)) {
        const m = /^default-layout-(\d+)\.json$/.exec(f);
        if (m) {
          const rev = parseInt(m[1], 10);
          if (rev > bestRev) {
            bestRev = rev;
            bestPath = path.join(ASSETS_DIR, f);
          }
        }
      }
      if (!bestPath) {
        const fallback = path.join(ASSETS_DIR, 'default-layout.json');
        if (fs.existsSync(fallback)) bestPath = fallback;
      }
    }
    if (bestPath) return JSON.parse(fs.readFileSync(bestPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    /* ignore */
  }
  return null;
}

// ── Window ─────────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let monitor: AgentMonitor | null = null;

function send(data: unknown): void {
  mainWindow?.webContents.send('main-to-webview', data);
}

async function loadAssets(): Promise<void> {
  console.log('[electron] Loading assets from:', ASSETS_DIR);
  try {
    // Characters
    const characters = decodeAllCharacters(ASSETS_DIR);
    send({ type: 'characterSpritesLoaded', characters });
    console.log(`[electron] Sent ${characters.length} character sprites`);

    // Floors
    const floorSprites = decodeAllFloors(ASSETS_DIR);
    send({ type: 'floorTilesLoaded', sprites: floorSprites });
    console.log(`[electron] Sent ${floorSprites.length} floor tile patterns`);

    // Walls
    const wallSets = decodeAllWalls(ASSETS_DIR);
    send({ type: 'wallTilesLoaded', sets: wallSets });
    console.log(`[electron] Sent ${wallSets.length} wall tile sets`);

    // Furniture
    const catalog = buildFurnitureCatalog(ASSETS_DIR);
    const spritesRecord = decodeAllFurniture(ASSETS_DIR, catalog);
    send({ type: 'furnitureAssetsLoaded', catalog, sprites: spritesRecord });
    console.log(`[electron] Sent ${catalog.length} furniture assets`);
  } catch (err) {
    console.error('[electron] Error loading assets:', err);
  }
}

function sendLayout(): void {
  const layout = readLayout() ?? loadDefaultLayout();
  if (layout && !readLayout()) {
    // Persist default so it can be edited
    writeLayout(layout);
  }
  send({ type: 'layoutLoaded', layout, wasReset: false });
}

function startMonitor(): void {
  monitor = new AgentMonitor();

  monitor.on('agentCreated', (agent) => {
    console.log(`[electron] Agent created: ${agent.id} (${agent.projectName})`);
    send({ type: 'agentCreated', id: agent.id });
  });

  monitor.on('agentRemoved', (id: number) => {
    console.log(`[electron] Agent removed: ${id}`);
    send({ type: 'agentClosed', id });
  });

  monitor.on(
    'agentEvent',
    ({ id, type, data }: { id: number; type: string; data?: Record<string, unknown> }) => {
      // Translate internal event types to the webview message protocol
      switch (type) {
        case 'agentStatus':
          send({ type: 'agentStatus', id, status: data?.status });
          break;
        case 'agentToolStart':
          send({ type: 'agentToolStart', id, toolId: data?.toolId, status: data?.status });
          break;
        case 'agentToolDone':
          send({ type: 'agentToolDone', id, toolId: data?.toolId });
          break;
        case 'agentToolsClear':
          send({ type: 'agentToolsClear', id });
          break;
        case 'agentToolPermission':
          send({ type: 'agentToolPermission', id });
          break;
        case 'agentToolPermissionClear':
          send({ type: 'agentToolPermissionClear', id });
          break;
      }
    },
  );

  monitor.start();
}

function sendExistingAgents(): void {
  if (!monitor) return;
  const agents = monitor.getAgents();
  const agentIds = agents.map((a) => a.id);
  send({
    type: 'existingAgents',
    agents: agentIds,
    agentMeta: {},
    folderNames: {},
  });
  // Send current statuses for any already-active agents
  for (const agent of agents) {
    if (agent.status !== 'idle') {
      send({ type: 'agentStatus', id: agent.id, status: agent.status });
    }
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Pixel Agents',
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (!fs.existsSync(WEBVIEW_DIST)) {
    const msg = `Webview not built. Run:\n  cd ${path.join(REPO_ROOT, 'webview-ui')} && npm run build`;
    console.error('[electron]', msg);
    mainWindow.loadURL(
      `data:text/html,<pre style="font-family:monospace;padding:2em;background:#1e1e2e;color:#cdd6f4">${msg}</pre>`,
    );
    return;
  }

  mainWindow.loadFile(WEBVIEW_DIST);
  mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC: webview → main ────────────────────────────────────────────────────────

ipcMain.on('webview-to-main', (_event, msg: Record<string, unknown>) => {
  if (!msg || typeof msg.type !== 'string') return;

  switch (msg.type) {
    case 'webviewReady':
      console.log('[electron] webviewReady — loading assets and sending state');
      loadAssets().then(() => {
        // existingAgents MUST arrive before layoutLoaded — the webview buffers
        // agents in pendingAgents[] and flushes them inside the layoutLoaded handler.
        sendExistingAgents();
        sendLayout();
        send({ type: 'settingsLoaded', soundEnabled: true, externalAssetDirectories: [] });
      });
      break;

    case 'saveLayout':
      if (msg.layout && typeof msg.layout === 'object') {
        writeLayout(msg.layout as Record<string, unknown>);
      }
      break;

    // No-op messages (VS Code-specific features not available in standalone)
    case 'openClaude':
    case 'focusAgent':
    case 'closeAgent':
    case 'saveAgentSeats':
    case 'setSoundEnabled':
    case 'exportLayout':
    case 'importLayout':
    case 'addExternalAssetDirectory':
    case 'removeExternalAssetDirectory':
    case 'openSessionsFolder':
      break;

    default:
      console.log('[electron] Unhandled webview message:', msg.type);
  }
});

// ── App lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  createWindow();
  startMonitor();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  monitor?.stop();
  if (process.platform !== 'darwin') app.quit();
});
