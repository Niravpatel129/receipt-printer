export default function PrinterSection({
  printers,
  selectedPrinter,
  onPrinterChange,
  onPrintNow,
  onAddToQueue,
  queuePendingCount,
}) {
  return (
    <section className="section-card">
      <h2>Printer</h2>
      <div className="form-row">
        <div className="form-group">
          <label htmlFor="printer-select">Printer</label>
          <select
            id="printer-select"
            value={selectedPrinter}
            onChange={(e) => onPrinterChange(e.target.value)}
          >
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group align-end">
          <button type="button" onClick={onPrintNow}>
            Print now
          </button>
        </div>
        <div className="form-group align-end">
          <button type="button" className="secondary" onClick={onAddToQueue}>
            Add to queue
          </button>
        </div>
      </div>
      <p className="queue-status">Queue: {queuePendingCount} pending</p>
    </section>
  );
}
