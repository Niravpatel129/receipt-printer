const axios = require('axios');
const { loadBackendConfig } = require('../prefs');
const { setOrderStatus, getAllStatuses } = require('../orderStatusStore');
const { isPrintingPaused } = require('../printingPaused');

const DEFAULT_POLL_MS = 5000;
const PRINT_TIMEOUT_MS = 60000;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_PENDING_STATUS_UPDATES = 100;
let pollTimer = null;
let lastPollSucceeded = true;
let consecutivePollFailures = 0;
let isFlushingPendingUpdates = false;
const pendingStatusUpdates = [];

function isNetworkError(err) {
  if (!err || typeof err !== 'object') return false;
  if (
    err.code &&
    [
      'ECONNREFUSED',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ENETUNREACH',
      'ECONNRESET',
      'EAI_AGAIN',
      'ECONNABORTED',
    ].includes(err.code)
  )
    return true;
  if (err.response === undefined && err.request !== undefined) return true;
  return false;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Print timed out after ${ms / 1000}s`)), ms);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(t);
        reject(e);
      });
  });
}

function getAxiosConfig() {
  const { apiBaseUrl } = loadBackendConfig();
  const baseURL = apiBaseUrl && typeof apiBaseUrl === 'string' ? apiBaseUrl.replace(/\/$/, '') : '';
  const headers = { 'Content-Type': 'application/json' };
  return { baseURL, headers };
}

function getKitchenSecret() {
  const config = loadBackendConfig();
  const kitchenSecret = config.kitchenSecret;
  if (!kitchenSecret || typeof kitchenSecret !== 'string') return '';
  const s = kitchenSecret.trim();
  if (s.includes('apiBaseUrl') || s.includes('{kitchenSecret}') || s.includes('List queue'))
    return '';
  return s;
}

function orderToReceiptPayload(order) {
  if (order.receipt && typeof order.receipt === 'object') {
    return order.receipt;
  }
  const items = (order.items || []).map((it, i) => ({
    num: String(i + 1).padStart(2, '0'),
    name: (it.name || it.title || '').toUpperCase(),
    amount:
      typeof it.price !== 'undefined' ? String(Number(it.price).toFixed(2)) : it.amount || '0.00',
    toppings: it.toppings || it.options,
  }));
  const total = order.total != null ? `$ ${Number(order.total).toFixed(2)}` : '$ 0.00';
  const dateStr = order.orderDate || order.date || order.createdAt || '';
  const date = dateStr
    ? new Date(dateStr)
        .toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
        .toUpperCase()
    : '';
  const payment = order.payment || {};
  const cardLastFour = payment.lastFour || payment.cardLastFour || payment.last4 || '';
  return {
    storeName: order.receiptStoreName || order.storeName || '',
    address: order.receiptAddressLine1 || order.addressLine1 || '',
    city: order.receiptAddressLine2 || order.addressLine2 || '',
    orderNumber: order.orderNumber || order._id || '',
    customerName: order.customerName || (order.customer && order.customer.name) || '',
    date: date,
    items,
    itemCount: String(order.itemCount != null ? order.itemCount : items.length),
    total,
    cardLastFour: cardLastFour ? String(cardLastFour).slice(-4) : '',
    authCode: payment.authCode || payment.authNumber || '',
    userId: order.userId || order.customerName || '',
    barcode: order.orderNumber || order._id || '',
    website: order.receiptFooterWebsite || order.footerWebsite || '',
    footerMessage: order.receiptFooterMessage || order.footerMessage || '',
  };
}

async function fetchPendingJobs() {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return [];
  const kitchenSecret = getKitchenSecret();
  if (!kitchenSecret) return [];
  const url = `${baseURL}/api/kitchen/print-queue?secret=${encodeURIComponent(kitchenSecret)}`;
  const { data } = await axios.get(url, { headers, timeout: REQUEST_TIMEOUT_MS });
  const orders = data.orders || data.jobs || (Array.isArray(data) ? data : []);
  const toIdString = (v) => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'object' && v.$oid != null) return String(v.$oid);
    return String(v);
  };
  const normId = (o) => toIdString(o._id != null ? o._id : o.id);
  return orders
    .filter((o) => o && (o._id != null || o.id != null || o.order != null || o.orderId != null))
    .map((order) => {
      const rawOrder = order.order && typeof order.order === 'object' ? order.order : order;
      const orderId =
        rawOrder._id != null
          ? normId(rawOrder)
          : toIdString(order.orderId != null ? order.orderId : order.order_id);
      const queueId =
        order.queueId != null
          ? toIdString(order.queueId)
          : order.queue_id != null
            ? toIdString(order.queue_id)
            : normId(order);
      const printStatus =
        typeof order.printStatus === 'string' && order.printStatus
          ? String(order.printStatus).toLowerCase()
          : 'queued';
      return {
        id: queueId,
        orderId,
        queueId,
        queueAddedAt: order.queueAddedAt || order.addedAt || null,
        printStatus,
        payload: orderToReceiptPayload(rawOrder),
        orderNumber: rawOrder.orderNumber,
        customerName: rawOrder.customerName,
        customerEmail: rawOrder.customerEmail,
        customerPhone: rawOrder.customerPhone,
        total: rawOrder.total,
        subtotal: rawOrder.subtotal,
        tax: rawOrder.tax,
        deliveryFee: rawOrder.deliveryFee,
        date: rawOrder.orderDate || rawOrder.date || rawOrder.createdAt,
        storeName: rawOrder.receiptStoreName || rawOrder.storeName,
        itemCount: rawOrder.itemCount,
        fulfillmentType: rawOrder.fulfillmentType,
        paymentMethod: rawOrder.paymentMethod,
        status: rawOrder.status,
        notes: rawOrder.notes,
        items: rawOrder.items || [],
        lastFailedAt: order.lastFailedAt || order.failedAt || null,
        lastFailedMessage: order.lastFailedMessage || order.failedMessage || null,
        lastSkippedAt: order.lastSkippedAt || order.skippedAt || null,
        lastSkippedReason: order.lastSkippedReason || order.skippedReason || null,
      };
    });
}

async function fetchHistoryJobs(limit = 20, page = 1) {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return [];
  const kitchenSecret = getKitchenSecret();
  if (!kitchenSecret) return [];
  const url = `${baseURL}/api/kitchen/print-queue/history?secret=${encodeURIComponent(
    kitchenSecret,
  )}&limit=${encodeURIComponent(limit)}&page=${encodeURIComponent(page)}`;
  const { data } = await axios.get(url, { headers, timeout: REQUEST_TIMEOUT_MS });
  const orders = data.orders || data.jobs || (Array.isArray(data) ? data : []);
  const toIdString = (v) => {
    if (v == null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') return String(v);
    if (typeof v === 'object' && v.$oid != null) return String(v.$oid);
    return String(v);
  };
  const normId = (o) => toIdString(o._id != null ? o._id : o.id);
  return orders
    .filter((o) => o && (o._id != null || o.id != null || o.order != null || o.orderId != null))
    .map((order) => {
      const rawOrder = order.order && typeof order.order === 'object' ? order.order : order;
      const orderId =
        rawOrder._id != null
          ? normId(rawOrder)
          : toIdString(order.orderId != null ? order.orderId : order.order_id);
      const queueId =
        order.queueId != null
          ? toIdString(order.queueId)
          : order.queue_id != null
            ? toIdString(order.queue_id)
            : normId(order);
      const printStatus =
        typeof order.printStatus === 'string' && order.printStatus
          ? String(order.printStatus).toLowerCase()
          : 'queued';
      return {
        id: queueId,
        orderId,
        queueId,
        queueAddedAt: order.queueAddedAt || order.addedAt || null,
        printStatus,
        payload: orderToReceiptPayload(rawOrder),
        orderNumber: rawOrder.orderNumber,
        customerName: rawOrder.customerName,
        customerEmail: rawOrder.customerEmail,
        customerPhone: rawOrder.customerPhone,
        total: rawOrder.total,
        subtotal: rawOrder.subtotal,
        tax: rawOrder.tax,
        deliveryFee: rawOrder.deliveryFee,
        date: rawOrder.orderDate || rawOrder.date || rawOrder.createdAt,
        storeName: rawOrder.receiptStoreName || rawOrder.storeName,
        itemCount: rawOrder.itemCount,
        fulfillmentType: rawOrder.fulfillmentType,
        paymentMethod: rawOrder.paymentMethod,
        status: rawOrder.status,
        notes: rawOrder.notes,
        items: rawOrder.items || [],
        lastFailedAt: order.lastFailedAt || order.failedAt || null,
        lastFailedMessage: order.lastFailedMessage || order.failedMessage || null,
        lastSkippedAt: order.lastSkippedAt || order.skippedAt || null,
        lastSkippedReason: order.lastSkippedReason || order.skippedReason || null,
      };
    });
}

async function checkHealth() {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return false;
  try {
    const { data, status } = await axios.get(`${baseURL}/api/health`, {
      headers,
      timeout: REQUEST_TIMEOUT_MS,
    });
    return status === 200 && data && (data.status === 'ok' || data.ok === true);
  } catch {
    return false;
  }
}

function secretQuery() {
  const s = getKitchenSecret();
  return s ? `?secret=${encodeURIComponent(s)}` : '';
}

async function markJobComplete(id) {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return;
  try {
    await axios.post(
      `${baseURL}/api/kitchen/print-jobs/${encodeURIComponent(id)}/complete${secretQuery()}`,
      {},
      { headers, timeout: REQUEST_TIMEOUT_MS },
    );
  } catch (e) {
    if (
      !isFlushingPendingUpdates &&
      isNetworkError(e) &&
      pendingStatusUpdates.length < MAX_PENDING_STATUS_UPDATES
    ) {
      pendingStatusUpdates.push({ type: 'complete', jobId: id });
    }
    throw e;
  }
}

async function markJobFailed(id, message) {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return;
  try {
    await axios.post(
      `${baseURL}/api/kitchen/print-jobs/${encodeURIComponent(id)}/failed${secretQuery()}`,
      { message: message || 'Print failed' },
      { headers, timeout: REQUEST_TIMEOUT_MS },
    );
  } catch (e) {
    if (
      !isFlushingPendingUpdates &&
      isNetworkError(e) &&
      pendingStatusUpdates.length < MAX_PENDING_STATUS_UPDATES
    ) {
      pendingStatusUpdates.push({ type: 'failed', jobId: id, message: message || 'Print failed' });
    }
    throw e;
  }
}

async function markJobSkipped(id, reason) {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return;
  try {
    await axios.post(
      `${baseURL}/api/kitchen/print-jobs/${encodeURIComponent(id)}/skipped${secretQuery()}`,
      { reason: reason || 'unknown' },
      { headers, timeout: REQUEST_TIMEOUT_MS },
    );
  } catch (e) {
    if (e.response?.status !== 404)
      console.error('[Backend print] Failed to report skipped to backend', e);
    if (
      !isFlushingPendingUpdates &&
      isNetworkError(e) &&
      pendingStatusUpdates.length < MAX_PENDING_STATUS_UPDATES
    ) {
      pendingStatusUpdates.push({ type: 'skipped', jobId: id, reason: reason || 'unknown' });
    }
  }
}

async function markJobCancel(id) {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return;
  try {
    await axios.post(
      `${baseURL}/api/kitchen/print-jobs/${encodeURIComponent(id)}/cancel${secretQuery()}`,
      null,
      { headers, timeout: REQUEST_TIMEOUT_MS },
    );
  } catch (e) {
    if (e.response?.status !== 404)
      console.error('[Backend print] Failed to report cancel to backend', e);
  }
}

async function addOrderToPrintQueue(orderId) {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) throw new Error('API base URL not set');
  const { data } = await axios.post(
    `${baseURL}/api/kitchen/orders/${encodeURIComponent(orderId)}/print${secretQuery()}`,
    {},
    { headers, timeout: REQUEST_TIMEOUT_MS },
  );
  return data;
}

async function flushPendingStatusUpdates() {
  const snapshot = pendingStatusUpdates.splice(0, pendingStatusUpdates.length);
  const remaining = [];
  isFlushingPendingUpdates = true;
  try {
    for (const entry of snapshot) {
      try {
        if (entry.type === 'complete') {
          await markJobComplete(entry.jobId);
        } else if (entry.type === 'failed') {
          await markJobFailed(entry.jobId, entry.message);
        } else if (entry.type === 'skipped') {
          await markJobSkipped(entry.jobId, entry.reason);
        }
      } catch {
        remaining.push(entry);
      }
    }
  } finally {
    isFlushingPendingUpdates = false;
  }
  pendingStatusUpdates.push(...remaining);
}

async function startBackendPolling(printReceiptFn, intervalMs = null) {
  if (pollTimer) return;
  const { apiBaseUrl } = loadBackendConfig();
  if (!apiBaseUrl || !apiBaseUrl.trim()) {
    console.log('[Backend print] No API base URL configured; skipping backend polling');
    return;
  }
  const ok = await checkHealth();
  if (!ok) {
    console.log('[Backend print] Health check failed; not starting polling');
    return;
  }
  lastPollSucceeded = true;
  consecutivePollFailures = 0;
  const { backendPollIntervalMs } = loadBackendConfig();
  const ms = intervalMs ?? backendPollIntervalMs ?? DEFAULT_POLL_MS;
  let processing = false;
  pollTimer = setInterval(async () => {
    if (processing) return;
    try {
      await flushPendingStatusUpdates();
      const jobs = await fetchPendingJobs();
      lastPollSucceeded = true;
      consecutivePollFailures = 0;
      const statuses = getAllStatuses();
      const terminal = ['printed', 'cancelled', 'failed', 'skipped'];
      const queuedJobs = jobs.filter((j) => {
        const backend = j.printStatus != null ? String(j.printStatus).toLowerCase() : 'queued';
        const idKey = j.id != null ? String(j.id) : '';
        const local = idKey ? statuses[idKey] : null;
        const localStatus = local && local.status ? String(local.status).toLowerCase() : null;
        const effective = terminal.includes(localStatus) ? localStatus : backend;
        return effective === 'queued';
      });
      if (queuedJobs.length === 0) return;
      if (isPrintingPaused()) return;
      processing = true;
      const job = queuedJobs[0];
      try {
        setOrderStatus(job.id, 'printing');
        await withTimeout(printReceiptFn(job.payload || null), PRINT_TIMEOUT_MS);
        await markJobComplete(job.queueId || job.id);
        setOrderStatus(job.id, 'printed');
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        console.error('[Backend print] Job failed:', job.id, msg);
        setOrderStatus(job.id, 'failed', msg);
        const isClientConfigError = /no printer selected|printer.*dropdown/i.test(msg);
        if (isClientConfigError) {
          await markJobSkipped(job.queueId || job.id, 'no_printer_selected');
        } else {
          try {
            await markJobFailed(job.queueId || job.id, msg);
          } catch (e) {
            if (e.response?.status !== 404)
              console.error('[Backend print] Failed to report failure to backend', e);
          }
        }
      }
    } catch (err) {
      lastPollSucceeded = false;
      consecutivePollFailures += 1;
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
  lastPollSucceeded = true;
  consecutivePollFailures = 0;
}

function isPollingActive() {
  return pollTimer != null;
}

function getConnectionState() {
  return {
    pollingActive: pollTimer != null,
    lastPollSucceeded: lastPollSucceeded,
    consecutivePollFailures: consecutivePollFailures,
  };
}

module.exports = {
  fetchPendingJobs,
  fetchHistoryJobs,
  markJobComplete,
  markJobFailed,
  markJobCancel,
  markJobSkipped,
  addOrderToPrintQueue,
  startBackendPolling,
  stopBackendPolling,
  isPollingActive,
  getConnectionState,
};
