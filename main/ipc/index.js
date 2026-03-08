const { ipcMain } = require('electron');
const { BACKEND_URL } = require('../config');
const { loadPrinterPreference, savePrinterPreference, loadBackendConfig, saveBackendConfig } = require('../prefs');
const { printReceipt } = require('../printer');
const { enqueue, getQueue } = require('../queue');
const { fetchPendingJobs, isPollingActive, markJobCancel, markJobSkipped, startBackendPolling, stopBackendPolling } = require('../services/backendPrintService');
const { getAllStatuses, setOrderStatus } = require('../orderStatusStore');

function registerIpcHandlers() {
  ipcMain.handle('get-printers', async (event) => {
    const printers = await event.sender.getPrintersAsync();
    return printers;
  });

  ipcMain.handle('get-printer-preference', () => loadPrinterPreference());
  ipcMain.handle('set-printer-preference', (_, printerName) => {
    savePrinterPreference(printerName);
  });
  ipcMain.handle('print-receipt', (_, payload) => printReceipt(payload));
  ipcMain.handle('enqueue-print-job', (_, payload) => enqueue(payload));
  ipcMain.handle('get-print-queue', () => getQueue());

  ipcMain.handle('get-backend-config', () => ({ ...loadBackendConfig(), backendUrl: BACKEND_URL }));
  ipcMain.handle('set-backend-config', async (_, config) => {
    saveBackendConfig(config);
    stopBackendPolling();
    await startBackendPolling((payload) => printReceipt(payload));
  });
  ipcMain.handle('get-backend-polling-active', () => isPollingActive());
  ipcMain.handle('fetch-backend-pending-jobs', async () => {
    try {
      const jobs = await fetchPendingJobs();
      const statuses = getAllStatuses();
      const terminal = ['printed', 'cancelled', 'failed', 'skipped'];
      const backendToPrint = (v) => (v === 'completed' ? 'printed' : v);
      const result = jobs.map((j) => {
        const idKey = j.id != null ? String(j.id) : '';
        const s = idKey ? statuses[idKey] : null;
        const backendStatus = j.status ? backendToPrint(String(j.status).toLowerCase()) : null;
        const useBackend = backendStatus && terminal.includes(backendStatus);
        const printStatus = useBackend ? backendStatus : (s ? s.status : 'pending');
        return { ...j, printStatus, printError: s && s.error, printedAt: s && s.at };
      });
      const dateTs = (j) => (j.date ? new Date(j.date).getTime() : 0);
      result.sort((a, b) => dateTs(b) - dateTs(a));
      return result;
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
  });
  ipcMain.handle('skip-order-in-queue', async (_, orderId) => {
    setOrderStatus(orderId, 'skipped');
    await markJobSkipped(orderId, 'skipped_by_user');
  });
}

module.exports = { registerIpcHandlers };
