const { ipcMain } = require('electron');
const { BACKEND_URL } = require('../config');
const { loadPrinterPreference, savePrinterPreference, loadBackendConfig, saveBackendConfig } = require('../prefs');
const { printReceipt } = require('../printer');
const { enqueue, getQueue } = require('../queue');
const { fetchPendingJobs } = require('../services/backendPrintService');

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
  ipcMain.handle('set-backend-config', (_, config) => saveBackendConfig(config));
  ipcMain.handle('fetch-backend-pending-jobs', async () => {
    try {
      return await fetchPendingJobs();
    } catch (e) {
      return [];
    }
  });
}

module.exports = { registerIpcHandlers };
