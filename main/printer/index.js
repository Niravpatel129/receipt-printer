const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const electronPrinter = require('@thesusheer/electron-printer');
const { loadPrinterPreference } = require('../prefs');
const { buildReceipt } = require('./receipt');

const printerDriver = {
  getPrinters: () => electronPrinter.getPrinters().map(p => ({ ...p, attributes: ['RAW'] })),
  getPrinter: (name) => {
    const p = electronPrinter.getPrinter(name);
    if (!p) return null;
    return { ...p, status: p.status || 'IDLE' };
  },
  printDirect: (opts) => electronPrinter.printDirect({ ...opts, docname: opts.docname || 'Receipt' })
};

async function printReceipt() {
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
  buildReceipt(printer);
  await printer.execute();
  return { ok: true };
}

module.exports = { printerDriver, printReceipt };
