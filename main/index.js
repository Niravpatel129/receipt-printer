const path = require('path');
const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createWindow } = require('./window');
const { registerIpcHandlers } = require('./ipc');
const { startPolling } = require('./queue');
const { printReceipt } = require('./printer');
const { startBackendPolling, stopBackendPolling } = require('./services/backendPrintService');
const logger = require('./logger');

try {
  require('electron-reloader')(module, { ignore: /node_modules/ });
} catch (_) {}

process.title = 'Receipt Printer';
app.setName('Receipt Printer');
if (process.platform === 'darwin' || process.platform === 'win32') {
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,
  });
}
registerIpcHandlers();

let mainWindow = null;
let tray = null;
let isQuitting = false;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

function getTrayIcon() {
  const iconPath = path.join(__dirname, '..', 'assets', 'tray-icon.png');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVQ4T2NkYGD4z0ABYBzVMKoBBg2jGkY1jGoY1TCqYVQDRA0MDP8ZGBj+MzAwMACJQQYAAQAA/wgL/0F1pAAAAABJRU5ErkJggg==');
  }
  if (process.platform === 'darwin') icon.setTemplateImage(true);
  return icon;
}

function createTray(win) {
  tray = new Tray(getTrayIcon());
  tray.setToolTip('Receipt Printer');
  tray.on('click', () => {
    win.show();
    win.focus();
  });
  tray.on('right-click', () => {
    tray.popUpContextMenu();
  });
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
}

function configureAutoUpdaterFeed() {
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'Niravpatel129',
    repo: 'receipt-printer',
  });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
}

function setupAutoUpdater(win) {
  const send = (data) => {
    if (!win.isDestroyed()) win.webContents.send('update-status', data);
  };
  try {
    configureAutoUpdaterFeed();
  } catch (err) {
    logger.error('Failed to configure auto-updater feed', { error: err?.message });
  }
  autoUpdater.on('error', (err) => {
    logger.error('Auto-updater error', { error: err?.message });
    send({ state: 'error', message: err?.message });
  });
  autoUpdater.on('checking-for-update', () => send({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    logger.info('Update available', { version: info.version });
    send({ state: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', () => send({ state: 'up-to-date' }));
  autoUpdater.on('download-progress', (p) => send({ state: 'downloading', progress: p.percent }));
  autoUpdater.on('update-downloaded', (info) => {
    logger.info('Update downloaded', { version: info.version });
    send({ state: 'downloaded', version: info.version });
  });
  autoUpdater.checkForUpdates().catch((err) => {
    logger.error('Initial update check failed', { error: err?.message });
  });
}

app.whenReady().then(async () => {
  logger.info('App starting');
  mainWindow = createWindow();
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  createTray(mainWindow);
  startPolling((payload) => printReceipt(payload), 2000);
  await startBackendPolling((payload) => printReceipt(payload));
  if (app.isPackaged) setupAutoUpdater(mainWindow);
  logger.info('App ready');
});

app.on('before-quit', () => {
  isQuitting = true;
  stopBackendPolling();
  logger.info('App before-quit');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow();
    mainWindow.on('close', (event) => {
      if (!isQuitting) {
        event.preventDefault();
        mainWindow.hide();
      }
    });
    createTray(mainWindow);
  }
});
