const axios = require('axios');
const { BACKEND_URL } = require('../config');
const { loadBackendConfig } = require('../prefs');

const DEFAULT_POLL_MS = 5000;
let pollTimer = null;

function getAxiosConfig() {
  const baseURL = BACKEND_URL ? BACKEND_URL.replace(/\/$/, '') : '';
  const headers = { 'Content-Type': 'application/json' };
  return { baseURL, headers };
}

async function fetchPendingJobs() {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return [];
  const { kitchenSecret } = loadBackendConfig();
  const url = `${baseURL}/api/kitchen/print-queue?secret=${encodeURIComponent(kitchenSecret || '')}`;
  const { data } = await axios.get(url, { headers });
  const jobs = Array.isArray(data) ? data : (data.jobs || []);
  return jobs.filter((j) => j && j.id != null);
}

async function markJobComplete(id) {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return;
  await axios.post(`${baseURL}/print-jobs/${encodeURIComponent(id)}/complete`, null, { headers });
}

async function markJobFailed(id, message) {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return;
  await axios.post(`${baseURL}/print-jobs/${encodeURIComponent(id)}/failed`, { message: message || 'Print failed' }, { headers });
}

function startBackendPolling(printReceiptFn, intervalMs = null) {
  if (pollTimer) return;
  if (!BACKEND_URL) {
    console.log('[Backend print] No backend URL configured; skipping backend polling');
    return;
  }
  const { backendPollIntervalMs } = loadBackendConfig();
  const ms = intervalMs ?? backendPollIntervalMs ?? DEFAULT_POLL_MS;
  let processing = false;
  pollTimer = setInterval(async () => {
    if (processing) return;
    try {
      const jobs = await fetchPendingJobs();
      if (jobs.length === 0) return;
      processing = true;
      for (const job of jobs) {
        try {
          await printReceiptFn(job.payload || null);
          await markJobComplete(job.id);
        } catch (err) {
          console.error('[Backend print] Job failed:', job.id, err);
          try {
            await markJobFailed(job.id, err && err.message ? err.message : String(err));
          } catch (e) {
            console.error('[Backend print] Failed to report failure to backend', e);
          }
        }
      }
    } catch (err) {
      console.error('[Backend print] Poll error', err);
    } finally {
      processing = false;
    }
  }, ms);
}

function stopBackendPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

module.exports = {
  fetchPendingJobs,
  markJobComplete,
  markJobFailed,
  startBackendPolling,
  stopBackendPolling
};
