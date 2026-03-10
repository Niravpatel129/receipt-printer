export default function AppHeader({ connection, currentView, onNavigate }) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <h1 className="app-title">Receipt Printer</h1>
        <nav className="app-nav" role="tablist" aria-label="Main navigation">
          <button
            type="button"
            role="tab"
            aria-selected={currentView === 'queue'}
            aria-controls="panel-queue"
            id="tab-queue"
            className={`nav-link ${currentView === 'queue' ? 'active' : ''}`}
            onClick={() => onNavigate('queue')}
          >
            Queue
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={currentView === 'settings'}
            aria-controls="panel-settings"
            id="tab-settings"
            className={`nav-link ${currentView === 'settings' ? 'active' : ''}`}
            onClick={() => onNavigate('settings')}
          >
            Settings
          </button>
          {connection.show && (
            <div
              className={`connection-pill ${connection.connected ? 'connected' : 'disconnected'}`}
              role="status"
              aria-live="polite"
            >
              <span className="connection-dot" />
              {connection.message}
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
