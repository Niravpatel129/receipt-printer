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
  const [clientStale, setClientStale] = useState(false);
  const [clientRetrying, setClientRetrying] = useState(false);

  useEffect(() => {
    api.getAppVersion().then(setVersion);
    api.getLastUpdateStatus().then((cached) => {
      if (cached && typeof cached === 'object') setStatus(cached);
    });
    api.onUpdateStatus((data) => {
      setStatus({ ...data, at: data.at ?? Date.now() });
      if (data.state !== 'checking') setBusy(false);
    });
    return () => api.offUpdateStatus();
  }, []);

  useEffect(() => {
    let mounted = true;
    let retryDelay = 3000;
    let timer = null;
    let hasLoaded = false;
    const scheduleNext = (ms) => {
      if (!mounted) return;
      timer = setTimeout(loadClient, ms);
    };
    const loadClient = async () => {
      const config = await api.getBackendConfig();
      if (!mounted) return;
      if (!config.kitchenSecret) {
        setClient(null);
        setClientError('Set kitchen secret to see client.');
        setClientStale(false);
        setClientRetrying(false);
        setClientLoading(false);
        return;
      }
      if (!hasLoaded) setClientLoading(true);
      try {
        const state = await api.getBackendClientState();
        if (!mounted) return;
        const nextClient = state?.client || null;
        const nextError = state?.error || null;
        const retryable = Boolean(state?.retryable);
        if (nextClient) setClient(nextClient);
        setClientStale(Boolean(state?.stale));
        setClientError(nextError);
        setClientRetrying(retryable);
        retryDelay = retryable ? Math.min(retryDelay * 2, 30000) : 15000;
        scheduleNext(retryable ? retryDelay : 15000);
      } catch (e) {
        if (!mounted) return;
        setClientError(e?.message || 'Failed to load client.');
        setClientRetrying(true);
        retryDelay = Math.min(retryDelay * 2, 30000);
        scheduleNext(retryDelay);
      } finally {
        if (mounted) {
          setClientLoading(false);
          hasLoaded = true;
        }
      }
    };
    loadClient();
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [api]);

  const handleCheck = useCallback(async () => {
    let watchdog = null;
    setBusy(true);
    setStatus({ state: 'checking' });
    watchdog = setTimeout(() => {
      setStatus((prev) => (prev?.state === 'checking' ? { state: 'error', message: 'Update check timed out. Please try again.' } : prev));
      setBusy(false);
    }, 45000);
    try {
      await api.checkForUpdates();
    } catch {
      setStatus({ state: 'error', message: 'Update check failed' });
      setBusy(false);
    } finally {
      if (watchdog) clearTimeout(watchdog);
    }
  }, [api]);

  const handleInstall = useCallback(async () => {
    try {
      await api.installUpdate();
    } catch (e) {
      setStatus({ state: 'error', message: e?.message || 'Failed to install update' });
    }
  }, [api]);

  function statusLabel(state) {
    if (state === 'checking') return 'Checking';
    if (state === 'available') return 'Available';
    if (state === 'downloading') return 'Downloading';
    if (state === 'downloaded') return 'Ready';
    if (state === 'up-to-date') return 'Up to date';
    if (state === 'error') return 'Error';
    return 'Idle';
  }

  function statusText() {
    if (!status) return null;
    if (status.state === 'available') return `Update available — v${status.version}`;
    if (status.state === 'downloading') return `Downloading… ${status.progress != null ? Math.round(status.progress) + '%' : ''}`;
    if (status.state === 'downloaded') return `v${status.version} ready — install now or restart to auto-apply`;
    if (status.state === 'error') return status.message || 'Could not check for updates.';
    return STATUS_LABELS[status.state] ?? null;
  }

  const isBlocked = busy || status?.state === 'downloading' || status?.state === 'downloaded';
  const clientLines = client ? formatClient(client) : null;
  const statusTime = status?.at ? new Date(status.at).toLocaleTimeString() : null;
  const progressPercent = status?.state === 'downloaded'
    ? 100
    : (status?.state === 'downloading' && Number.isFinite(status?.progress))
      ? Math.max(0, Math.min(100, Math.round(status.progress)))
      : null;
  const showProgress = Boolean(status?.state === 'checking' || status?.state === 'available' || status?.state === 'downloading' || status?.state === 'downloaded');
  const isProgressIndeterminate = status?.state === 'checking' || status?.state === 'available';

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
        {status?.state === 'downloaded' && (
          <button
            type="button"
            className="queue-action-btn update-install-btn"
            onClick={handleInstall}
          >
            Install &amp; Restart
          </button>
        )}
        {status && statusText() && (
          <span className={`update-status-text update-status-${status.state}`}>
            {statusText()}
          </span>
        )}
      </div>
      {status?.state && (
        <div className="update-meta-row">
          <span className={`status-pill update-flow-pill update-flow-${status.state}`}>{statusLabel(status.state)}</span>
          {statusTime && <span className="update-meta-time">Last update check: {statusTime}</span>}
        </div>
      )}
      {showProgress && (
        <div className="update-progress-wrap" role="status" aria-live="polite">
          <div className="update-progress-track">
            <div
              className={`update-progress-fill${isProgressIndeterminate ? ' indeterminate' : ''}`}
              style={progressPercent != null ? { width: `${progressPercent}%` } : undefined}
            />
          </div>
          <span className="update-progress-text">
            {progressPercent != null ? `${progressPercent}%` : 'In progress…'}
          </span>
        </div>
      )}
      <div className="update-client">
        <h3 className="update-client-heading">Client</h3>
        {clientLoading && <p className="update-client-message">Loading…</p>}
        {!clientLoading && clientError && (
          <p className="update-client-message update-client-error">
            {clientError}
            {clientRetrying ? ' Retrying automatically…' : ''}
          </p>
        )}
        {!clientLoading && clientStale && clientLines && (
          <p className="update-client-message update-client-note">
            Showing last known client info while reconnecting.
          </p>
        )}
        {!clientLoading && clientLines && (
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
