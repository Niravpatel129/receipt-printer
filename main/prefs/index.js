const fs = require('fs');
const { PREF_FILE } = require('../config');

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

function loadBackendConfig() {
  const p = loadPrefs();
  return {
    kitchenSecret: p.kitchenSecret || '',
    backendPollIntervalMs: p.backendPollIntervalMs || 5000
  };
}

function saveBackendConfig({ kitchenSecret, backendPollIntervalMs }) {
  try {
    const prefs = loadPrefs();
    if (kitchenSecret !== undefined) prefs.kitchenSecret = kitchenSecret;
    if (backendPollIntervalMs !== undefined) prefs.backendPollIntervalMs = backendPollIntervalMs;
    fs.writeFileSync(PREF_FILE, JSON.stringify(prefs), 'utf8');
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
