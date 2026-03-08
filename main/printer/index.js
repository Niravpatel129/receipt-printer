const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const { loadPrinterPreference } = require('../prefs');
const { buildReceipt } = require('./receipt');

function createMockDriver() {
  return {
    getPrinters: () => [{ name: 'Mock Printer', displayName: 'Mock Printer (development)', attributes: ['RAW'] }],
    getPrinter: (name) => ({ name, displayName: name, status: 'IDLE' }),
    printDirect: (opts) => {
      const size = opts.data ? opts.data.length : 0;
      console.log('[Mock printer] Print job:', size, 'bytes (development mode)');
    }
  };
}

let electronPrinter;
try {
  electronPrinter = require('@thesusheer/electron-printer');
} catch (_) {
  electronPrinter = null;
}

const printerDriver = electronPrinter
  ? {
      getPrinters: () => electronPrinter.getPrinters().map(p => ({ ...p, attributes: ['RAW'] })),
      getPrinter: (name) => {
        const p = electronPrinter.getPrinter(name);
        if (!p) return null;
        return { ...p, status: p.status || 'IDLE' };
      },
      printDirect: (opts) => electronPrinter.printDirect({ ...opts, docname: opts.docname || 'Receipt' })
    }
  : createMockDriver();

async function printReceipt(payload = null) {
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
  buildReceipt(printer, payload);
  await printer.execute();
  return { ok: true };
}

module.exports = { printerDriver, printReceipt };
