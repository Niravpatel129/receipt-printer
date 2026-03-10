import PrinterSection from '../components/PrinterSection';
import BackendSection from '../components/BackendSection';

export default function SettingsView({
  printers,
  selectedPrinter,
  onPrinterChange,
  onPrintNow,
  onAddToQueue,
  queuePendingCount,
  kitchenSecret,
  backendPollMs,
  onBackendConfigChange,
  onBackendSave,
  backendStatus,
}) {
  return (
    <div className="view view-settings">
      <h2 className="view-title" id="settings-heading">Settings</h2>
      <div className="settings-content">
        <PrinterSection
          printers={printers}
          selectedPrinter={selectedPrinter}
          onPrinterChange={onPrinterChange}
          onPrintNow={onPrintNow}
          onAddToQueue={onAddToQueue}
          queuePendingCount={queuePendingCount}
        />
        <BackendSection
          kitchenSecret={kitchenSecret}
          backendPollMs={backendPollMs}
          onConfigChange={onBackendConfigChange}
          onSave={onBackendSave}
          backendStatus={backendStatus}
        />
      </div>
    </div>
  );
}
