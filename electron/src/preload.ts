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
// webview-ui/src/vscodeApi.ts listens for window 'message' events in vscode mode.
ipcRenderer.on('main-to-webview', (_event, data: unknown) => {
  window.dispatchEvent(new MessageEvent('message', { data }));
});
