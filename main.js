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

function drawDashed(printer) {
  printer.drawLine('-');
}

function buildFakeReceipt(printer) {
  printer.alignCenter();
  printer.setTextDoubleHeight();
  printer.println('PIZZA DEPOT');
  printer.setTextNormal();
  printer.println('975 PETER ROBERTSON BLVD.');
  printer.println('BRAMPTON, ON');
  printer.newLine();
  printer.alignLeft();
  printer.println('ORDER: #0411 FOR MARKO');
  printer.println('DATE: FEB 7, 2026');
  drawDashed(printer);
  printer.tableCustom([
    { text: 'NUM ITEM', align: 'LEFT', width: 0.7, bold: true },
    { text: 'AMT ($)', align: 'RIGHT', width: 0.3, bold: true }
  ]);
  drawDashed(printer);
  printer.bold(true);
  printer.leftRight('01 LARGE PIZZA', '22.99');
  printer.bold(false);
  printer.println('   TANDOORI PANEER');
  printer.println('   ROASTED RED PEPPERS');
  printer.println('   GREEN PEPPERS');
  printer.println('   ONIONS');
  printer.println('   GINGER');
  printer.println('   GREEN CHILLI');
  printer.println('   CORIANDER');
  printer.println('   CHILLI FLAKES');
  printer.bold(true);
  printer.leftRight('02 CREAMY GARLIC DIP', '1.49');
  printer.leftRight('03 PEPSI CAN', '1.99');
  printer.bold(false);
  drawDashed(printer);
  printer.leftRight('ITEM COUNT', '3');
  printer.bold(true);
  printer.leftRight('TOTAL', '$ 26.47');
  printer.bold(false);
  drawDashed(printer);
  printer.println('CARD #: **** **** **** 9711');
  printer.println('AUTH #: 867324');
  printer.println('USERID: MARKO K');
  printer.newLine();
  printer.alignCenter();
  printer.println('ENJOY YOUR MEAL!');
  printer.newLine();
  printer.code128('0411', { height: 50, text: 0 });
  printer.newLine();
  printer.println('PIZZADEPOT.CA');
  printer.newLine();
  printer.alignCenter();
  printer.println('*');
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
