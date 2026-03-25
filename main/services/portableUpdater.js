const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const axios = require('axios');
const { app } = require('electron');
const logger = require('../logger');

const { GITHUB_UPDATER_OWNER, GITHUB_UPDATER_REPO } = require('../config');

let downloadedVersion = null;
let downloadedAssetPath = null;
let checkInFlight = null;

function isPortableWindowsBuild() {
  return process.platform === 'win32' && app.isPackaged && Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
}

function normalizeVersion(version) {
  return String(version || '').trim().replace(/^v/i, '');
}

function compareVersions(a, b) {
  const pa = normalizeVersion(a).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = normalizeVersion(b).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const max = Math.max(pa.length, pb.length);
  for (let i = 0; i < max; i += 1) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

function resolveArch() {
  if (process.arch === 'x64') return 'x64';
  if (process.arch === 'ia32') return 'ia32';
  if (process.arch === 'arm64') return 'arm64';
  return process.arch;
}

function getUpdateDir() {
  return path.join(app.getPath('userData'), 'updates');
}

function getApplyScriptPath() {
  return path.join(getUpdateDir(), 'apply-portable-update.cmd');
}

function pickAsset(assets, arch) {
  const list = Array.isArray(assets) ? assets : [];
  const portableExes = list.filter((a) => {
    const n = String(a?.name || '').toLowerCase();
    return n.endsWith('.exe') && n.includes('portable');
  });
  if (!portableExes.length) return null;
  const nameMatchesArch = (n) => {
    if (arch === 'x64') return n.includes('-x64') || n.includes('x64') || n.includes('win-x64');
    if (arch === 'ia32') return n.includes('-ia32') || n.includes('ia32') || n.includes('x86') || n.includes('win-ia32');
    return n.includes(String(arch).toLowerCase());
  };
  const byArch = portableExes.find((a) => nameMatchesArch(String(a?.name || '').toLowerCase()));
  if (byArch) return byArch;
  return portableExes.length === 1 ? portableExes[0] : null;
}

async function fetchLatestRelease() {
  const response = await axios.get(`https://api.github.com/repos/${GITHUB_UPDATER_OWNER}/${GITHUB_UPDATER_REPO}/releases/latest`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'receipt-printer-updater',
    },
    timeout: 30000,
  });
  return response.data;
}

async function downloadAsset(asset, onProgress) {
  const url = asset.browser_download_url;
  const fileName = asset.name || `update-${Date.now()}.exe`;
  const updateDir = getUpdateDir();
  fs.mkdirSync(updateDir, { recursive: true });
  const outPath = path.join(updateDir, fileName);
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

  const response = await axios.get(url, {
    responseType: 'stream',
    timeout: 0,
    maxRedirects: 10,
    headers: {
      Accept: 'application/octet-stream',
      'User-Agent': 'receipt-printer-updater',
    },
  });

  const total = Number.parseInt(response.headers['content-length'] || '0', 10) || 0;
  let received = 0;
  let lastPercent = -1;
  response.data.on('data', (chunk) => {
    if (!chunk) return;
    received += chunk.length;
    if (!total) return;
    const percent = Math.max(0, Math.min(100, Math.round((received / total) * 100)));
    if (percent !== lastPercent) {
      lastPercent = percent;
      onProgress(percent);
    }
  });

  await new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(outPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });

  return outPath;
}

async function checkForUpdates(send) {
  if (!isPortableWindowsBuild()) {
    throw new Error('Portable updater is not available on this build');
  }
  if (checkInFlight) {
    send({ state: 'checking' });
    try {
      const result = await checkInFlight;
      if (result?.updated) {
        send({ state: 'downloaded', version: result.latestVersion });
      } else {
        send({ state: 'up-to-date' });
      }
      return result;
    } catch (err) {
      send({ state: 'error', message: err?.message || 'Update check failed' });
      throw err;
    }
  }
  send({ state: 'checking' });
  checkInFlight = (async () => {
    const currentVersion = app.getVersion();
    const release = await fetchLatestRelease();
    const latestVersion = normalizeVersion(release.tag_name || release.name || '');
    if (!latestVersion) throw new Error('Could not determine latest version');

    if (compareVersions(latestVersion, currentVersion) <= 0) {
      send({ state: 'up-to-date' });
      return { updated: false, currentVersion, latestVersion };
    }

    const arch = resolveArch();
    const asset = pickAsset(release.assets, arch);
    if (!asset || !asset.browser_download_url) {
      throw new Error(`No Windows update asset found for architecture ${arch}`);
    }

    send({ state: 'available', version: latestVersion });
    const filePath = await downloadAsset(asset, (percent) => {
      send({ state: 'downloading', progress: percent });
    });

    downloadedVersion = latestVersion;
    downloadedAssetPath = filePath;
    send({ state: 'downloaded', version: latestVersion });
    logger.info('Portable update downloaded', { version: latestVersion, asset: asset.name, filePath });
    return { updated: true, latestVersion, filePath };
  });
  try {
    return await checkInFlight;
  } finally {
    checkInFlight = null;
  }
}

function installDownloadedUpdate() {
  if (!isPortableWindowsBuild()) {
    throw new Error('Portable updater is not available on this build');
  }
  if (!downloadedAssetPath || !fs.existsSync(downloadedAssetPath)) {
    throw new Error('No downloaded update available');
  }

  const targetExe = process.env.PORTABLE_EXECUTABLE_FILE;
  const updateExe = downloadedAssetPath;
  const scriptPath = getApplyScriptPath();
  const escapedTarget = targetExe.replace(/"/g, '""');
  const escapedSource = updateExe.replace(/"/g, '""');
  const script = [
    '@echo off',
    'setlocal',
    `set "TARGET=${escapedTarget}"`,
    `set "SOURCE=${escapedSource}"`,
    'timeout /t 2 /nobreak >nul',
    ':copyloop',
    'copy /Y "%SOURCE%" "%TARGET%" >nul 2>nul',
    'if errorlevel 1 (',
    '  timeout /t 1 /nobreak >nul',
    '  goto copyloop',
    ')',
    'start "" "%TARGET%"',
    'exit /b 0',
    '',
  ].join('\r\n');

  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, script, 'utf8');

  const child = spawn('cmd.exe', ['/c', 'start', '', '/min', scriptPath], {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
  });
  child.unref();
  logger.info('Portable update apply started', { version: downloadedVersion, scriptPath, targetExe });
  app.quit();
}

module.exports = {
  isPortableWindowsBuild,
  checkForUpdates,
  installDownloadedUpdate,
};
