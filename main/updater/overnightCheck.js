const logger = require('../logger');

const OVERNIGHT_START_HOUR = 2;
const OVERNIGHT_END_HOUR = 6;

function isOvernightWindow() {
  const h = new Date().getHours();
  return h >= OVERNIGHT_START_HOUR && h < OVERNIGHT_END_HOUR;
}

function startOvernightUpdateCheck(runCheck) {
  let lastCheckDate = null;
  const intervalMs = 30 * 60 * 1000;
  return setInterval(() => {
    if (!isOvernightWindow()) return;
    const day = new Date().toDateString();
    if (lastCheckDate === day) return;
    lastCheckDate = day;
    logger.info('Overnight update check');
    runCheck();
  }, intervalMs);
}

module.exports = { startOvernightUpdateCheck };
