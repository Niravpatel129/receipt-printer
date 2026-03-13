const os = require('os');
const { app } = require('electron');
const { postLogs } = require('./services/backendPrintService');

function buildLogEntry(level, message, meta) {
  return {
    level,
    message: String(message),
    meta: meta || {},
    appVersion: app.getVersion ? app.getVersion() : null,
    platform: process.platform,
    release: os.release(),
    timestamp: new Date().toISOString(),
  };
}

async function log(level, message, meta) {
  const entry = buildLogEntry(level, message, meta);
  try {
    await postLogs(entry);
  } catch (_) {}
}

function info(message, meta) {
  console.log('[INFO]', message, meta || '');
  log('info', message, meta);
}

function warn(message, meta) {
  console.warn('[WARN]', message, meta || '');
  log('warn', message, meta);
}

function error(message, meta) {
  console.error('[ERROR]', message, meta || '');
  log('error', message, meta);
}

module.exports = {
  info,
  warn,
  error,
  log,
};

