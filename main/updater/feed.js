const { GITHUB_UPDATER_OWNER, GITHUB_UPDATER_REPO } = require('../config');

function configureAutoUpdater(autoUpdater) {
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: GITHUB_UPDATER_OWNER,
    repo: GITHUB_UPDATER_REPO,
  });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;
}

module.exports = { configureAutoUpdater };
