## Backend print queue – debug notes

This document captures what the desktop app is doing with backend print jobs, what we’re seeing for the example job, and potential issues/solutions.

---

## 1. Example stuck job

Sample job document from the backend:

```json
{
  "_id": { "$oid": "69b6c37ae161cf55d5bb0694" },
  "order": { "$oid": "69b650cbe2d9bf437b6a6473" },
  "addedAt": { "$date": "2026-03-15T14:34:34.766Z" },
  "history": [
    {
      "at": { "$date": "2026-03-15T14:34:34.766Z" },
      "status": "queued",
      "message": null
    }
  ],
  "failedAt": null,
  "failedMessage": null,
  "printedAt": null,
  "skippedAt": null,
  "skippedReason": null,
  "canceledAt": null,
  "canceledReason": null
}
```

Key observations:

- **Backend status**: only `queued` is present in `history`.
- **No failure fields**: `failedAt` and `failedMessage` are null.
- **No terminal status**: `printedAt`, `skippedAt`, `canceledAt` are all null.

From the backend’s perspective this job is still just “queued once, never attempted”.

---

## 2. How the desktop app normalizes backend jobs

`main/services/backendPrintService.js`:

```js
const TERMINAL_STATUSES = ['printed', 'cancelled', 'canceled', 'failed', 'skipped'];
```

When polling for jobs:

```js
async function fetchPendingJobs() {
  // ...
  const orders = data.orders || data.jobs || (Array.isArray(data) ? data : []);
  const toIdString = (v) => { /* ... */ };
  const normId = (o) => toIdString(o._id != null ? o._id : o.id);

  return orders
    .filter((o) => o && (o._id != null || o.id != null || o.order != null || o.orderId != null))
    .map((order) => {
      const rawOrder = order.order && typeof order.order === 'object' ? order.order : order;
      const orderId =
        rawOrder._id != null
          ? normId(rawOrder)
          : toIdString(order.orderId != null ? order.orderId : order.order_id);
      const queueId =
        order.queueId != null
          ? toIdString(order.queueId)
          : order.queue_id != null
            ? toIdString(order.queue_id)
            : normId(order);
      let printStatus =
        typeof order.printStatus === 'string' && order.printStatus
          ? String(order.printStatus).toLowerCase()
          : 'queued';
      if (printStatus === 'canceled') printStatus = 'cancelled';

      return {
        id: queueId,
        orderId,
        queueId,
        queueAddedAt: order.queueAddedAt || order.addedAt || null,
        printStatus,
        // ...
        lastFailedAt: order.lastFailedAt || order.failedAt || null,
        lastFailedMessage: order.lastFailedMessage || order.failedMessage || null,
        lastSkippedAt: order.lastSkippedAt || order.skippedAt || null,
        lastSkippedReason: order.lastSkippedReason || order.skippedReason || null,
      };
    });
}
```

Important points:

- The **job id the app uses** is `queueId` / `_id` / `id` from the queue record, normalized to string.
- The app expects failure information to be available as either `lastFailedAt`/`lastFailedMessage` or `failedAt`/`failedMessage` on the job wrapper object returned by `GET /api/kitchen/print-queue`.

For the sample job, because `failedAt` and `failedMessage` are null, the app shows no backend failure metadata for that job.

---

## 3. Local status store vs backend status

The app has a **local** status store on disk, separate from backend fields:

```js
// main/orderStatusStore.js
function setOrderStatus(orderId, status, error = null) {
  const store = load();
  const key = orderId != null ? String(orderId) : '';
  if (!key) return;
  store[key] = { status, error: error || undefined, at: Date.now() };
  save(store);
}
```

This is written to when printing:

```js
// main/services/backendPrintService.js
setOrderStatus(job.id, 'printing');
// ...
await markJobComplete(job.queueId || job.id);
await markOrderPrinted(job.orderId || job.id);
setOrderStatus(job.id, 'printed');
// ...
} catch (err) {
  const msg = err && err.message ? err.message : String(err);
  setOrderStatus(job.id, 'failed', msg);
  const isClientConfigError = /no printer selected|printer.*dropdown/i.test(msg);
  if (isClientConfigError) {
    await markJobSkipped(job.queueId || job.id, 'no_printer_selected');
  } else {
    await markJobFailed(job.queueId || job.id, msg);
  }
}
```

The UI computes the combined status like this:

```js
// main/ipc/index.js
const TERMINAL_STATUSES = ['printed', 'completed', 'cancelled', 'failed', 'skipped'];

function computeUiPrintStatus(backendStatus, localStatus) {
  let b = backendStatus ? String(backendStatus).toLowerCase() : null;
  if (b === 'canceled') b = 'cancelled';
  const l = localStatus ? String(localStatus).toLowerCase() : null;
  if (l === 'printing' || l === 'pending') return l;
  if (TERMINAL_STATUSES.includes(b)) return b;
  if (TERMINAL_STATUSES.includes(l)) return l;
  if (b === 'printed' || b === 'complete') return l === 'printed' ? 'printed' : 'completed';
  return 'pending';
}
```

What this means:

- The **backend status** and **local status** are merged for display.
- If the local status is `failed`, the UI will show the job as `Failed` even if the backend still says `queued`.
- The detailed error shown in the UI (`printError`) comes purely from the local store.

---

## 4. Why a job can look “stuck” in failed

The polling loop first checks whether a job should be processed:

```js
// main/services/backendPrintService.js
function shouldProcessJob(backendStatus, localStatus) {
  const b = backendStatus ? String(backendStatus).toLowerCase() : null;
  const l = localStatus ? String(localStatus).toLowerCase() : null;

  if (l === 'pending') return true;

  if (l === 'printing') return false;
  if (TERMINAL_STATUSES.includes(l)) return false;
  if (TERMINAL_STATUSES.includes(b)) return false;
  return true;
}
```

For the sample job in a “stuck” state:

- Backend still says `queued`.
- Local status is `failed` for that job id in `print-order-status.json`.

Result:

- `shouldProcessJob('queued', 'failed')` returns **false** because `failed` is in `TERMINAL_STATUSES`.
- The job is never picked up again by the poller on that machine.
- The UI continues to show `Failed` because the local status is terminal, even though the backend has not recorded a terminal state.

The only way for this job to be processed again on that device is if the local status is reset back to `pending`.

---

## 5. How Retry is supposed to work

The React `QueueTable` maps the Retry button to a local status reset:

```js
// renderer/src/components/QueueTable.jsx
const canRetry = status === 'failed';

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
```

`api.setOrderPrintStatus` goes through IPC to `setOrderStatus`:

```js
// main/ipc/index.js
ipcMain.handle('set-order-print-status', (_, orderId, status, error) => {
  setOrderStatus(orderId, status, error);
});
```

Expected flow for Retry:

1. User clicks Retry on a job with `printStatus === 'failed'`.
2. Local status for that job id is updated to `pending`.
3. On next poll, `shouldProcessJob('queued', 'pending')` returns true.
4. Poller attempts to print again and then:
   - Marks success (`complete` endpoint + local `printed`), or
   - Marks failure again (`failed` endpoint + local `failed`).

If a job remains stuck in `Failed` after clicking Retry, it usually means either:

- The local status file was not updated correctly (e.g. id mismatch or write issue).
- The UI is not actually calling `setOrderPrintStatus` for that job id.

---

## 6. Backend expectations for failure tracking

From `backend-print-retry-spec.md` and `backend-print-status-api.md`:

- On `POST /api/kitchen/print-jobs/:id/failed` the backend should:
  - Increment an attempt counter.
  - Set `status = "failed"`.
  - Set `lastFailedAt` (or `failedAt`).
  - Set `lastFailedMessage` (or `failedMessage`) from the request body.
  - Optionally append to a `history` array with `{ at, status: "failed", message }`.

- On `GET /api/kitchen/print-queue` the backend should include:
  - `status` / `printStatus` for the job.
  - Failure metadata:
    - `lastFailedAt` and `lastFailedMessage` (or compatible field names the desktop app maps to).

In the stuck-job example:

- `history` only contains `queued`.
- `failedAt` and `failedMessage` are null.
- That means the `/failed` endpoint is either not implemented, not called, or not writing back into this document.

Implications:

- The desktop app has no way to tell from the backend that a real attempt was made and failed.
- Other devices polling the queue will just see it as queued (no failure info), unless they share the same local status file.

---

## 7. Potential issues and concrete fixes

### 7.1 Issue: Job appears “stuck in failed” on one device

**Symptom**

- UI shows job status as `Failed`.
- Retry button exists, but job never seems to re-process.
- Backend record still only shows `queued` with no `failedAt` or `failedMessage`.

**Root cause**

- Local status for that job id in `print-order-status.json` is `failed` (a terminal state).
- `shouldProcessJob` refuses to process jobs with a terminal local status.
- Backend has not marked the job as failed or otherwise terminal, so from server side it stays queued forever.

**Fix options**

- **Use the Retry button**:
  - Ensure Retry is clicked on that exact job in the app.
  - Confirm that `print-order-status.json` now has `status: "pending"` for that id.

- **Manual reset (for debugging)**
  - Close the desktop app.
  - Delete the entry for that job id from `print-order-status.json`, or remove the file entirely.
  - Reopen the app; it will re-fetch from the backend and treat the job as `pending` again.

- **Hardening (optional)**
  - Add a small “Reset local status” debug control in the UI that clears local status for a selected job id.

### 7.2 Issue: Backend never records failures

**Symptom**

- Job documents never get `failedAt` / `failedMessage` populated.
- `history` does not include a `failed` entry even though the app showed an error.

**Root causes**

- `/api/kitchen/print-jobs/:id/failed` is missing or returns an error.
- The handler updates a different collection or field than the one used by `GET /api/kitchen/print-queue`.

**Expected behavior (per spec)**

- On each real print failure, the desktop app calls:

  ```http
  POST /api/kitchen/print-jobs/:id/failed?secret=...
  { "message": "error description" }
  ```

- The backend should:
  - Update the job row/document for that `:id`.
  - Set status and failure metadata.
  - Optionally update `history`.

**Fix**

- Implement `POST /api/kitchen/print-jobs/:id/failed` so it:
  - Loads the job by id.
  - Updates `status`, `failedAt`, `failedMessage`, `history`, and any attempt counters as in `backend-print-retry-spec.md`.
  - Returns `200`/`204` on success.
- Ensure `GET /api/kitchen/print-queue` reads from the same record and exposes:
  - `status` / `printStatus`.
  - `lastFailedAt` as `failedAt` or `lastFailedAt`.
  - `lastFailedMessage` as `failedMessage` or `lastFailedMessage`.

### 7.3 Issue: Multiple devices see inconsistent status

**Symptom**

- One device shows a job as `Failed`.
- Another device, polling the same backend, shows it as `Queued` or `Pending`.

**Explanation**

- Local status is stored per device (per `userData` directory).
- Backend status is shared.
- If the backend does not record failure metadata, other devices cannot see that the job failed elsewhere.

**Fix**

- Make sure the backend:
  - Properly records failure attempts.
  - Returns failure metadata in the queue payload.
- Devices can then use the spec’s recommended fields (`attemptCount`, `lastFailedAt`, etc.) to present consistent history, even if local state differs.

---

## 8. Recommended backend model alignment

To align the backend with the desktop spec:

- Add / confirm fields on the job record:
  - `status: "queued" | "printing" | "printed" | "failed" | "skipped" | "cancelled"`.
  - `attemptCount: number`.
  - `firstAttemptAt?: Date`.
  - `lastAttemptAt?: Date`.
  - `lastFailedAt?: Date` / `failedAt?: Date`.
  - `lastFailedMessage?: string` / `failedMessage?: string`.
  - `lastSkippedAt?: Date`.
  - `lastSkippedReason?: string`.
  - `printedAt?: Date`.
  - `cancelledAt?: Date`.
  - Optional `history` array with per-attempt log entries.

- On each status callback:
  - `complete`: set status to `printed`, bump attempt count and attempt timestamps.
  - `failed`: set status to `failed`, bump attempt count, set `lastFailedAt` and `lastFailedMessage`, append to `history`.
  - `skipped`: set status to `skipped`, set `lastSkippedAt` and `lastSkippedReason`.
  - `cancel`: set status to `cancelled`, set `cancelledAt`.

- In `GET /api/kitchen/print-queue`:
  - Always return `status`/`printStatus`.
  - Return `lastFailedAt`/`lastFailedMessage` and `lastSkippedAt`/`lastSkippedReason` so the desktop app’s `lastFailedAt: order.lastFailedAt || order.failedAt` mapping works.

With this in place, backend state, local state, and the UI will stay in sync, and stuck `Failed` jobs can always be retried or recovered predictably.

