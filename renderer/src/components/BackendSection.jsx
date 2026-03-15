export default function BackendSection({
  deviceId,
  deviceSecret,
  kitchenSecret,
  backendPollMs,
  onConfigChange,
  onSave,
  backendStatus,
}) {
  return (
    <section className="section-card">
      <h2>Backend</h2>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="device-id">Device ID</label>
          <input
            id="device-id"
            type="text"
            placeholder="Device ID"
            value={deviceId}
            onChange={(e) => onConfigChange({ deviceId: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label htmlFor="device-secret">Device secret</label>
          <input
            id="device-secret"
            type="password"
            placeholder="Device secret"
            value={deviceSecret}
            onChange={(e) => onConfigChange({ deviceSecret: e.target.value })}
          />
        </div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="kitchen-secret">Kitchen secret (fallback)</label>
          <input
            id="kitchen-secret"
            type="password"
            placeholder="Kitchen secret"
            value={kitchenSecret}
            onChange={(e) => onConfigChange({ kitchenSecret: e.target.value })}
          />
        </div>
        <div className="form-group">
          <label htmlFor="backend-poll-ms">Poll interval (ms)</label>
          <input
            id="backend-poll-ms"
            type="number"
            value={backendPollMs}
            min={2000}
            step={1000}
            onChange={(e) => onConfigChange({ backendPollIntervalMs: e.target.value })}
          />
        </div>
        <div className="form-group align-end">
          <button type="button" onClick={onSave}>
            Save
          </button>
        </div>
      </div>
      <p className="backend-status" title={backendStatus}>
        {backendStatus.length > 60 ? backendStatus.slice(0, 57) + '…' : backendStatus}
      </p>
    </section>
  );
}
