const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function getPath() {
  return path.join(app.getPath('userData'), 'printing-paused.json');
}

function load() {
  try {
    const raw = fs.readFileSync(getPath(), 'utf8');
    const data = JSON.parse(raw);
    return Boolean(data.paused);
  } catch {
    return false;
  }
}

function save(paused) {
  try {
    fs.writeFileSync(getPath(), JSON.stringify({ paused: Boolean(paused) }, null, 0), 'utf8');
  } catch (err) {
    console.error('Failed to save printing paused state', err);
  }
}

function isPrintingPaused() {
  return load();
}

function setPrintingPaused(paused) {
  save(paused);
  return load();
}

module.exports = { isPrintingPaused, setPrintingPaused };
