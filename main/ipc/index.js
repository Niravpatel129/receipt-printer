const fs = require('fs');
const { ipcMain, app } = require('electron');
const { autoUpdater } = require('electron-updater');
const { loadPrinterPreference, savePrinterPreference, loadBackendConfig, saveBackendConfig } = require('../prefs');
const { printReceipt } = require('../printer');
const { enqueue, getQueue } = require('../queue');
const {
  fetchPendingJobs,
  fetchHistoryJobs,
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

const TERMINAL_STATUSES = ['printed', 'cancelled', 'failed', 'skipped'];

function computeUiPrintStatus(backendStatus, localStatus) {
  const b = backendStatus ? String(backendStatus).toLowerCase() : null;
  const l = localStatus ? String(localStatus).toLowerCase() : null;
  if (TERMINAL_STATUSES.includes(l)) return l;
  if (l === 'printing' || l === 'pending') return l;
  if (TERMINAL_STATUSES.includes(b)) return b;
  return 'pending';
}

function registerIpcHandlers() {
  ipcMain.handle('get-app-version', () => app.getVersion());

  ipcMain.handle('check-for-updates', async (event) => {
    if (!app.isPackaged) {
      event.sender.send('update-status', { state: 'error', message: 'Not available in development builds' });
      return;
    }
    autoUpdater.checkForUpdates().catch(() => {});
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
  ipcMain.handle('set-order-print-status', (_, orderId, status, error) => {
    setOrderStatus(orderId, status, error);
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
