const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const logger = require('../logger');
const { isPrintingPaused } = require('../printingPaused');

function getQueuePath() {
  return path.join(app.getPath('userData'), 'print-queue.json');
}
const MAX_COMPLETED = 50;
const DEFAULT_POLL_MS = 2000;

let pollTimer = null;

function loadQueue() {
  try {
    const raw = fs.readFileSync(getQueuePath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveQueue(jobs) {
  const completed = jobs.filter((j) => j.status === 'done' || j.status === 'failed');
  const rest = jobs.filter((j) => j.status !== 'done' && j.status !== 'failed');
  const trimmed = completed.length > MAX_COMPLETED
    ? [...rest, ...completed.slice(-MAX_COMPLETED)]
    : jobs;
  fs.writeFileSync(getQueuePath(), JSON.stringify(trimmed, null, 0), 'utf8');
}

function generateId() {
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function enqueue(payload = null) {
  const jobs = loadQueue();
  const job = {
    id: generateId(),
    payload,
    status: 'pending',
    createdAt: Date.now()
  };
  jobs.push(job);
  saveQueue(jobs);
  logger.info('Enqueued local print job', { jobId: job.id });
  return job.id;
}

function getQueue() {
  return loadQueue();
}

function getNextPending() {
  const jobs = loadQueue();
  const i = jobs.findIndex((j) => j.status === 'pending');
  if (i === -1) return null;
  jobs[i].status = 'printing';
  saveQueue(jobs);
  return jobs[i];
}

function markDone(id) {
  const jobs = loadQueue();
  const j = jobs.find((x) => x.id === id);
  if (j) {
    j.status = 'done';
    j.completedAt = Date.now();
    saveQueue(jobs);
    logger.info('Marked local job done', { jobId: id });
  }
}

function markFailed(id, error) {
  const jobs = loadQueue();
  const j = jobs.find((x) => x.id === id);
  if (j) {
    j.status = 'failed';
    j.error = error && error.message ? error.message : String(error);
    j.completedAt = Date.now();
    saveQueue(jobs);
    logger.error('Local job failed', { jobId: id, error: j.error });
  }
}

function startPolling(processJob, intervalMs = DEFAULT_POLL_MS) {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (isPrintingPaused()) return;
    const job = getNextPending();
    if (!job) return;
    try {
      logger.info('Processing local print job', { jobId: job.id });
      await processJob(job.payload);
      markDone(job.id);
    } catch (err) {
      logger.error('Processing local print job failed', { jobId: job.id, error: err && err.message ? err.message : String(err) });
      markFailed(job.id, err);
    }
  }, intervalMs);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

module.exports = {
  enqueue,
  getQueue,
  getNextPending,
  markDone,
  markFailed,
  startPolling,
  stopPolling
};
