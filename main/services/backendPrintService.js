const axios = require('axios');
const { loadBackendConfig } = require('../prefs');
const { setOrderStatus, getAllStatuses } = require('../orderStatusStore');
const { isPrintingPaused } = require('../printingPaused');
const { appendLocalLog } = require('../localLog');

const DEFAULT_POLL_MS = 5000;
const DEFAULT_RECONNECT_MS = 10000;
const PRINT_TIMEOUT_MS = 60000;
const REQUEST_TIMEOUT_MS = 15000;
const MAX_PENDING_STATUS_UPDATES = 100;
const TERMINAL_STATUSES = ['printed', 'cancelled', 'canceled', 'failed', 'skipped'];
let pollTimer = null;
let reconnectTimer = null;
let reconnectInFlight = false;
let printReceiptHandler = null;
let lastPollSucceeded = true;
let consecutivePollFailures = 0;
let lastInactiveReason = null;
let lastKnownClientInfo = null;
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

function logBackend(level, message, meta) {
  appendLocalLog({
    level,
    message: String(message),
    meta: meta || {},
    source: 'backendPrint',
    timestamp: new Date().toISOString(),
  });
}

function shouldProcessJob(backendStatus, localStatus) {
  const b = backendStatus ? String(backendStatus).toLowerCase() : null;
  const l = localStatus ? String(localStatus).toLowerCase() : null;

  // If the local store says "pending", that means the user explicitly
  // wants this job to be (re)processed, even if the backend previously
  // marked it as failed/skipped/etc.
  if (l === 'pending') return true;

  if (l === 'printing') return false;
  if (TERMINAL_STATUSES.includes(l)) return false;
  if (TERMINAL_STATUSES.includes(b)) return false;
  return true;
}

function getDeviceCredentials() {
  const config = loadBackendConfig();
  const deviceId = config.deviceId && typeof config.deviceId === 'string' ? config.deviceId.trim() : '';
  const deviceSecret = config.deviceSecret && typeof config.deviceSecret === 'string' ? config.deviceSecret.trim() : '';
  if (!deviceId || !deviceSecret) return null;
  return { deviceId, deviceSecret };
}

function hasDeviceAuth() {
  return getDeviceCredentials() !== null;
}

function getAxiosConfig() {
  const config = loadBackendConfig();
  const apiBaseUrl = config.apiBaseUrl;
  const baseURL = apiBaseUrl && typeof apiBaseUrl === 'string' ? apiBaseUrl.replace(/\/$/, '') : '';
  const headers = { 'Content-Type': 'application/json' };
  const creds = getDeviceCredentials();
  if (creds) {
    headers['X-Device-Id'] = creds.deviceId;
    headers['Authorization'] = `Bearer ${creds.deviceSecret}`;
  }
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

function hasBackendAuth() {
  return hasDeviceAuth() || !!getKitchenSecret();
}

function authQuery() {
  if (hasDeviceAuth()) return '';
  const s = getKitchenSecret();
  return s ? `?secret=${encodeURIComponent(s)}` : '';
}

function toCurrency(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  return `$ ${n.toFixed(2)}`;
}

function lineItemOptionsOrToppingsFromReceipt(rit, raw) {
  if (rit && typeof rit === 'object') {
    if (Array.isArray(rit.options) && rit.options.length) return rit.options;
    if (Array.isArray(rit.toppings) && rit.toppings.length) return rit.toppings;
  }
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.options) && raw.options.length) return raw.options;
    if (Array.isArray(raw.toppings) && raw.toppings.length) return raw.toppings;
  }
  return undefined;
}

function orderToReceiptPayload(order) {
  const subtotal = toCurrency(order.subtotal);
  const tax = toCurrency(order.tax);
  const delivery = toCurrency(order.deliveryFee);
  const tip =
    order.tip != null
      ? toCurrency(order.tip)
      : order.tipAmount != null
        ? toCurrency(Number(order.tipAmount) / 100)
        : '';
  const total = toCurrency(order.total) || '$ 0.00';
  const website =
    order.receiptFooterWebsite ||
    order.footerWebsite ||
    order.website ||
    process.env.RECEIPT_DEFAULT_WEBSITE ||
    'https://pizzadepot.com';
  const footerMessage = order.receiptFooterMessage || order.footerMessage || '';
  const storeAddress = order.receiptAddressLine1 || order.addressLine1 || '';
  const storeCity = order.receiptAddressLine2 || order.addressLine2 || '';
  const orderType = order.orderType || order.fulfillmentType || '';
  const customerName = order.customerName || (order.customer && order.customer.name) || '';
  const customerPhone = order.customerPhone || (order.customer && order.customer.phone) || '';
  const payment = order.payment || {};
  const cardLastFour = payment.lastFour || payment.cardLastFour || payment.last4 || '';
  const orderSpecialFromRoot =
    order.specialInstructions ||
    order.specialInstruction ||
    order.orderInstructions ||
    order.kitchenNotes ||
    order.notes ||
    '';

  if (order.receipt && typeof order.receipt === 'object') {
    const rawLineItems = Array.isArray(order.items) ? order.items : [];
    const receiptItems = Array.isArray(order.receipt.items) ? order.receipt.items : [];
    const mergedItems = receiptItems.map((rit, i) => {
      const raw = rawLineItems[i] || {};
      const lineSi =
        rit.specialInstructions ||
        rit.specialInstruction ||
        raw.specialInstructions ||
        raw.specialInstruction ||
        raw.instructions ||
        raw.customerNote ||
        raw.note ||
        '';
      return {
        ...rit,
        size: [rit.size, raw.size]
          .map((s) => (s != null ? String(s).trim() : ''))
          .find(Boolean) || undefined,
        specialInstructions: lineSi || undefined,
        orderSpecialInstructions: orderSpecialFromRoot || undefined,
        toppings: lineItemOptionsOrToppingsFromReceipt(rit, raw),
      };
    });
    return {
      ...order.receipt,
      storeAddress: order.receipt.storeAddress || order.receipt.address || storeAddress,
      storeCity: order.receipt.storeCity || order.receipt.city || storeCity,
      address: order.receipt.address || order.receipt.storeAddress || storeAddress,
      city: order.receipt.city || order.receipt.storeCity || storeCity,
      orderType: order.receipt.orderType || orderType,
      customerPhone: order.receipt.customerPhone || customerPhone,
      subtotal: order.receipt.subtotal || subtotal,
      tax: order.receipt.tax || tax,
      delivery: order.receipt.delivery || delivery,
      tip: order.receipt.tip || tip,
      total: order.receipt.total || total,
      cardLastFour:
        (order.receipt.cardLastFour != null ? order.receipt.cardLastFour : cardLastFour) != null
          ? String(order.receipt.cardLastFour != null ? order.receipt.cardLastFour : cardLastFour).slice(-4)
          : '',
      authCode: order.receipt.authCode || payment.authCode || payment.authNumber || '',
      userId: order.receipt.userId || order.userId || customerName || '',
      website: order.receipt.website || website,
      footerMessage: order.receipt.footerMessage || footerMessage,
      specialInstructions: order.receipt.specialInstructions || orderSpecialFromRoot || undefined,
      items: mergedItems.length ? mergedItems : order.receipt.items,
    };
  }
  const orderSpecial = orderSpecialFromRoot;
  const items = (order.items || []).map((it, i) => ({
    qty: String(it.quantity != null ? it.quantity : i + 1),
    num: String(i + 1).padStart(2, '0'),
    name: (it.name || it.title || '').toUpperCase(),
    amount:
      typeof it.price !== 'undefined'
        ? String(Number(it.price).toFixed(2))
        : it.unitAmount != null && Number.isFinite(Number(it.unitAmount))
          ? String((Number(it.unitAmount) / 100).toFixed(2))
          : it.amount || '0.00',
    modifiers: it.modifiers || undefined,
    size: it.size != null ? String(it.size).trim() || undefined : undefined,
    toppings: it.options || it.toppings || undefined,
    specialInstructions:
      it.specialInstructions ||
      it.specialInstruction ||
      it.instructions ||
      it.customerNote ||
      it.note ||
      '',
    orderSpecialInstructions: orderSpecial || undefined,
  }));
  const dateStr = order.orderDate || order.date || order.createdAt || '';
  const date = dateStr
    ? new Date(dateStr)
        .toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })
        .toUpperCase()
    : '';
  return {
    storeName: order.receiptStoreName || order.storeName || '',
    storeAddress,
    storeCity,
    address: storeAddress,
    city: storeCity,
    orderNumber: order.orderNumber || order._id || '',
    orderType: String(orderType || '').toUpperCase(),
    specialInstructions: orderSpecial || undefined,
    customerName,
    customerPhone,
    date: date,
    items,
    itemCount: String(order.itemCount != null ? order.itemCount : items.length),
    subtotal,
    tax,
    delivery,
    tip,
    total,
    cardLastFour: cardLastFour ? String(cardLastFour).slice(-4) : '',
    authCode: payment.authCode || payment.authNumber || '',
    userId: order.userId || customerName || '',
    barcode: order.orderNumber || order._id || '',
    website,
    footerMessage,
  };
}

async function fetchPendingJobs() {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) {
    logBackend('warn', 'Backend print: apiBaseUrl not set, skipping fetchPendingJobs');
    return [];
  }
  if (!hasBackendAuth()) {
    logBackend('warn', 'Backend print: device credentials or kitchen secret not set, skipping fetchPendingJobs');
    return [];
  }
  const url = `${baseURL}/api/kitchen/print-queue${authQuery()}`;
  const { data } = await axios.get(url, { headers, timeout: REQUEST_TIMEOUT_MS });
  try {
    console.log('[Backend print] Poll response:', url, JSON.stringify(data, null, 2));
  } catch {
    console.log('[Backend print] Poll response (non-serializable):', url, data);
  }
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
      let printStatus =
        typeof order.printStatus === 'string' && order.printStatus
          ? String(order.printStatus).toLowerCase()
          : 'queued';
      if (printStatus === 'canceled') printStatus = 'cancelled';
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
  if (!baseURL) {
    logBackend('warn', 'Backend print: apiBaseUrl not set, skipping fetchHistoryJobs');
    return [];
  }
  if (!hasBackendAuth()) {
    logBackend('warn', 'Backend print: device credentials or kitchen secret not set, skipping fetchHistoryJobs');
    return [];
  }
  const aq = authQuery();
  const url = `${baseURL}/api/kitchen/print-queue/history${aq}${aq ? '&' : '?'}limit=${encodeURIComponent(limit)}&page=${encodeURIComponent(page)}`;
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
      let printStatus =
        typeof order.printStatus === 'string' && order.printStatus
          ? String(order.printStatus).toLowerCase()
          : 'queued';
      if (printStatus === 'canceled') printStatus = 'cancelled';
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

async function fetchOrders(limit = 50, since = null, status = null) {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) {
    logBackend('warn', 'Backend print: apiBaseUrl not set, skipping fetchOrders');
    return [];
  }
  if (!hasBackendAuth()) {
    logBackend('warn', 'Backend print: device credentials or kitchen secret not set, skipping fetchOrders');
    return [];
  }
  const params = new URLSearchParams();
  if (!hasDeviceAuth()) params.set('secret', getKitchenSecret());
  params.set('limit', String(Math.min(100, Math.max(1, limit))));
  if (since) params.set('since', since);
  if (status) params.set('status', status);
  const url = `${baseURL}/api/kitchen/orders?${params.toString()}`;
  try {
    const { data } = await axios.get(url, { headers, timeout: REQUEST_TIMEOUT_MS });
    return data.orders || [];
  } catch (e) {
    logBackend('warn', 'Backend print: fetchOrders failed', { message: e.message });
    return [];
  }
}

async function fetchClientInfo() {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return null;
  if (!hasBackendAuth()) return null;
  try {
    const { data } = await axios.get(`${baseURL}/api/kitchen/client${authQuery()}`, {
      headers,
      timeout: REQUEST_TIMEOUT_MS,
    });
    const client = data && typeof data === 'object' ? data : null;
    if (client) lastKnownClientInfo = client;
    return client;
  } catch (e) {
    if (e.response?.status !== 404) logBackend('warn', 'Backend print: fetch client failed', { message: e.message });
    return null;
  }
}

async function fetchClientInfoState() {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) {
    return {
      client: lastKnownClientInfo,
      stale: Boolean(lastKnownClientInfo),
      error: 'Backend URL not configured',
      reason: 'api_base_url_missing',
      retryable: false,
    };
  }
  if (!hasBackendAuth()) {
    return {
      client: lastKnownClientInfo,
      stale: Boolean(lastKnownClientInfo),
      error: 'Kitchen secret or device auth missing',
      reason: 'auth_missing',
      retryable: false,
    };
  }
  try {
    const { data } = await axios.get(`${baseURL}/api/kitchen/client${authQuery()}`, {
      headers,
      timeout: REQUEST_TIMEOUT_MS,
    });
    const client = data && typeof data === 'object' ? data : null;
    if (client) {
      lastKnownClientInfo = client;
      return {
        client,
        stale: false,
        error: null,
        reason: null,
        retryable: false,
      };
    }
    return {
      client: lastKnownClientInfo,
      stale: Boolean(lastKnownClientInfo),
      error: 'No client info from backend',
      reason: 'empty_response',
      retryable: true,
    };
  } catch (e) {
    const status = e.response?.status || null;
    const message =
      e.response?.data?.message ||
      (status === 404 ? 'Client endpoint not found' : e.message || 'Failed to load client');
    if (status !== 404) {
      logBackend('warn', 'Backend print: fetch client failed', { message: e.message, status });
    }
    return {
      client: lastKnownClientInfo,
      stale: Boolean(lastKnownClientInfo),
      error: message,
      reason: status === 404 ? 'not_found' : isNetworkError(e) ? 'network' : 'request_failed',
      retryable: status !== 404,
      status,
    };
  }
}

async function checkHealth() {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) {
    logBackend('warn', 'Backend print: apiBaseUrl not set, health check failed');
    return false;
  }
  try {
    const { data, status } = await axios.get(`${baseURL}/api/health`, {
      headers,
      timeout: REQUEST_TIMEOUT_MS,
    });
    return status === 200 && data && (data.status === 'ok' || data.ok === true);
  } catch {
    logBackend('error', 'Backend print: health check request failed');
    return false;
  }
}


async function markJobComplete(id) {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return;
  try {
    await axios.post(
      `${baseURL}/api/kitchen/print-jobs/${encodeURIComponent(id)}/complete${authQuery()}`,
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
      `${baseURL}/api/kitchen/print-jobs/${encodeURIComponent(id)}/failed${authQuery()}`,
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
      `${baseURL}/api/kitchen/print-jobs/${encodeURIComponent(id)}/skipped${authQuery()}`,
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
      `${baseURL}/api/kitchen/print-jobs/${encodeURIComponent(id)}/cancel${authQuery()}`,
      null,
      { headers, timeout: REQUEST_TIMEOUT_MS },
    );
  } catch (e) {
    if (e.response?.status !== 404)
      console.error('[Backend print] Failed to report cancel to backend', e);
  }
}

async function markOrderPrinted(orderId) {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL || !orderId) return;
  try {
    await axios.patch(
      `${baseURL}/api/kitchen/orders/${encodeURIComponent(orderId)}${authQuery()}`,
      { printed: true },
      { headers, timeout: REQUEST_TIMEOUT_MS },
    );
  } catch (e) {
    if (e.response?.status !== 404)
      logBackend('warn', 'Backend print: mark order printed failed', { orderId, message: e.message });
  }
}

async function addOrderToPrintQueue(orderId) {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) throw new Error('API base URL not set');
  const { data } = await axios.post(
    `${baseURL}/api/kitchen/orders/${encodeURIComponent(orderId)}/print${authQuery()}`,
    {},
    { headers, timeout: REQUEST_TIMEOUT_MS },
  );
  return data;
}

async function postLogs(logs) {
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return;
  const payload = Array.isArray(logs) ? logs : [logs];
  try {
    await axios.post(
      `${baseURL}/api/kitchen/client-logs${authQuery()}`,
      { logs: payload },
      { headers, timeout: REQUEST_TIMEOUT_MS },
    );
  } catch (e) {
    console.error('[Backend print] Failed to post logs', e);
  }
}

async function sendHeartbeat() {
  if (!hasBackendAuth()) return;
  const { baseURL, headers } = getAxiosConfig();
  if (!baseURL) return;
  try {
    await axios.post(
      `${baseURL}/api/kitchen/heartbeat${authQuery()}`,
      {},
      { headers, timeout: REQUEST_TIMEOUT_MS },
    );
  } catch (e) {
    if (!isNetworkError(e)) logBackend('warn', 'Backend print: heartbeat failed', { message: e.message });
  }
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

function getStartBlockReason() {
  const { apiBaseUrl } = loadBackendConfig();
  if (!apiBaseUrl || !apiBaseUrl.trim()) return 'api_base_url_missing';
  if (!hasBackendAuth()) return 'auth_missing';
  return null;
}

function clearReconnectTimer() {
  if (!reconnectTimer) return;
  clearInterval(reconnectTimer);
  reconnectTimer = null;
}

function ensureReconnectTimer() {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(async () => {
    if (pollTimer || reconnectInFlight || !printReceiptHandler) return;
    reconnectInFlight = true;
    try {
      await startBackendPolling();
    } finally {
      reconnectInFlight = false;
    }
  }, DEFAULT_RECONNECT_MS);
}

async function startBackendPolling(printReceiptFn, intervalMs = null) {
  if (typeof printReceiptFn === 'function') {
    printReceiptHandler = printReceiptFn;
  }
  if (!printReceiptHandler) {
    lastInactiveReason = 'no_print_handler';
    return;
  }
  if (pollTimer) return;
  const blockedReason = getStartBlockReason();
  if (blockedReason === 'api_base_url_missing') {
    lastInactiveReason = blockedReason;
    clearReconnectTimer();
    logBackend('warn', 'Backend print: polling not started, apiBaseUrl not configured');
    return;
  }
  if (blockedReason === 'auth_missing') {
    lastInactiveReason = blockedReason;
    clearReconnectTimer();
    logBackend('warn', 'Backend print: polling not started, device credentials or kitchen secret not set');
    return;
  }
  const ok = await checkHealth();
  if (!ok) {
    lastInactiveReason = 'health_check_failed';
    ensureReconnectTimer();
    logBackend('warn', 'Backend print: polling not started, backend health check failed');
    return;
  }
  const { apiBaseUrl } = loadBackendConfig();
  lastPollSucceeded = true;
  consecutivePollFailures = 0;
  lastInactiveReason = null;
  clearReconnectTimer();
  const { backendPollIntervalMs } = loadBackendConfig();
  const ms = intervalMs ?? backendPollIntervalMs ?? DEFAULT_POLL_MS;
  let processing = false;
  logBackend('info', 'Backend print: starting polling', { intervalMs: ms, apiBaseUrl });
  pollTimer = setInterval(async () => {
    if (processing) return;
    try {
      await flushPendingStatusUpdates();
      await sendHeartbeat();
      const jobs = await fetchPendingJobs();
      const statuses = getAllStatuses();
      logBackend('info', 'Backend print: fetched jobs', {
        count: jobs.length,
      });
      for (const job of jobs) {
        const backend = job.printStatus != null ? String(job.printStatus).toLowerCase() : 'queued';
        const idKey = job.id != null ? String(job.id) : '';
        const local = idKey ? statuses[idKey] : null;
        const localStatus = local && local.status ? String(local.status).toLowerCase() : null;
        if (backend === 'queued' && TERMINAL_STATUSES.includes(localStatus)) {
          try {
            await markJobComplete(job.queueId || job.id);
            await markOrderPrinted(job.orderId || job.id);
          } catch (e) {
            console.error('[Backend print] Failed to sync completed status to backend', e);
          }
        }
      }
      lastPollSucceeded = true;
      consecutivePollFailures = 0;
      const queuedJobs = jobs.filter((j) => {
        const backend = j.printStatus != null ? String(j.printStatus).toLowerCase() : 'queued';
        const idKey = j.id != null ? String(j.id) : '';
        const local = idKey ? statuses[idKey] : null;
        const localStatus = local && local.status ? String(local.status).toLowerCase() : null;
        return shouldProcessJob(backend, localStatus);
      });
      if (queuedJobs.length === 0) {
        if (jobs.length > 0) {
          logBackend('info', 'Backend print: no eligible jobs to process', {
            totalJobs: jobs.length,
          });
        }
        return;
      }
      if (isPrintingPaused()) {
        logBackend('info', 'Backend print: printing paused, not processing jobs', {
          pendingCount: queuedJobs.length,
        });
        return;
      }
      processing = true;
      const job = queuedJobs[0];
      try {
        logBackend('info', 'Backend print: processing job', {
          jobId: job.id,
          orderId: job.orderId,
          backendStatus: job.printStatus,
        });
        setOrderStatus(job.id, 'printing');
        await withTimeout(printReceiptHandler(job.payload || null), PRINT_TIMEOUT_MS);
        await markJobComplete(job.queueId || job.id);
        await markOrderPrinted(job.orderId || job.id);
        setOrderStatus(job.id, 'printed');
        logBackend('info', 'Backend print: job printed successfully', {
          jobId: job.id,
          orderId: job.orderId,
        });
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        console.error('[Backend print] Job failed:', job.id, msg);
        logBackend('error', 'Backend print: job failed', {
          jobId: job.id,
          orderId: job.orderId,
          error: msg,
        });
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
      logBackend('error', 'Backend print: poll error', {
        error: err && err.message ? err.message : String(err),
      });
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
  clearReconnectTimer();
  lastPollSucceeded = true;
  consecutivePollFailures = 0;
  lastInactiveReason = 'stopped';
}

function isPollingActive() {
  return pollTimer != null;
}

function getConnectionState() {
  return {
    pollingActive: pollTimer != null,
    reconnectScheduled: reconnectTimer != null,
    lastPollSucceeded: lastPollSucceeded,
    consecutivePollFailures: consecutivePollFailures,
    inactiveReason: lastInactiveReason,
  };
}

module.exports = {
  fetchPendingJobs,
  fetchHistoryJobs,
  fetchOrders,
  fetchClientInfo,
  fetchClientInfoState,
  markJobComplete,
  markJobFailed,
  markJobCancel,
  markJobSkipped,
  markOrderPrinted,
  addOrderToPrintQueue,
  postLogs,
  startBackendPolling,
  stopBackendPolling,
  isPollingActive,
  getConnectionState,
};
