import QueueTable from '../components/QueueTable';

export default function QueueView({ orders, onShowOrderJson, onRefresh, confirmDialog, addToast, api }) {
  return (
    <div className="view view-queue">
      <QueueTable
        orders={orders}
        onShowOrderJson={onShowOrderJson}
        onRefresh={onRefresh}
        confirmDialog={confirmDialog}
        addToast={addToast}
        api={api}
      />
    </div>
  );
}
