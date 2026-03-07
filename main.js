const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');

try {
  require('electron-reloader')(module, { ignore: /node_modules/ });
} catch (_) {}

const PREF_FILE = path.join(app.getPath('userData'), 'printer-preference.json');
const electronPrinter = require('@thesusheer/electron-printer');
const printerDriver = {
  getPrinters: () => electronPrinter.getPrinters().map(p => ({ ...p, attributes: ['RAW'] })),
  getPrinter: (name) => {
    const p = electronPrinter.getPrinter(name);
    if (!p) return null;
    return { ...p, status: p.status || 'IDLE' };
  },
  printDirect: (opts) => electronPrinter.printDirect({ ...opts, docname: opts.docname || 'Receipt' })
};

function loadPrefs() {
  try {
    const data = fs.readFileSync(PREF_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function loadPrinterPreference() {
  return loadPrefs().printerName || null;
}

function savePrinterPreference(printerName) {
  try {
    const prefs = loadPrefs();
    prefs.printerName = printerName;
    fs.writeFileSync(PREF_FILE, JSON.stringify(prefs), 'utf8');
  } catch (err) {
    console.error('Failed to save printer preference', err);
  }
}

ipcMain.handle('get-printers', async (event) => {
  const printers = await event.sender.getPrintersAsync();
  return printers;
});

ipcMain.handle('get-printer-preference', () => loadPrinterPreference());
ipcMain.handle('set-printer-preference', (_, printerName) => {
  savePrinterPreference(printerName);
});

function buildFakeReceipt(printer) {
  printer.alignCenter();
  printer.setTextDoubleHeight();
  printer.println('FAKE RECEIPT');
  printer.setTextNormal();
  printer.newLine();
  printer.drawLine();
  printer.alignLeft();
  printer.println('Date: ' + new Date().toLocaleString());
  printer.println('Order #: 0001');
  printer.drawLine();
  printer.tableCustom([
    { text: 'Item', align: 'LEFT', width: 0.5 },
    { text: 'Qty', align: 'CENTER', width: 0.25 },
    { text: 'Price', align: 'RIGHT', width: 0.25 }
  ]);
  printer.tableCustom([
    { text: 'Coffee', align: 'LEFT', width: 0.5 },
    { text: '2', align: 'CENTER', width: 0.25 },
    { text: '$5.00', align: 'RIGHT', width: 0.25 }
  ]);
  printer.tableCustom([
    { text: 'Sandwich', align: 'LEFT', width: 0.5 },
    { text: '1', align: 'CENTER', width: 0.25 },
    { text: '$8.50', align: 'RIGHT', width: 0.25 }
  ]);
  printer.drawLine();
  printer.leftRight('Total:', '$18.50');
  printer.drawLine();
  printer.newLine();
  printer.alignCenter();
  printer.println('Thank you!');
  printer.newLine();
  printer.cut();
}

ipcMain.handle('print-receipt', async () => {
  const printerName = loadPrinterPreference();
  if (!printerName) {
    throw new Error('No printer selected. Pick a printer from the dropdown first.');
  }
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    width: 42,
    interface: 'printer:' + printerName,
    driver: printerDriver
  });
  buildFakeReceipt(printer);
  await printer.execute();
  return { ok: true };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
