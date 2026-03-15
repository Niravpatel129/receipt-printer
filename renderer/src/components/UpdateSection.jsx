import { useState, useEffect, useCallback } from 'react';

const STATUS_LABELS = {
  checking: 'Checking for updates…',
  'up-to-date': "You're up to date.",
};

function formatClient(client) {
  if (!client || typeof client !== 'object') return null;
  const c = client.client || client;
  const id = c.deviceId ?? c.id ?? c.device_id;
  const name = c.name ?? '';
  const lastSeen = c.lastSeenAt ?? c.lastSeen ?? c.last_seen_at;
  const status = c.status ?? '';
  const autoAssigned = c.autoAssigned ?? c.auto_assigned;
  const lines = [];
  if (id) lines.push({ label: 'Device ID', value: id });
  if (name) lines.push({ label: 'Name', value: name });
  if (status) lines.push({ label: 'Status', value: String(status) });
  if (lastSeen) lines.push({ label: 'Last seen', value: new Date(lastSeen).toLocaleString() });
  if (typeof autoAssigned === 'boolean') lines.push({ label: 'Auto-assigned', value: autoAssigned ? 'Yes' : 'No' });
  return lines.length ? lines : null;
}

export default function UpdateSection() {
  const api = window.printerApi;
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [client, setClient] = useState(null);
  const [clientLoading, setClientLoading] = useState(false);
  const [clientError, setClientError] = useState(null);

  useEffect(() => {
    api.getAppVersion().then(setVersion);
    api.onUpdateStatus((data) => {
      setStatus(data);
      if (data.state !== 'checking') setBusy(false);
    });
    return () => api.offUpdateStatus();
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const config = await api.getBackendConfig();
      if (!config.kitchenSecret) {
        setClient(null);
        setClientError('Set kitchen secret to see client.');
        return;
      }
      setClientLoading(true);
      setClientError(null);
      try {
        const data = await api.getBackendClient();
        if (!mounted) return;
        if (data) {
          setClient(data);
          setClientError(null);
        } else {
          setClient(null);
          setClientError('No client info from backend.');
        }
      } catch (e) {
        if (!mounted) return;
        setClient(null);
        setClientError(e?.message || 'Failed to load client.');
      } finally {
        if (mounted) setClientLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [api]);

  const handleCheck = useCallback(async () => {
    setBusy(true);
    setStatus({ state: 'checking' });
    try {
      await api.checkForUpdates();
    } catch {
      setStatus({ state: 'error', message: 'Update check failed' });
      setBusy(false);
    }
  }, [api]);

  function statusText() {
    if (!status) return null;
    if (status.state === 'available') return `Update available — v${status.version}`;
    if (status.state === 'downloading') return `Downloading… ${status.progress != null ? Math.round(status.progress) + '%' : ''}`;
    if (status.state === 'downloaded') return `v${status.version} ready — will install on next quit`;
    if (status.state === 'error') return status.message || 'Could not check for updates.';
    return STATUS_LABELS[status.state] ?? null;
  }

  const isBlocked = busy || status?.state === 'downloading' || status?.state === 'downloaded';
  const clientLines = client ? formatClient(client) : null;

  return (
    <div className="section-card">
      <h2>About</h2>
      <div className="update-version">
        <span className="update-version-label">Version</span>
        <span className="update-version-number">{version || '—'}</span>
      </div>
      <div className="update-actions">
        <button
          type="button"
          className="queue-action-btn"
          onClick={handleCheck}
          disabled={isBlocked}
        >
          {busy ? 'Checking…' : 'Check for Updates'}
        </button>
        {status && statusText() && (
          <span className={`update-status-text update-status-${status.state}`}>
            {statusText()}
          </span>
        )}
      </div>
      <div className="update-client">
        <h3 className="update-client-heading">Client</h3>
        {clientLoading && <p className="update-client-message">Loading…</p>}
        {!clientLoading && clientError && <p className="update-client-message update-client-error">{clientError}</p>}
        {!clientLoading && !clientError && clientLines && (
          <>
            <dl className="update-client-dl">
              {clientLines.map(({ label, value }) => (
                <div key={label} className="update-client-row">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <p className="update-client-message update-client-note">The name above is what admins see when choosing devices for &quot;Print to selected devices&quot;.</p>
          </>
        )}
        {!clientLoading && !clientError && !clientLines && client !== undefined && (
          <p className="update-client-message">No client details.</p>
        )}
      </div>
    </div>
  );
}
