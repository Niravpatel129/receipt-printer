const { app } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createWindow } = require('./window');
const { registerIpcHandlers } = require('./ipc');
const { startPolling } = require('./queue');
const { printReceipt } = require('./printer');
const { startBackendPolling, stopBackendPolling } = require('./services/backendPrintService');
const { isPortableWindowsBuild, checkForUpdates: checkPortableUpdates } = require('./services/portableUpdater');
const { configureAutoUpdater } = require('./updater/feed');
const { startOvernightUpdateCheck } = require('./updater/overnightCheck');
const { record: recordUpdateStatus } = require('./updater/updateStatusStore');
const logger = require('./logger');

try {
  require('electron-reloader')(module, { ignore: /node_modules/ });
} catch (_) {}

process.title = 'Receipt Printer';
app.setName('Receipt Printer');

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  if (process.platform === 'darwin' || process.platform === 'win32') {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: false,
    });
  }

  registerIpcHandlers();

  let mainWindow = null;
  let scheduledOvernightUpdateInterval = null;

  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      return;
    }
    mainWindow = createWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  });

  function setupAutoUpdater(win) {
    const send = (data) => {
      recordUpdateStatus(data);
      if (!win.isDestroyed()) win.webContents.send('update-status', data);
    };
    if (isPortableWindowsBuild()) {
      checkPortableUpdates(send).catch((err) => {
        logger.error('Portable startup update check failed', { error: err?.message });
        send({ state: 'error', message: err?.message || 'Update check failed' });
      });
      return startOvernightUpdateCheck(() => {
        if (win.isDestroyed()) return;
        checkPortableUpdates(send).catch((err) => {
          logger.error('Overnight portable update check failed', { error: err?.message });
        });
      });
    }
    try {
      configureAutoUpdater(autoUpdater);
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
    return startOvernightUpdateCheck(() => {
      if (win.isDestroyed()) return;
      autoUpdater.checkForUpdates().catch((err) => {
        logger.error('Overnight update check failed', { error: err?.message });
      });
    });
  }

  app.whenReady().then(async () => {
    logger.info('App starting');
    mainWindow = createWindow();
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    startPolling((payload) => printReceipt(payload), 2000);
    await startBackendPolling((payload) => printReceipt(payload));
    if (app.isPackaged) {
      scheduledOvernightUpdateInterval = setupAutoUpdater(mainWindow);
    }
    logger.info('App ready');
  });

  app.on('before-quit', () => {
    if (scheduledOvernightUpdateInterval) {
      clearInterval(scheduledOvernightUpdateInterval);
      scheduledOvernightUpdateInterval = null;
    }
    stopBackendPolling();
    logger.info('App before-quit');
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}
