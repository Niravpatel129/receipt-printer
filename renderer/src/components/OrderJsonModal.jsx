import { useEffect } from 'react';

export default function OrderJsonModal({ order, onClose }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const title = `Order ${order?.orderNumber || order?.id || ''}`;
  const jsonStr = (() => {
    try {
      return JSON.stringify(order, null, 2);
    } catch {
      return String(order);
    }
  })();

  return (
    <div
      className="overlay visible"
      role="dialog"
      aria-modal="true"
      aria-labelledby="order-json-title"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="dialog">
        <h4 id="order-json-title">{title}</h4>
        <div className="dialog-body">
          <pre>{jsonStr}</pre>
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
