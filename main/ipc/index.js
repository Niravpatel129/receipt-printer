const fs = require('fs');
const { ipcMain, app } = require('electron');
const { autoUpdater } = require('electron-updater');
const { loadPrinterPreference, savePrinterPreference, loadBackendConfig, saveBackendConfig } = require('../prefs');
const { printReceipt } = require('../printer');
const { enqueue, getQueue } = require('../queue');
const { isPortableWindowsBuild, checkForUpdates: checkPortableUpdates, installDownloadedUpdate } = require('../services/portableUpdater');
const { configureAutoUpdater } = require('../updater/feed');
const { record: recordUpdateStatus, get: getLastUpdateStatus } = require('../updater/updateStatusStore');
const {
  fetchPendingJobs,
  fetchHistoryJobs,
  fetchOrders,
  fetchClientInfo,
  fetchClientInfoState,
  markJobComplete,
  markOrderPrinted,
  getConnectionState,
  isPollingActive,
  markJobCancel,
  markJobSkipped,
  startBackendPolling,
  stopBackendPolling,
} = require('../services/backendPrintService');
const { getAllStatuses, setOrderStatus } = require('../orderStatusStore');
const { getLogFilePath } = require('../config');
const { isPrintingPaused, setPrintingPaused } = require('../printingPaused');
const logger = require('../logger');

const TERMINAL_STATUSES = ['printed', 'completed', 'cancelled', 'failed', 'skipped'];

function computeUiPrintStatus(backendStatus, localStatus) {
  let b = backendStatus ? String(backendStatus).toLowerCase() : null;
  if (b === 'canceled') b = 'cancelled';
  const l = localStatus ? String(localStatus).toLowerCase() : null;
  if (l === 'printing' || l === 'pending') return l;
  if (TERMINAL_STATUSES.includes(b)) return b;
  if (TERMINAL_STATUSES.includes(l)) return l;
  if (b === 'printed' || b === 'complete') return l === 'printed' ? 'printed' : 'completed';
  return 'pending';
}

function registerIpcHandlers() {
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('get-last-update-status', () => getLastUpdateStatus());

  ipcMain.handle('check-for-updates', async (event) => {
    if (!app.isPackaged) {
      event.sender.send('update-status', { state: 'error', message: 'Not available in development builds' });
      return;
    }
    if (isPortableWindowsBuild()) {
      try {
        const result = await checkPortableUpdates((data) => {
          recordUpdateStatus(data);
          event.sender.send('update-status', data);
        });
        if (result?.updated) {
          try {
            recordUpdateStatus({ state: 'installing', version: result.latestVersion });
            event.sender.send('update-status', { state: 'installing', version: result.latestVersion });
            installDownloadedUpdate();
          } catch (err) {
            logger.error('Portable auto-install failed after manual check', { error: err?.message });
            event.sender.send('update-status', {
              state: 'error',
              message: err?.message || 'Auto-install failed. Use Install & Restart to try again.',
              canInstall: true,
              version: result.latestVersion,
            });
          }
        }
      } catch (err) {
        logger.error('Portable manual update check failed', { error: err?.message });
        event.sender.send('update-status', { state: 'error', message: err?.message || 'Update check failed' });
      }
      return;
    }
    try {
      configureAutoUpdater(autoUpdater);
    } catch (_) {}
    autoUpdater.checkForUpdates().catch((err) => {
      logger.error('Manual update check failed', { error: err?.message });
      event.sender.send('update-status', { state: 'error', message: err?.message || 'Update check failed' });
    });
  });

  ipcMain.handle('install-update', () => {
    try {
      if (isPortableWindowsBuild()) {
        installDownloadedUpdate();
        return { ok: true };
      }
      logger.info('User triggered install-update, quitting and installing');
      autoUpdater.quitAndInstall(true, true);
      return { ok: true };
    } catch (err) {
      logger.error('install-update failed', { error: err?.message });
      throw new Error(err?.message || 'Failed to install update');
    }
  });

  ipcMain.handle('get-printers', async (event) => {
    const printers = await event.sender.getPrintersAsync();
    logger.info('IPC get-printers', { count: printers.length });
    return printers;
  });

  ipcMain.handle('get-printer-preference', () => loadPrinterPreference());
  ipcMain.handle('set-printer-preference', (_, printerName) => {
    savePrinterPreference(printerName);
    logger.info('Printer preference set', { printerName });
  });
  ipcMain.handle('print-receipt', async (_, payload) => {
    logger.info('IPC print-receipt');
    return printReceipt(payload);
  });
  ipcMain.handle('enqueue-print-job', (_, payload) => {
    const id = enqueue(payload);
    logger.info('IPC enqueue-print-job', { jobId: id });
    return id;
  });
  ipcMain.handle('get-print-queue', () => getQueue());
  ipcMain.handle('get-printing-paused', () => isPrintingPaused());
  ipcMain.handle('set-printing-paused', (_, paused) => setPrintingPaused(paused));

  ipcMain.handle('get-backend-config', () => loadBackendConfig());
  ipcMain.handle('set-backend-config', async (_, config) => {
    saveBackendConfig(config);
    stopBackendPolling();
    await startBackendPolling((payload) => printReceipt(payload));
    logger.info('Backend config updated');
  });
  ipcMain.handle('get-backend-polling-active', () => isPollingActive());
  ipcMain.handle('get-backend-connection-state', () => getConnectionState());
  ipcMain.handle('fetch-backend-pending-jobs', async () => {
    try {
      const jobs = await fetchPendingJobs();
      const statuses = getAllStatuses();
      const result = jobs.map((j) => {
        const idKey = j.id != null ? String(j.id) : '';
        const s = idKey ? statuses[idKey] : null;
        const backendStatus = j.printStatus ? String(j.printStatus).toLowerCase() : null;
        const localStatus = s && s.status ? String(s.status).toLowerCase() : null;
        const printStatus = computeUiPrintStatus(backendStatus, localStatus);
        return { ...j, printStatus, printError: s && s.error, printedAt: s && s.at };
      });
      const dateTs = (j) => (j.date ? new Date(j.date).getTime() : 0);
      result.sort((a, b) => dateTs(b) - dateTs(a));
      return result;
    } catch (e) {
      throw { status: e.response?.status, message: e.response?.data?.message || e.message || 'Request failed' };
    }
  });
  ipcMain.handle('fetch-backend-history-jobs', async (_, { limit = 20, page = 1 } = {}) => {
    try {
      const jobs = await fetchHistoryJobs(limit, page);
      return jobs;
    } catch (e) {
      throw { status: e.response?.status, message: e.response?.data?.message || e.message || 'Request failed' };
    }
  });
  ipcMain.handle('fetch-backend-orders', async (_, { limit = 50, since = null, status = null } = {}) => {
    try {
      return await fetchOrders(limit, since || undefined, status || undefined);
    } catch (e) {
      throw { status: e.response?.status, message: e.response?.data?.message || e.message || 'Request failed' };
    }
  });
  ipcMain.handle('get-backend-client', async () => {
    try {
      return await fetchClientInfo();
    } catch (e) {
      return null;
    }
  });
  ipcMain.handle('get-backend-client-state', async () => {
    try {
      return await fetchClientInfoState();
    } catch (e) {
      return {
        client: null,
        stale: false,
        error: e?.message || 'Failed to load client',
        reason: 'request_failed',
        retryable: true,
      };
    }
  });
  ipcMain.handle('set-order-print-status', (_, orderId, status, error) => {
    setOrderStatus(orderId, status, error);
  });
  ipcMain.handle('mark-backend-job-complete', async (_, { jobId, orderId }) => {
    if (!jobId) return;
    await markJobComplete(jobId);
    if (orderId) {
      await markOrderPrinted(orderId);
    }
  });
  ipcMain.handle('cancel-order-in-queue', async (_, orderId) => {
    setOrderStatus(orderId, 'cancelled');
    await markJobCancel(orderId);
    logger.info('IPC cancel-order-in-queue', { orderId });
  });
  ipcMain.handle('skip-order-in-queue', async (_, orderId) => {
    setOrderStatus(orderId, 'skipped');
    await markJobSkipped(orderId, 'skipped_by_user');
    logger.info('IPC skip-order-in-queue', { orderId });
  });

  ipcMain.handle('get-local-logs', () => {
    try {
      return fs.readFileSync(getLogFilePath(), 'utf8');
    } catch {
      return '';
    }
  });
}

module.exports = { registerIpcHandlers };
