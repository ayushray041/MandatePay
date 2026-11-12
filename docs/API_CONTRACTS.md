## API Contracts

All server‑side endpoints are exposed as **Next.js API routes** under `src/app/api/`. Each route validates request payloads with **Zod** schemas defined in `src/models/` and returns typed JSON responses. Below is a summary of the public contract surface.

### Authentication and user profiles

Email/password account creation, sign-in, auth-state persistence, and logout use the Firebase
client SDK. There are no custom `/api/auth/login` or `/api/auth/logout` endpoints. The browser
sends the current Firebase ID token in an Authorization bearer header when calling protected APIs.

| Method | Path | Request | Response | Notes |
|--------|------|---------|----------|-------|
| GET | `/api/users/me` | – | `{ data: UserProfile }` | Returns only the profile matching the verified token UID. |
| POST | `/api/users/me` | `{ displayName: string, role?: "client" \| "freelancer" }` | `{ data: UserProfile }` | Provisions the profile after signup; `admin` is not accepted. Defaults role to `client`. |
| PATCH | `/api/users/me` | `{ displayName: string }` | `{ data: UserProfile }` | Updates only the permitted display name field. |
| GET | `/api/health/firebase` | – | `{ data: { success: true, firebase, firestore } }` | Public health diagnostic; service failures use the standard error shape. |

`UserProfile` contains `uid`, `email`, `displayName`, `role`, `createdAt`, and `updatedAt`.

The authentication, profile, and health endpoints above are implemented in Phase 1. The
mandate endpoints below are implemented in Phase 2. The remaining contract, negotiation,
amendment, payment, and webhook entries describe planned contracts; their Route Handlers are not
implemented yet.

### Mandates
All mandate routes require `Authorization: Bearer <Firebase ID token>`. The server derives owner
and agent identity from the verified token. Successful responses use `{ "data": ... }`.

| Method | Path | Request | Notes |
|--------|------|---------|-------|
| GET | `/api/mandates` | – | Lists mandates owned by or assigned to the verified user. |
| POST | `/api/mandates` | Mandate definition | Creates a draft owned by the verified user. The authorized agent must have a profile. |
| GET | `/api/mandates/:mandateId` | – | Returns details only to its owner or authorized agent. |
| PATCH | `/api/mandates/:mandateId` | Partial mandate definition | Owner-only draft editing. Spending-limit increases are rejected; reductions cannot undercut committed spend. |
| POST | `/api/mandates/:mandateId/lifecycle` | `{ action: "activate" \| "pause" \| "resume" \| "revoke" }` | Owner-only lifecycle transition. Revocation is irreversible. |
| POST | `/api/mandates/:mandateId/limit-requests` | `{ requestedLimitMinor, reason }` | Assigned-agent request for a higher limit. |
| POST | `/api/mandates/:mandateId/limit-requests/decision` | `{ decision: "approve" \| "reject" }` | Owner approves or rejects the pending increase. |
| GET | `/api/mandates/:mandateId/authorizations` | – | Lists that mandate’s operation authorization records to owner and agent. |
| POST | `/api/mandates/:mandateId/authorizations` | `{ operation, amountMinor, description }` | Assigned agent requests an operation. The API enforces status, time window, allowed operations, budget, approval policy, and execution conditions in a Firestore transaction. |
| PATCH | `/api/mandates/:mandateId/authorizations/:authorizationId` | `{ decision: "approve" \| "reject" }` | Owner decides a pending operation. Approved amounts are committed against the budget transactionally. |

Amounts are represented as integer currency minor units. An `approved` mandate authorization records
permission and commits budget only; it does not claim that a contract, payment, or external operation
has executed. Every mandate mutation and operation decision creates an immutable server-side audit
event. Expired status is derived from the expiry timestamp on reads and persisted with an audit event
when the owner attempts a lifecycle transition.

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
{ "error": { "code": "INVALID_ARGUMENT", "message": "string", "details": [] } }
```
Success responses use `{ "data": ... }`. Error codes are stable semantic identifiers such as
`INVALID_ARGUMENT`, `UNAUTHENTICATED`, and `SERVICE_UNAVAILABLE`; HTTP status remains the
authoritative transport status.

### Webhook Endpoints
- **PayPal**: `/api/webhooks/paypal` – validates PayPal signatures, updates payment status.
- **Gemini**: none (Gemini calls are server‑side only).

---
Implemented protected Route Handlers verify the Firebase ID token server-side and derive identity
only from the verified token. The browser route guard is an optimistic UX check and is not an API
security boundary. Firebase Admin SDK access bypasses Firestore rules, so API handlers must enforce
ownership themselves.