const fs = require('fs');
const { getOrderStatusFilePath } = require('./config');

const BAD_KEY = '[object Object]';

function load() {
  try {
    const data = fs.readFileSync(getOrderStatusFilePath(), 'utf8');
    const store = JSON.parse(data);
    if (Object.prototype.hasOwnProperty.call(store, BAD_KEY)) {
      delete store[BAD_KEY];
      save(store);
    }
    return store;
  } catch {
    return {};
  }
}

function save(store) {
  fs.writeFileSync(getOrderStatusFilePath(), JSON.stringify(store), 'utf8');
}

function getOrderStatus(orderId) {
  const store = load();
  const key = orderId != null ? String(orderId) : '';
  return (key && store[key]) || null;
}

function setOrderStatus(orderId, status, error = null) {
  const store = load();
  const key = orderId != null ? String(orderId) : '';
  if (!key) return;
  store[key] = { status, error: error || undefined, at: Date.now() };
  save(store);
}

function getAllStatuses() {
  return load();
}

module.exports = { getOrderStatus, setOrderStatus, getAllStatuses };
