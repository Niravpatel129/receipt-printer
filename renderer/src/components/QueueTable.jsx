import { useMemo, useState } from 'react';

const STATUS_LABELS = {
  printed: 'Sent',
  completed: 'Done elsewhere',
  failed: 'Failed',
  pending: 'Pending',
  printing: 'Printing…',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
};

function filterOrders(orders, query) {
  if (!query || !query.trim()) return orders;
  const q = query.trim().toLowerCase();
  return orders.filter(
    (o) =>
      String(o.orderNumber || '')
        .toLowerCase()
        .includes(q) ||
      String(o.customerName || '')
        .toLowerCase()
        .includes(q) ||
      String(o.storeName || '')
        .toLowerCase()
        .includes(q) ||
      String(o.id || '')
        .toLowerCase()
        .includes(q),
  );
}

function formatTotal(total) {
  return typeof total === 'number' ? `$${total.toFixed(2)}` : total || '';
}

function OrderDetailRow({ order, status }) {
  const p = order.payload || {};
  const fulfillment = (order.fulfillmentType || '').replace(/^\w/, (c) => c.toUpperCase());
  const payment = (order.paymentMethod || '').replace(/^\w/, (c) => c.toUpperCase());
  const receiptHeader =
    [p.storeName, [p.address, p.city].filter(Boolean).join(', ')].filter(Boolean).join(' — ') ||
    '—';
  const receiptItems =
    (p.items || [])
      .map((it) => {
        const toppings = (it.toppings || []).length
          ? '<br>' + (it.toppings || []).map((t) => '  ' + t).join('<br>')
          : '';
        return `${it.num || ''} ${it.name || ''} ${it.amount || ''}${toppings}`;
      })
      .join('<br>') || '—';
  const receiptFooter = [p.website, p.footerMessage].filter(Boolean).join(' · ') || '—';
  const cardAuth =
    [p.cardLastFour && `Card ****${p.cardLastFour}`, p.authCode && `Auth ${p.authCode}`]
      .filter(Boolean)
      .join(' · ') || '';
  const itemsWithOptions =
    (order.items || [])
      .map((it) => {
        const opts = (it.options || it.modifiers || []).length
          ? '<br><small>' +
            (it.options || it.modifiers || []).map((m) => '  ' + m).join('<br>') +
            '</small>'
          : '';
        return `${it.name || it.title || ''} ×${it.quantity || 1} $${typeof it.price === 'number' ? it.price.toFixed(2) : it.price || '0'}${opts}`;
      })
      .join('<br>') || '—';
  const subtotalStr = order.subtotal != null ? `$${Number(order.subtotal).toFixed(2)}` : '—';
  const taxStr = order.tax != null ? `$${Number(order.tax).toFixed(2)}` : '—';
  const deliveryStr = order.deliveryFee != null ? `$${Number(order.deliveryFee).toFixed(2)}` : '—';
  const totalStrDetail =
    order.total != null ? `$${Number(order.total).toFixed(2)}` : p.total || '—';

  return (
    <tr className='queue-detail-row' data-order-id={order.id}>
      <td colSpan={11}>
        <div className='detail-grid'>
          <div className='detail-section'>
            <strong>Receipt</strong>
            <br />
            {receiptHeader}
            <br />
            Order #{p.orderNumber || ''} · {p.customerName || ''}
            <br />
            {p.date || ''}
            <br />
            <span dangerouslySetInnerHTML={{ __html: receiptItems }} />
            <br />
            Items: {p.itemCount || ''} · Total: {p.total || ''}
            {cardAuth ? (
              <>
                <br />
                {cardAuth}
              </>
            ) : null}
            {p.barcode ? (
              <>
                <br />
                Barcode: {p.barcode}
              </>
            ) : null}
            <br />
            {receiptFooter}
          </div>
          <div className='detail-section'>
            <strong>Items</strong>
            <br />
            <span dangerouslySetInnerHTML={{ __html: itemsWithOptions }} />
          </div>
          <div className='detail-section'>
            <strong>Totals</strong>
            <br />
            Subtotal: {subtotalStr}
            <br />
            Tax: {taxStr}
            <br />
            Delivery: {deliveryStr}
            <br />
            Total: {totalStrDetail}
          </div>
          <div className='detail-section'>
            <strong>Customer</strong>
            <br />
            {order.customerName || ''}
            <br />
            {order.customerPhone || '—'}
            <br />
            {order.customerEmail || '—'}
          </div>
          <div className='detail-section'>
            <strong>Order</strong>
            <br />
            Fulfillment: {fulfillment}
            <br />
            Payment: {payment}
            <br />
            Status: {order.status || ''}
          </div>
          <div className='detail-section'>
            <strong>Notes</strong>
            <br />
            {order.notes != null ? order.notes : '—'}
          </div>
          {status === 'failed' && order.printError && (
            <div className='detail-section'>
              <strong>Print error</strong>
              <br />
              {order.printError}
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function OrderRow({
  order,
  onShowJson,
  onRefresh,
  confirmDialog,
  addToast,
  api,
  detailOpen,
  onToggleDetails,
}) {
  const [printing, setPrinting] = useState(false);

  const dateStr = order.date ? new Date(order.date).toLocaleString() : '';
  const totalStr = formatTotal(order.total);
  const fulfillment = (order.fulfillmentType || '').replace(/^\w/, (c) => c.toUpperCase());
  const payment = (order.paymentMethod || '').replace(/^\w/, (c) => c.toUpperCase());
  const itemCount =
    order.itemCount != null ? order.itemCount : Array.isArray(order.items) ? order.items.length : 0;
  const status = order.printStatus || 'pending';
  const statusLabel = STATUS_LABELS[status] || 'Pending';
  const statusClass = 'status-' + (status || 'pending');
  const canPrint = status !== 'printed' && status !== 'completed' && status !== 'printing';
  const canRetry = status === 'failed';
  const canCancel = status !== 'printed' && status !== 'completed' && status !== 'cancelled';

  const handlePrint = async () => {
    if (!order.payload) return;
    setPrinting(true);
    if (order.printStatus === 'failed') await api.setOrderPrintStatus(order.id, 'pending');
    try {
      await api.printReceipt(order.payload);
      await api.setOrderPrintStatus(order.id, 'printed');
      addToast('Sent to printer');
    } catch (err) {
      const msg = err.message || String(err);
      await api.setOrderPrintStatus(order.id, 'failed', msg);
      addToast('Print failed: ' + msg, 'error');
    } finally {
      setPrinting(false);
      onRefresh();
    }
  };

  const handleCancel = async () => {
    const ok = await confirmDialog('Remove this order from the print queue?');
    if (!ok) return;
    await api.cancelOrderInQueue(order.id);
    addToast('Order removed from queue');
    onRefresh();
  };

  return (
    <>
      <tr
        className='queue-row'
        onClick={(e) => {
          if (!e.target.closest('button')) onShowJson(order);
        }}
      >
        <td>
          <button
            type='button'
            className='queue-details-btn'
            title={detailOpen ? 'Hide details' : 'Toggle details'}
            aria-label={detailOpen ? 'Hide details' : 'Show details'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleDetails(order.id);
            }}
          >
            {detailOpen ? '▲' : '▼'}
          </button>
        </td>
        <td>
          <strong>{order.orderNumber || order.id || ''}</strong>
        </td>
        <td>{order.customerName || ''}</td>
        <td>{itemCount}</td>
        <td>{totalStr}</td>
        <td>{fulfillment}</td>
        <td>{payment}</td>
        <td>{dateStr}</td>
        <td>{order.storeName || ''}</td>
        <td>
          <span
            className={`status-pill ${statusClass}`}
            title={status === 'failed' && order.printError ? order.printError : status === 'printed' ? 'Sent to printer' : status === 'completed' ? 'Printed on another device' : statusLabel}
          >
            {statusLabel}
          </span>
        </td>
        <td>
          <div className='queue-actions'>
            {canPrint && (
              <button
                type='button'
                className='queue-print-btn'
                disabled={printing}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePrint();
                }}
              >
                {canRetry ? 'Retry' : 'Print now'}
              </button>
            )}
            {canCancel && (
              <button
                type='button'
                className='queue-action-btn cancel-btn'
                onClick={(e) => {
                  e.stopPropagation();
                  handleCancel();
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </td>
      </tr>
      {detailOpen && <OrderDetailRow order={order} status={status} />}
    </>
  );
}

export default function QueueTable({
  orders,
  onShowOrderJson,
  onRefresh,
  confirmDialog,
  addToast,
  api,
}) {
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [openOrderId, setOpenOrderId] = useState(null);
  const filtered = useMemo(() => filterOrders(orders || [], search), [orders, search]);

  const handleToggleDetails = (orderId) => {
    setOpenOrderId((current) => (current === orderId ? null : orderId));
  };

  return (
    <section className='section-card queue-section'>
      <div className='queue-section-header'>
        <h2>Print queue</h2>
        <div className='queue-section-header-right'>
          <span className='queue-count'>
            {filtered.length} order{filtered.length !== 1 ? 's' : ''}
          </span>
          <button
            type='button'
            className={`queue-refresh-btn${refreshing ? ' is-refreshing' : ''}`}
            disabled={refreshing}
            onClick={async () => {
              if (refreshing) return;
              setRefreshing(true);
              try {
                await onRefresh();
              } finally {
                setRefreshing(false);
              }
            }}
          >
            {refreshing ? (
              <span className='queue-refresh-inner'>
                <span className='queue-refresh-spinner' aria-hidden />
                <span className='queue-refresh-label'>Refreshing…</span>
              </span>
            ) : (
              <span className='queue-refresh-inner'>
                <span className='queue-refresh-icon' aria-hidden>
                  ⟳
                </span>
                <span className='queue-refresh-label'>Refresh</span>
              </span>
            )}
          </button>
        </div>
      </div>
      <div className='queue-toolbar'>
        <input
          type='search'
          className='queue-search'
          placeholder='Search by order #, customer, store…'
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label='Search orders'
        />
      </div>
      {filtered.length > 0 && (
        <div className='queue-table-wrap'>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Order #</th>
                <th>Customer</th>
                <th>Items</th>
                <th>Total</th>
                <th>Fulfillment</th>
                <th>Payment</th>
                <th>Date</th>
                <th>Store</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  onShowJson={onShowOrderJson}
                  onRefresh={onRefresh}
                  confirmDialog={confirmDialog}
                  addToast={addToast}
                  api={api}
                  detailOpen={openOrderId === order.id}
                  onToggleDetails={handleToggleDetails}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(!orders || orders.length === 0) && (
        <div className='queue-empty'>
          <p className='queue-empty-title'>No orders in queue</p>
          <p className='queue-empty-hint'>Configure the backend and save to poll for orders.</p>
        </div>
      )}
      {orders && orders.length > 0 && filtered.length === 0 && (
        <div className='queue-empty'>
          <p className='queue-empty-title'>No matching orders</p>
          <p className='queue-empty-hint'>Try a different search.</p>
        </div>
      )}
    </section>
  );
}
