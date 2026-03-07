const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('printerApi', {
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  getPrinterPreference: () => ipcRenderer.invoke('get-printer-preference'),
  setPrinterPreference: (name) => ipcRenderer.invoke('set-printer-preference', name),
  printReceipt: () => ipcRenderer.invoke('print-receipt')
});
