const { app, BrowserWindow } = require('electron');
const { createWindow } = require('./window');
const { registerIpcHandlers } = require('./ipc');

try {
  require('electron-reloader')(module, { ignore: /node_modules/ });
} catch (_) {}

registerIpcHandlers();

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
