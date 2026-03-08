const { BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 600,
    title: 'Receipt Printer',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', '..', 'preload.js')
    }
  });
  win.loadFile(path.join(__dirname, '..', '..', 'index.html'));
  return win;
}

module.exports = { createWindow };
