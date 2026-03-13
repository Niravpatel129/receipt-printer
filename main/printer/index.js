const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');
const { loadPrinterPreference } = require('../prefs');
const { buildReceipt } = require('./receipt');
const logger = require('../logger');

const SETTLE_MS = 3000;
const PRINT_TIMEOUT_MS = 60000;

function createMockDriver() {
  return {
    getPrinters: () => [{ name: 'Mock Printer', displayName: 'Mock Printer (development)', attributes: ['RAW'] }],
    getPrinter: (name) => ({ name, displayName: name, status: 'IDLE' }),
    printDirect: (opts) => {
      const size = opts.data ? opts.data.length : 0;
      logger.info('Mock printer print job', { size });
      setTimeout(() => (opts.success && opts.success('mock-job')), 0);
    }
  };
}

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(message || `Print timed out after ${ms / 1000}s`)),
      ms,
    );
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function wrapPrintDirect(printDirect) {
  return (opts) => {
    const realSuccess = opts.success;
    const realError = opts.error;
    let settled = false;
    let timer = null;
    opts.success = (jobID) => {
      if (settled) return;
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (realSuccess) realSuccess(jobID);
      }, SETTLE_MS);
    };
    opts.error = (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (realError) realError(err);
    };
    printDirect(opts);
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
      printDirect: wrapPrintDirect((opts) =>
        electronPrinter.printDirect({ ...opts, docname: opts.docname || 'Receipt' })
      )
    }
  : createMockDriver();

async function printReceipt(payload = null) {
  const printerName = loadPrinterPreference();
  if (!printerName) {
    const msg = 'No printer selected. Pick a printer from the dropdown first.';
    logger.warn(msg);
    throw new Error(msg);
  }
  const selectedPrinter = printerDriver.getPrinter(printerName);
  if (selectedPrinter && selectedPrinter.status && String(selectedPrinter.status) !== 'IDLE') {
    const msg = `Printer is not ready (${selectedPrinter.status}). Check for paper, jams, or offline state.`;
    logger.warn(msg, { printerName, status: selectedPrinter.status });
    throw new Error(msg);
  }
  const printer = new ThermalPrinter({
    type: PrinterTypes.EPSON,
    width: 42,
    interface: 'printer:' + printerName,
    driver: printerDriver,
  });
  logger.info('Starting print', { printerName, hasPayload: Boolean(payload) });
  buildReceipt(printer, payload);
  await withTimeout(
    printer.execute(),
    PRINT_TIMEOUT_MS,
    'Printer did not finish in time. It may be out of paper, jammed, or offline.',
  );
  logger.info('Print finished', { printerName });
  return { ok: true };
}

module.exports = { printerDriver, printReceipt };
