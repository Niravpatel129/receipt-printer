import PrinterSection from '../components/PrinterSection';
import BackendSection from '../components/BackendSection';
import UpdateSection from '../components/UpdateSection';

export default function SettingsView({
  printers,
  selectedPrinter,
  onPrinterChange,
  onPrintNow,
  onAddToQueue,
  queuePendingCount,
  deviceId,
  deviceSecret,
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
          deviceId={deviceId}
          deviceSecret={deviceSecret}
          kitchenSecret={kitchenSecret}
          backendPollMs={backendPollMs}
          onConfigChange={onBackendConfigChange}
          onSave={onBackendSave}
          backendStatus={backendStatus}
        />
        <UpdateSection />
      </div>
    </div>
  );
}
