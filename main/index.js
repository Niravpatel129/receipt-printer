const { app, BrowserWindow } = require('electron');
const { createWindow } = require('./window');
const { registerIpcHandlers } = require('./ipc');
const { startPolling } = require('./queue');
const { printReceipt } = require('./printer');
const { startBackendPolling, stopBackendPolling } = require('./services/backendPrintService');

try {
  require('electron-reloader')(module, { ignore: /node_modules/ });
} catch (_) {}

process.title = 'Receipt Printer';
app.setName('Receipt Printer');
registerIpcHandlers();

app.whenReady().then(async () => {
  createWindow();
  startPolling((payload) => printReceipt(payload), 2000);
  await startBackendPolling((payload) => printReceipt(payload));
});

app.on('before-quit', () => {
  stopBackendPolling();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
