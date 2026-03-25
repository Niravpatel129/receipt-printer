let last = null;

function record(data) {
  last = data ? { ...data, at: Date.now() } : null;
}

function get() {
  return last;
}

module.exports = { record, get };
