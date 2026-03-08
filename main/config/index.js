const path = require('path');
const { app } = require('electron');

const PREF_FILE = path.join(app.getPath('userData'), 'printer-preference.json');
const BACKEND_URL = 'https://pizza-depot-backend-91ae077a284d.herokuapp.com';

module.exports = { PREF_FILE, BACKEND_URL };
