const { ipcMain } = require('electron');
const { loadPrinterPreference, savePrinterPreference } = require('../prefs');
const { printReceipt } = require('../printer');

function registerIpcHandlers() {
  ipcMain.handle('get-printers', async (event) => {
    const printers = await event.sender.getPrintersAsync();
    return printers;
  });

  ipcMain.handle('get-printer-preference', () => loadPrinterPreference());
  ipcMain.handle('set-printer-preference', (_, printerName) => {
    savePrinterPreference(printerName);
  });
  ipcMain.handle('print-receipt', () => printReceipt());
}

module.exports = { registerIpcHandlers };
