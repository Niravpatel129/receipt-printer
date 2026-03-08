const axios = require('axios');
const { BACKEND_URL } = require('../config');
const { loadBackendConfig } = require('../prefs');
const { setOrderStatus } = require('../orderStatusStore');

const DEFAULT_POLL_MS = 5000;
let pollTimer = null;

function getAxiosConfig() {
  const baseURL = BACKEND_URL ? BACKEND_URL.replace(/\/$/, '') : '';
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
  const items = (order.items || []).map((it, i) => ({
    num: String(i + 1).padStart(2, '0'),
    name: (it.name || it.title || '').toUpperCase(),
    amount: typeof it.price !== 'undefined' ? String(Number(it.price).toFixed(2)) : (it.amount || '0.00'),
    toppings: it.toppings || it.options
  }));
  const total = order.total != null ? `$ ${Number(order.total).toFixed(2)}` : '$ 0.00';
  const dateStr = order.orderDate || order.date || order.createdAt || '';
  const date = dateStr ? new Date(dateStr).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' }).toUpperCase() : '';
  const payment = order.payment || {};
  const cardLastFour = payment.lastFour || payment.cardLastFour || '';
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
    authCode: payment.authCode || '',
    userId: order.userId || order.customerName || '',
    barcode: order.orderNumber || order._id || '',
    website: order.receiptFooterWebsite || order.footerWebsite || '',
    footerMessage: order.receiptFooterMessage || order.footerMessage || ''
  };
}

async function fetchPendingJobs() {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return [];
  const kitchenSecret = getKitchenSecret();
  if (!kitchenSecret) return [];
  const url = `${baseURL}/api/kitchen/print-queue?secret=${encodeURIComponent(kitchenSecret)}`;
  const { data } = await axios.get(url, { headers });
  const orders = data.orders || data.jobs || (Array.isArray(data) ? data : []);
  return orders
    .filter((o) => o && (o._id != null || o.id != null))
    .map((order) => ({
      id: order._id || order.id,
      payload: orderToReceiptPayload(order),
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      customerPhone: order.customerPhone,
      total: order.total,
      subtotal: order.subtotal,
      tax: order.tax,
      deliveryFee: order.deliveryFee,
      date: order.orderDate || order.date || order.createdAt,
      storeName: order.receiptStoreName || order.storeName,
      itemCount: order.itemCount,
      fulfillmentType: order.fulfillmentType,
      paymentMethod: order.paymentMethod,
      status: order.status,
      notes: order.notes,
      items: order.items || []
    }));
}

async function checkHealth() {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return false;
  try {
    const { data, status } = await axios.get(`${baseURL}/api/kitchen/health`, { headers });
    return status === 200 && data && data.status === 'ok';
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
  await axios.post(`${baseURL}/api/kitchen/print-jobs/${encodeURIComponent(id)}/complete${secretQuery()}`, null, { headers });
}

async function markJobFailed(id, message) {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return;
  await axios.post(
    `${baseURL}/api/kitchen/print-jobs/${encodeURIComponent(id)}/failed${secretQuery()}`,
    { message: message || 'Print failed' },
    { headers },
  );
}

async function markJobSkipped(id, reason) {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return;
  try {
    await axios.post(
      `${baseURL}/api/kitchen/print-jobs/${encodeURIComponent(id)}/skipped${secretQuery()}`,
      { reason: reason || 'unknown' },
      { headers },
    );
  } catch (e) {
    if (e.response?.status !== 404) console.error('[Backend print] Failed to report skipped to backend', e);
  }
}

async function markJobCancel(id) {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return;
  try {
    await axios.post(`${baseURL}/api/kitchen/print-jobs/${encodeURIComponent(id)}/cancel${secretQuery()}`, null, { headers });
  } catch (e) {
    if (e.response?.status !== 404) console.error('[Backend print] Failed to report cancel to backend', e);
  }
}

async function startBackendPolling(printReceiptFn, intervalMs = null) {
  if (pollTimer) return;
  if (!BACKEND_URL) {
    console.log('[Backend print] No backend URL configured; skipping backend polling');
    return;
  }
  const ok = await checkHealth();
  if (!ok) {
    console.log('[Backend print] Health check failed; not starting polling');
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
          setOrderStatus(job.id, 'printed');
        } catch (err) {
          const msg = err && err.message ? err.message : String(err);
          console.error('[Backend print] Job failed:', job.id, msg);
          setOrderStatus(job.id, 'failed', msg);
          const isClientConfigError = /no printer selected|printer.*dropdown/i.test(msg);
          if (isClientConfigError) {
            await markJobSkipped(job.id, 'no_printer_selected');
          } else {
            try {
              await markJobFailed(job.id, msg);
            } catch (e) {
              if (e.response?.status !== 404) console.error('[Backend print] Failed to report failure to backend', e);
            }
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

function isPollingActive() {
  return pollTimer != null;
}

module.exports = {
  fetchPendingJobs,
  markJobComplete,
  markJobFailed,
  markJobCancel,
  markJobSkipped,
  startBackendPolling,
  stopBackendPolling,
  isPollingActive,
};
