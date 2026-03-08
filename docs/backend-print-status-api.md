# Backend API for print status updates

The receipt-printer app calls your backend when a queue item is **printed**, **failed**, or **skipped**. Implement these endpoints under your API base URL (e.g. `https://your-app.herokuapp.com`). Use the path prefix **`/api/kitchen/print-jobs`** so they match the receipt-printer app. The app sends the kitchen secret as a query param: `?secret={kitchenSecret}` (same as the print-queue).

---

## 1. Print succeeded

**When:** A receipt was sent to the printer successfully.

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/kitchen/print-jobs/:id/complete?secret={kitchenSecret}` | none |

- **`:id`** = order id (e.g. MongoDB `_id`).
- **`secret`** = same kitchen secret used for the print-queue.
- Response: `200` or `204` on success.

Example: `POST https://your-app.herokuapp.com/api/kitchen/print-jobs/69ad366ce0fb717ece945b6e/complete?secret=YOUR_SECRET`

---

## 2. Print failed

**When:** The app tried to print but something went wrong (printer error, paper jam, etc.).  
**Not called** for “no printer selected” (see Skipped).

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/kitchen/print-jobs/:id/failed?secret={kitchenSecret}` | `{ "message": "error description" }` |

- **`:id`** = order id.
- **`secret`** = kitchen secret (query).
- **`message`** = short error string (e.g. printer error message).
- Response: `200` or `204` on success.

Example: `POST .../api/kitchen/print-jobs/69ad366ce0fb717ece945b6e/failed?secret=YOUR_SECRET`  
Body: `{"message":"No printer selected. Pick a printer from the dropdown first."}`

---

## 3. Print skipped (optional)

**When:** The app did not attempt to print because of a local/config issue (e.g. no printer selected). The order stays in the queue and can be retried later.

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/kitchen/print-jobs/:id/skipped?secret={kitchenSecret}` | `{ "reason": "no_printer_selected" }` |

- **`:id`** = order id.
- **`secret`** = kitchen secret (query).
- **`reason`** = e.g. `no_printer_selected`.
- Response: `200` or `204` on success.

If you don’t implement this, the app will still track “skipped” locally and **won’t** call the backend for it.

---

## 4. Print cancelled

**When:** User clicks **Cancel** in the app (order removed from print queue).

| Method | Path | Body |
|--------|------|------|
| `POST` | `/api/kitchen/print-jobs/:id/cancel?secret={kitchenSecret}` | none |

- **`:id`** = order id.
- **`secret`** = kitchen secret (query).
- Response: `200` or `204` on success.

---

## Summary

| Status   | Endpoint                      | When |
|----------|-------------------------------|------|
| Complete | `POST /api/kitchen/print-jobs/:id/complete?secret=...` | Receipt printed successfully. |
| Failed   | `POST /api/kitchen/print-jobs/:id/failed?secret=...`   | Print attempted and failed (real printer/error). |
| Skipped  | `POST /api/kitchen/print-jobs/:id/skipped?secret=...`   | Not attempted or user skipped. |
| Cancel   | `POST /api/kitchen/print-jobs/:id/cancel?secret=...`   | User cancelled; remove from queue. |

The app sends the same **base URL** and **kitchen secret** (as `?secret=`) as used for the print-queue. Your backend should validate the secret the same way as for `GET /api/kitchen/print-queue`.
