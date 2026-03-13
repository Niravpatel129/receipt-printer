const fs = require('fs');
const { getLogFilePath } = require('./config');

function appendLocalLog(entry) {
  try {
    fs.appendFileSync(getLogFilePath(), JSON.stringify(entry) + '\n', 'utf8');
  } catch (_) {}
}

module.exports = { appendLocalLog };

