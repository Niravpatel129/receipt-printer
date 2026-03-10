import { useState, useEffect, useCallback } from 'react';

const STATUS_LABELS = {
  checking: 'Checking for updates…',
  'up-to-date': "You're up to date.",
  error: 'Could not check for updates.',
};

export default function UpdateSection() {
  const api = window.printerApi;
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getAppVersion().then(setVersion);
    api.onUpdateStatus((data) => {
      setStatus(data);
      if (data.state !== 'checking') setBusy(false);
    });
    return () => api.offUpdateStatus();
  }, []);

  const handleCheck = useCallback(async () => {
    setBusy(true);
    setStatus({ state: 'checking' });
    await api.checkForUpdates();
  }, [api]);

  function statusText() {
    if (!status) return null;
    if (status.state === 'available') return `Update available — v${status.version}`;
    if (status.state === 'downloading') return `Downloading… ${status.progress != null ? Math.round(status.progress) + '%' : ''}`;
    if (status.state === 'downloaded') return `v${status.version} ready — will install on next quit`;
    return STATUS_LABELS[status.state] ?? null;
  }

  const isBlocked = busy || status?.state === 'downloading' || status?.state === 'downloaded';

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
    </div>
  );
}
