import { useEffect } from 'react';

export default function LogModal({ logs, onClose }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="overlay visible"
      role="dialog"
      aria-modal="true"
      aria-labelledby="log-viewer-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="dialog">
        <h4 id="log-viewer-title">Application logs</h4>
        <div className="dialog-body">
          <pre className="log-viewer">{logs || 'No logs yet.'}</pre>
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

