import { contextBridge, ipcRenderer } from 'electron';

// Expose acquireVsCodeApi so the webview thinks it's running inside VS Code.
// This switches webview/src/runtime.ts to 'vscode' mode, disabling browserMock
// and activating the real IPC path.
contextBridge.exposeInMainWorld('acquireVsCodeApi', () => ({
  postMessage: (msg: unknown) => ipcRenderer.send('webview-to-main', msg),
  getState: () => ({}),
  setState: (_state: unknown) => {},
}));

// Forward messages from main process → webview window event listener.
// window.postMessage is used (not dispatchEvent) because it reliably crosses
// Electron's contextIsolation boundary and the renderer's addEventListener
// receives it correctly.
ipcRenderer.on('main-to-webview', (_event, data: unknown) => {
  window.postMessage(data, '*');
});
