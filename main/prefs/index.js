const fs = require('fs');
const { getPrefFilePath } = require('../config');

function loadPrefs() {
  const filePath = getPrefFilePath();
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function loadPrinterPreference() {
  return loadPrefs().printerName || null;
}

function savePrinterPreference(printerName) {
  const filePath = getPrefFilePath();
  try {
    const prefs = loadPrefs();
    prefs.printerName = printerName;
    fs.writeFileSync(filePath, JSON.stringify(prefs), 'utf8');
  } catch (err) {
    console.error('Failed to save printer preference', err);
  }
}

function loadBackendConfig() {
  const p = loadPrefs();
  return {
    kitchenSecret: p.kitchenSecret || '',
    backendPollIntervalMs: p.backendPollIntervalMs || 5000
  };
}

function saveBackendConfig({ kitchenSecret, backendPollIntervalMs }) {
  const filePath = getPrefFilePath();
  try {
    const prefs = loadPrefs();
    if (kitchenSecret !== undefined && kitchenSecret !== null) {
      prefs.kitchenSecret = typeof kitchenSecret === 'string' ? kitchenSecret.trim() : String(kitchenSecret);
    }
    if (backendPollIntervalMs !== undefined) prefs.backendPollIntervalMs = Number(backendPollIntervalMs) || 5000;
    fs.writeFileSync(filePath, JSON.stringify(prefs), 'utf8');
  } catch (err) {
    console.error('Failed to save backend config', err);
  }
}

module.exports = {
  loadPrefs,
  loadPrinterPreference,
  savePrinterPreference,
  loadBackendConfig,
  saveBackendConfig
};
