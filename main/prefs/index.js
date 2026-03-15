const fs = require('fs');
const { getPrefFilePath, DEFAULT_API_BASE_URL } = require('../config');

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
    apiBaseUrl: DEFAULT_API_BASE_URL,
    kitchenSecret: p.kitchenSecret || '',
    deviceId: p.deviceId || '',
    deviceSecret: p.deviceSecret || '',
    backendPollIntervalMs: p.backendPollIntervalMs || 5000
  };
}

function saveBackendConfig({ kitchenSecret, deviceId, deviceSecret, backendPollIntervalMs }) {
  const filePath = getPrefFilePath();
  try {
    const prefs = loadPrefs();
    if (kitchenSecret !== undefined && kitchenSecret !== null) {
      prefs.kitchenSecret = typeof kitchenSecret === 'string' ? kitchenSecret.trim() : String(kitchenSecret);
    }
    if (deviceId !== undefined && deviceId !== null) {
      prefs.deviceId = typeof deviceId === 'string' ? deviceId.trim() : String(deviceId);
    }
    if (deviceSecret !== undefined && deviceSecret !== null) {
      prefs.deviceSecret = typeof deviceSecret === 'string' ? deviceSecret.trim() : String(deviceSecret);
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
