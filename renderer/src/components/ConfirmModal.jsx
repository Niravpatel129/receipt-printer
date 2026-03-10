import { useEffect, useRef } from 'react';

export default function ConfirmModal({ message, onConfirm, onCancel }) {
  const cancelRef = useRef(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="overlay visible"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="dialog">
        <h4 id="confirm-title">Confirm</h4>
        <div className="dialog-body">
          <p>{message}</p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="secondary" ref={cancelRef} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
