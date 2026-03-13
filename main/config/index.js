const path = require('path');
const { app } = require('electron');

function getPrefFilePath() {
  return path.join(app.getPath('userData'), 'printer-preference.json');
}

function getOrderStatusFilePath() {
  return path.join(app.getPath('userData'), 'print-order-status.json');
}

function getLogFilePath() {
  return path.join(app.getPath('userData'), 'printer-log.jsonl');
}

// Default API base URL
const DEFAULT_API_BASE_URL = 'https://pizza-depot-backend-91ae077a284d.herokuapp.com';

module.exports = { getPrefFilePath, getOrderStatusFilePath, getLogFilePath, DEFAULT_API_BASE_URL };
