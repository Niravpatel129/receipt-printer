import { useState, useEffect, useCallback, useRef } from 'react';
import AppHeader from './components/AppHeader';
import QueueView from './views/QueueView';
import SettingsView from './views/SettingsView';
import OrderJsonModal from './components/OrderJsonModal';
import ConfirmModal from './components/ConfirmModal';
import ToastContainer from './components/ToastContainer';

const TITLE_BASE = 'Receipt Printer';

function setWindowTitle(connected, message) {
  const dot = connected ? '\u{1F7E2}' : '\u{1F534}';
  document.title = `${dot} ${TITLE_BASE} — ${message}`;
}

export default function App() {
  const [initialLoad, setInitialLoad] = useState(true);
  const [connection, setConnection] = useState({ show: false, connected: false, message: 'Loading…' });
  const [printers, setPrinters] = useState([]);
  const [selectedPrinter, setSelectedPrinter] = useState('');
  const [queuePendingCount, setQueuePendingCount] = useState(0);
  const [backendConfig, setBackendConfig] = useState({ kitchenSecret: '', backendPollIntervalMs: 5000 });
  const [backendStatus, setBackendStatus] = useState('');
  const [orders, setOrders] = useState([]);
  const [view, setView] = useState('queue');
  const [orderJsonModal, setOrderJsonModal] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [toasts, setToasts] = useState([]);
  const confirmResolveRef = useRef(null);

  const api = window.printerApi;

  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const confirmDialog = useCallback((message) => {
    return new Promise((resolve) => {
      confirmResolveRef.current = resolve;
      setConfirm({ message });
    });
  }, []);

  const resolveConfirm = useCallback((ok) => {
    if (confirmResolveRef.current) confirmResolveRef.current(ok);
    setConfirm(null);
  }, []);

  const wasDisconnectedRef = useRef(false);
  const refreshConnectionStatus = useCallback(async () => {
    const state = await api.getBackendConnectionState();
    if (state.pollingActive) {
      const connected = state.lastPollSucceeded;
      const message = connected ? 'Connected' : 'Reconnecting…';
      if (wasDisconnectedRef.current && connected) {
        wasDisconnectedRef.current = false;
        addToast('Backend reconnected', 'success');
      } else if (!connected) {
        wasDisconnectedRef.current = true;
      }
      setConnection({ show: true, connected, message });
      setWindowTitle(connected, message);
      return;
    }
    wasDisconnectedRef.current = false;
    const config = await api.getBackendConfig();
    if (!config.kitchenSecret) {
      setConnection({ show: true, connected: false, message: 'Kitchen secret not set' });
      setWindowTitle(false, 'Kitchen secret not set');
      return;
    }
    setConnection({ show: true, connected: false, message: 'Polling inactive' });
    setWindowTitle(false, 'Polling inactive');
  }, [api, addToast]);

  const refreshQueue = useCallback(async () => {
    const queue = await api.getPrintQueue();
    const pending = queue.filter((j) => j.status === 'pending' || j.status === 'printing');
    setQueuePendingCount(pending.length);
  }, [api]);

  const refreshBackendStatus = useCallback(async () => {
    const config = await api.getBackendConfig();
    if (!config.kitchenSecret) {
      setBackendStatus('Set kitchen secret and Save to poll for print jobs.');
      setOrders([]);
      return;
    }
    try {
      const jobs = await api.fetchBackendPendingJobs();
      setBackendStatus(`${config.apiBaseUrl} — ${jobs.length} pending on server`);
      setOrders(jobs);
    } catch (e) {
      setBackendStatus(`${config.apiBaseUrl} — error: ${e.message}`);
      setOrders([]);
    }
  }, [api]);

  useEffect(() => {
    setWindowTitle(false, 'Loading…');
    let mounted = true;
    (async () => {
      const [printersList, savedPrinter, cfg] = await Promise.all([
        api.getPrinters(),
        api.getPrinterPreference(),
        api.getBackendConfig(),
      ]);
      if (!mounted) return;
      setPrinters(printersList);
      setBackendConfig({
        kitchenSecret: cfg.kitchenSecret || '',
        backendPollIntervalMs: cfg.backendPollIntervalMs ?? 5000,
      });
      if (savedPrinter) {
        setSelectedPrinter(savedPrinter);
      } else if (printersList.length) {
        const first = printersList[0].name;
        setSelectedPrinter(first);
        await api.setPrinterPreference(first);
      }
      await refreshQueue();
      await refreshBackendStatus();
      await refreshConnectionStatus();
      if (mounted) setInitialLoad(false);
    })();
    return () => { mounted = false; };
  }, [api]);

  useEffect(() => {
    const t1 = setInterval(refreshQueue, 3000);
    const t2 = setInterval(refreshBackendStatus, 2000);
    const t3 = setInterval(refreshConnectionStatus, 3000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
      clearInterval(t3);
    };
  }, [refreshQueue, refreshBackendStatus, refreshConnectionStatus]);

  const handlePrinterChange = useCallback((name) => {
    setSelectedPrinter(name);
    api.setPrinterPreference(name);
  }, [api]);

  const handlePrintNow = useCallback(async () => {
    try {
      const result = await api.printReceipt();
      addToast(result.ok ? 'Receipt sent to printer' : 'Print failed', result.ok ? 'success' : 'error');
    } catch (e) {
      addToast('Print failed: ' + e.message, 'error');
    }
  }, [api, addToast]);

  const handleAddToQueue = useCallback(async () => {
    try {
      await api.enqueuePrintJob();
      await refreshQueue();
      addToast('Added to queue');
    } catch (e) {
      addToast('Failed to enqueue: ' + e.message, 'error');
    }
  }, [api, refreshQueue, addToast]);

  const handleBackendSave = useCallback(async () => {
    await api.setBackendConfig({
      kitchenSecret: backendConfig.kitchenSecret || undefined,
      backendPollIntervalMs: parseInt(backendConfig.backendPollIntervalMs, 10) || 5000,
    });
    addToast('Backend settings saved');
    await refreshConnectionStatus();
    await refreshBackendStatus();
  }, [api, backendConfig, refreshConnectionStatus, refreshBackendStatus, addToast]);

  const handleBackendConfigChange = useCallback((updates) => {
    setBackendConfig((c) => ({ ...c, ...updates }));
  }, []);

  const handleNavigate = useCallback((nextView) => {
    setView(nextView);
  }, []);

  if (initialLoad) {
    return (
      <div className="app-loading">
        <div className="app-loading-spinner" aria-hidden />
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <>
      <AppHeader connection={connection} currentView={view} onNavigate={handleNavigate} />

      <main className="app-main">
        <div className="app-content" id="panel-queue" role="tabpanel" aria-labelledby="tab-queue" hidden={view !== 'queue'}>
          <QueueView
            orders={orders}
            onShowOrderJson={setOrderJsonModal}
            onRefresh={refreshBackendStatus}
            confirmDialog={confirmDialog}
            addToast={addToast}
            api={api}
          />
        </div>
        <div className="app-content" id="panel-settings" role="tabpanel" aria-labelledby="tab-settings" hidden={view !== 'settings'}>
          <SettingsView
            printers={printers}
            selectedPrinter={selectedPrinter}
            onPrinterChange={handlePrinterChange}
            onPrintNow={handlePrintNow}
            onAddToQueue={handleAddToQueue}
            queuePendingCount={queuePendingCount}
            kitchenSecret={backendConfig.kitchenSecret}
            backendPollMs={backendConfig.backendPollIntervalMs}
            onBackendConfigChange={handleBackendConfigChange}
            onBackendSave={handleBackendSave}
            backendStatus={backendStatus}
          />
        </div>
      </main>

      {orderJsonModal && (
        <OrderJsonModal order={orderJsonModal} onClose={() => setOrderJsonModal(null)} />
      )}

      {confirm && (
        <ConfirmModal
          message={confirm.message}
          onConfirm={() => resolveConfirm(true)}
          onCancel={() => resolveConfirm(false)}
        />
      )}

      <ToastContainer toasts={toasts} />
    </>
  );
}
