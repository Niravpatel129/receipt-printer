## Receipt printer – backend retry & attempt tracking

This document describes how the desktop receipt-printer app behaves and how the backend should model **attempts**, **retries**, and **status history** so everything stays in sync.

Use this when implementing or updating the backend that powers:

- `GET /api/kitchen/print-queue`
- `GET /api/kitchen/print-queue/history`
- The status callbacks under `/api/kitchen/print-jobs`

See `backend-print-status-api.md` for the base endpoint contracts.

---

## 1. Core concepts

### 1.1 Job identity

- A **print job** represents “print this order on a device”.
- The desktop app expects each job to have:
  - `id` (or `_id`): unique job id in the queue
  - `orderId` (or `order_id`): the underlying order id
- The same `orderId` can appear in multiple jobs (e.g. reprints), but each job has its own `id`.

### 1.2 Attempt vs retry

- An **attempt** is any time the app actually sends the receipt to a printer.
- A **retry** is just an additional attempt after at least one failure.
- The desktop app **does not send a special “retry” flag**; instead, retries are inferred from multiple attempts for the same job.

You should therefore track **attempt counts and timestamps** in your backend model.

---

## 2. How the desktop app talks to your backend

### 2.1 Fetching jobs

The app periodically calls:

- `GET /api/kitchen/print-queue?secret={kitchenSecret}`
  - Returns an array of jobs in `data.orders` or `data.jobs`.
- Optionally:
  - `GET /api/kitchen/print-queue/history?secret={kitchenSecret}&limit=...&page=...`
  - Returns previously processed jobs.

The app normalizes each job to an internal shape roughly like:

```json
{
  "id": "<queueId>",                 // from _id/id/queueId/queue_id
  "orderId": "<orderId>",            // from order._id/id/orderId/order_id
  "printStatus": "queued|printed|failed|skipped|cancelled",
  "order": { ... },                  // underlying order data
  "lastFailedAt": "2025-01-01T00:00:00Z",
  "lastFailedMessage": "printer offline",
  "lastSkippedAt": "2025-01-01T00:00:00Z",
  "lastSkippedReason": "no_printer_selected"
}
```

Fields like `lastFailedAt`, `lastFailedMessage`, etc. are **optional** but recommended; if present, they are surfaced in the UI.

### 2.2 Status callbacks (attempt results)

When the app actually tries to print a job and finishes, it calls one of:

- Print **succeeded** (attempt was successful):
  - `POST /api/kitchen/print-jobs/:id/complete?secret={kitchenSecret}`
  - `:id` is the job id (`queueId` / `_id` / `id`) used in the queue.
- Print **failed** (attempted, but printer or system error):
  - `POST /api/kitchen/print-jobs/:id/failed?secret={kitchenSecret}`
  - Body: `{ "message": "error description" }`
- Print **skipped** (not attempted due to local/config issue, e.g. no printer selected):
  - `POST /api/kitchen/print-jobs/:id/skipped?secret={kitchenSecret}`
  - Body: `{ "reason": "no_printer_selected" }`
- Print **cancelled** (user removed the job from the queue):
  - `POST /api/kitchen/print-jobs/:id/cancel?secret={kitchenSecret}`

These callbacks are used for **every attempt**, including retries.

---

## 3. Recommended backend data model

Below is a suggested job schema for your backend. Adjust field names/types to match your stack.

```ts
type PrintJobStatus =
  | "queued"
  | "printing"
  | "printed"
  | "failed"
  | "skipped"
  | "cancelled";

interface PrintJob {
  id: string;                 // unique job id
  orderId: string;            // underlying order id

  status: PrintJobStatus;     // current status

  // Attempt tracking
  attemptCount: number;       // total attempts that actually hit the printer
  firstAttemptAt?: Date;
  lastAttemptAt?: Date;

  // Fail history (overall summary for the job)
  lastFailedAt?: Date;
  lastFailedMessage?: string;

  // Skip history
  lastSkippedAt?: Date;
  lastSkippedReason?: string; // e.g. "no_printer_selected"

  // Cancellation
  cancelledAt?: Date;

  // Success
  printedAt?: Date;

  // Queue metadata
  queueAddedAt: Date;

  // Optional: per-attempt log
  attempts?: {
    at: Date;
    outcome: "success" | "failure" | "skipped";
    message?: string; // failure message or skip reason
  }[];
}
```

**Key point:** `attemptCount` and `attempts[]` are owned entirely by your backend; the desktop app never sends them, it only drives them by calling the status endpoints.

---

## 4. How to update the job on each callback

This section describes how your backend should mutate its job record when the app calls each status endpoint.

### 4.1 On `POST /api/kitchen/print-jobs/:id/complete`

- Find job by `id`.
- Increment `attemptCount` (if this is the first attempt, initialize to `1`).
- Set:
  - `status = "printed"`
  - `printedAt = now`
  - `lastAttemptAt = now`
  - `firstAttemptAt` if not already set.
- Optionally append to `attempts[]`:
  - `{ at: now, outcome: "success" }`

### 4.2 On `POST /api/kitchen/print-jobs/:id/failed`

Body: `{ "message": string }`.

- Find job by `id`.
- Increment `attemptCount`.
- Set:
  - `status = "failed"`
  - `lastAttemptAt = now`
  - `firstAttemptAt` if not already set.
  - `lastFailedAt = now`
  - `lastFailedMessage = body.message`
- Optionally append to `attempts[]`:
  - `{ at: now, outcome: "failure", message: body.message }`

### 4.3 On `POST /api/kitchen/print-jobs/:id/skipped`

Body: `{ "reason": string }`.

- Find job by `id`.
- Do **not** increment `attemptCount`, because no actual print attempt was made.
- Set:
  - `status = "skipped"`
  - `lastSkippedAt = now`
  - `lastSkippedReason = body.reason`
- Optionally append to `attempts[]`:
  - `{ at: now, outcome: "skipped", message: body.reason }`

### 4.4 On `POST /api/kitchen/print-jobs/:id/cancel`

- Find job by `id`.
- Set:
  - `status = "cancelled"`
  - `cancelledAt = now`

---

## 5. How the UI infers “retry”

The desktop app does **not** receive a dedicated `attemptCount` field today, but it **can** display historical info if you include it or summary fields in the queue payload.

When building your `GET /api/kitchen/print-queue` response, you can:

- Always include:
  - `status` (or `printStatus`)
  - `lastFailedAt`
  - `lastFailedMessage`
  - `lastSkippedAt`
  - `lastSkippedReason`
- Optionally include:
  - `attemptCount`
  - `printedAt`

The app already maps `lastFailedAt`, `lastFailedMessage`, `lastSkippedAt`, and `lastSkippedReason` into its normalized job shape. If you populate those, the desktop user can tell:

- Whether a job was ever attempted.
- Whether it failed once vs multiple times (by looking at `attemptCount` if you expose it in additional UI or debugging tools).

---

## 6. Behaviour when user clicks “Retry”

From the desktop app’s perspective:

- The user clicks **Retry** on a job whose current status is `failed`.
- The app:
  - Locally switches the job back to `pending` / `queued` in its own store.
  - The background poller picks the job up again as an eligible job.
  - The app attempts to print again.
  - On outcome:
    - If print succeeds → calls `POST /print-jobs/:id/complete`.
    - If print fails → calls `POST /print-jobs/:id/failed` with the new error message.

Your backend does **not** receive a separate “retry” flag; it should treat this exactly like another attempt and rely on `attemptCount`, `firstAttemptAt`, and `lastAttemptAt` to infer retries.

---

## 7. Minimum changes if your backend already exists

If you already have a working backend that:

- Implements `complete`, `failed`, `skipped`, `cancel` endpoints as in `backend-print-status-api.md`, and
- Returns `status` / `printStatus` in `GET /api/kitchen/print-queue`,

then to add retry/attempt awareness you can:

1. **Extend your job model** with at least:
   - `attemptCount` (default `0`)
   - `firstAttemptAt`
   - `lastAttemptAt`
   - `lastFailedAt`
   - `lastFailedMessage`
2. **Update the four status handlers** to maintain these fields as described in section 4.
3. **Include** `lastFailedAt`, `lastFailedMessage`, `lastSkippedAt`, `lastSkippedReason`, and optionally `attemptCount` in your queue responses.

Once this is done, the desktop app’s existing flow (including the Retry button) will automatically reflect the enhanced backend logic without any further changes in the desktop code.

