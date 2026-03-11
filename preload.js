const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('printerApi', {
  getPrinters: () => ipcRenderer.invoke('get-printers'),
  getPrinterPreference: () => ipcRenderer.invoke('get-printer-preference'),
  setPrinterPreference: (name) => ipcRenderer.invoke('set-printer-preference', name),
  printReceipt: (payload) => ipcRenderer.invoke('print-receipt', payload),
  enqueuePrintJob: (payload) => ipcRenderer.invoke('enqueue-print-job', payload),
  getPrintQueue: () => ipcRenderer.invoke('get-print-queue'),
  getBackendConfig: () => ipcRenderer.invoke('get-backend-config'),
  setBackendConfig: (config) => ipcRenderer.invoke('set-backend-config', config),
  fetchBackendPendingJobs: () => ipcRenderer.invoke('fetch-backend-pending-jobs'),
  getBackendPollingActive: () => ipcRenderer.invoke('get-backend-polling-active'),
  getBackendConnectionState: () => ipcRenderer.invoke('get-backend-connection-state'),
  setOrderPrintStatus: (orderId, status, error) => ipcRenderer.invoke('set-order-print-status', orderId, status, error),
  cancelOrderInQueue: (orderId) => ipcRenderer.invoke('cancel-order-in-queue', orderId),
  skipOrderInQueue: (orderId) => ipcRenderer.invoke('skip-order-in-queue', orderId),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  onUpdateStatus: (cb) => ipcRenderer.on('update-status', (_, data) => cb(data)),
  offUpdateStatus: () => ipcRenderer.removeAllListeners('update-status'),
});
