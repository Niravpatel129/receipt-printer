const fs = require('fs');
const { getOrderStatusFilePath } = require('./config');

function load() {
  try {
    const data = fs.readFileSync(getOrderStatusFilePath(), 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function save(store) {
  fs.writeFileSync(getOrderStatusFilePath(), JSON.stringify(store), 'utf8');
}

function getOrderStatus(orderId) {
  const store = load();
  return store[orderId] || null;
}

function setOrderStatus(orderId, status, error = null) {
  const store = load();
  store[orderId] = { status, error: error || undefined, at: Date.now() };
  save(store);
}

function getAllStatuses() {
  return load();
}

module.exports = { getOrderStatus, setOrderStatus, getAllStatuses };
