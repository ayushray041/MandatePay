## API Contracts

All server‑side endpoints are exposed as **Next.js API routes** under `src/app/api/`. Each route validates request payloads with **Zod** schemas defined in `src/models/` and returns typed JSON responses. Below is a summary of the public contract surface.

### Authentication
| Method | Path | Request | Response | Notes |
|--------|------|---------|----------|-------|
| POST | `/api/auth/login` | `{ email: string, password: string }` | `{ token: string, user: { uid, email, displayName, role } }` | Returns Firebase ID token via Admin SDK. |
| POST | `/api/auth/logout` | `{ token: string }` | `{ success: true }` | Revokes token on server.

### Contracts
| Method | Path | Request | Response | Notes |
|--------|------|---------|----------|-------|
| POST | `/api/contracts` | `multipart/form-data` (file) + `{ title: string }` | `{ contractId, title, ownerId, status, createdAt }` | Stores file in Cloud Storage, creates Firestore doc.
| GET | `/api/contracts/:id` | – | Contract doc with status and metadata. |
| DELETE | `/api/contracts/:id` | – | Deletes contract and associated storage.
| POST | `/api/contracts/:id/process` | – | Triggers Contract Intelligence service. Returns `{ termsId }`.

### Contract Terms
| Method | Path | Request | Response | Notes |
|--------|------|---------|----------|-------|
| GET | `/api/contracts/:id/terms` | – | `{ termsId, terms, validatedAt }` |

### Negotiation
| Method | Path | Request | Response | Notes |
|--------|------|---------|----------|-------|
| POST | `/api/negotiations` | `{ contractId: string, maxRounds?: number }` | `{ negotiationId, status, currentRound }` |
| GET | `/api/negotiations/:id` | – | Negotiation state including round history.
| POST | `/api/negotiations/:id/round` | `{ proposal: object, side: "client" | "freelancer" }` | `{ roundNumber, proposals, updatedAt }` |
| POST | `/api/negotiations/:id/finalize` | – | Marks negotiation as finalized, creates amendment.

### Amendments
| Method | Path | Request | Response | Notes |
|--------|------|---------|----------|-------|
| GET | `/api/amendments/:id` | – | Amendment document with approval flags.
| POST | `/api/amendments/:id/approve` | `{ side: "client" | "freelancer" }` | Updates approval status.

### Payments (PayPal)
| Method | Path | Request | Response | Notes |
|--------|------|---------|----------|-------|
| POST | `/api/payments` | `{ amendmentId: string }` | `{ paymentId, orderId, status, amountCents }` – creates PayPal **authorization** order.
| POST | `/api/payments/:id/capture` | – | `{ success: true, capturedAt }` – captures authorized funds.
| POST | `/api/payments/:id/void` | – | `{ success: true, voidedAt }` – voids uncaptured order.

### Error Handling
All endpoints return a consistent error shape:
```json
{ "error": { "code": "string", "message": "string", "details": any } }
```
Where `code` matches HTTP status (e.g., `INVALID_ARGUMENT`, `UNAUTHENTICATED`).

### Webhook Endpoints
- **PayPal**: `/api/webhooks/paypal` – validates PayPal signatures, updates payment status.
- **Gemini**: none (Gemini calls are server‑side only).

---
*All routes are protected by server‑side authentication middleware that verifies the Firebase ID token and injects `req.user`.*