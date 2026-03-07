const path = require('path');
const { app } = require('electron');

const PREF_FILE = path.join(app.getPath('userData'), 'printer-preference.json');

module.exports = { PREF_FILE };
