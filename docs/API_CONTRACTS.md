## API Contracts

Server-side endpoints are Next.js Route Handlers under `src/app/api/`. Protected routes verify
Firebase ID tokens, validate request bodies with Zod, derive caller identity from the verified
token, and return `{ "data": ... }` on success. Errors use the common shape described below.

### Authentication and user profiles

Email/password account creation, sign-in, auth-state persistence, and logout use the Firebase
client SDK. There are no custom login or logout API routes. The browser sends the current Firebase
ID token in the `Authorization` bearer header when calling protected APIs.

| Method | Path | Request | Response / notes |
|--------|------|---------|------------------|
| GET | `/api/users/me` | – | `{ data: UserProfile }`; returns only the profile matching the verified token UID. |
| POST | `/api/users/me` | `{ displayName, role? }` | Provisions the profile after signup; `admin` is not accepted. Defaults role to `client`. |
| PATCH | `/api/users/me` | `{ displayName }` | Updates only the permitted display name field. |
| GET | `/api/health/firebase` | – | Public Firebase health diagnostic. |

`UserProfile` contains `uid`, `email`, `displayName`, `role`, `createdAt`, and `updatedAt`.

### Agents

All agent routes require a verified Firebase ID token. Agent identity and display name are derived
from the user's profile; callers cannot choose a UID or privileged role. Discovery returns public
capability information only, never email or mandate information.

| Method | Path | Request | Response / notes |
|--------|------|---------|------------------|
| GET | `/api/agents/me` | – | The caller's agent profile, or `404` when unregistered. |
| POST | `/api/agents/me` | Agent capabilities and availability | Creates a profile for a `freelancer` user. UID and display name are server-assigned. |
| PATCH | `/api/agents/me` | Partial agent capabilities and availability | Updates the caller's profile; the merged profile is validated. |
| GET | `/api/agents?category=software` | Optional category | Lists up to 50 profiles, excluding the caller. |

Supported categories are `software`, `design`, `writing`, `marketing`, `consulting`, `finance`,
`legal`, and `other`. Profiles include a headline, bio, per-category capabilities, supported
currencies, and availability.

### Mandates

Mandate routes require a verified Firebase ID token. The server derives owner and agent identity
from that token. Amounts are integer currency minor units.

| Method | Path | Request | Response / notes |
|--------|------|---------|------------------|
| GET | `/api/mandates` | – | Lists mandates owned by or assigned to the caller. |
| POST | `/api/mandates` | Mandate definition | Creates a draft owned by the caller. The authorized agent must have a profile. |
| GET | `/api/mandates/:mandateId` | – | Owner- or assigned-agent-only detail. |
| PATCH | `/api/mandates/:mandateId` | Partial mandate definition | Owner-only draft editing. Limit increases are rejected; reductions cannot undercut committed spend and reservations. |
| POST | `/api/mandates/:mandateId/lifecycle` | `{ action: "activate" \| "pause" \| "resume" \| "revoke" }` | Owner-only lifecycle transition; revocation is irreversible. |
| POST | `/api/mandates/:mandateId/limit-requests` | `{ requestedLimitMinor, reason }` | Assigned-agent request for a limit increase. |
| POST | `/api/mandates/:mandateId/limit-requests/decision` | `{ decision: "approve" \| "reject" }` | Owner decision on the pending increase. |
| GET | `/api/mandates/:mandateId/authorizations` | – | Lists operation authorizations for the owner and assigned agent. |
| POST | `/api/mandates/:mandateId/authorizations` | `{ operation, amountMinor, description }` | Enforces active status, dates, allowed operations, budget, approvals, and execution conditions transactionally. |
| PATCH | `/api/mandates/:mandateId/authorizations/:authorizationId` | `{ decision: "approve" \| "reject" }` | Owner decision; approved amounts are committed against the budget transactionally. |

An approved operation authorization records permission and commits budget only; it does not claim
that a contract, payment, or external operation has executed. Mandate mutations and operation
decisions create immutable server-side audit events.

### Negotiations

All negotiation routes require a verified Firebase ID token and a registered agent profile.
Negotiations are private to the two agent participants. Mandate IDs and terms are not exposed during
discovery. Each participant's mandate is checked server-side when submitting or accepting terms.

| Method | Path | Request | Response / notes |
|--------|------|---------|------------------|
| POST | `/api/negotiations` | `{ mandateId, recipientAgentId, title, expiresAt }` | `{ data: NegotiationRecord }`; creates an `initiated` request. Expiry must be in the future and within 30 days. |
| GET | `/api/negotiations` | – | `{ data: NegotiationRecord[] }`; lists up to 50 negotiations involving the caller. |
| GET | `/api/negotiations/:negotiationId` | – | `{ data: { negotiation, offers, events } }`; complete participant-only history. |
| POST | `/api/negotiations/:negotiationId/offers` | `{ mandateId?, terms }` | `{ data: NegotiationOffer }`; initiator submits the first offer and the other participant counters. Recipient selects a mandate on their first response. |
| POST | `/api/negotiations/:negotiationId/decision` | `{ decision: "accept" \| "reject" \| "cancel", mandateId?, reason? }` | `{ data: NegotiationRecord }`; rejection requires a reason and only the initiator can cancel. |

Offer `terms` contain `title`, `category`, `description`, integer `amountMinor`, `currency`, and
`deliveryDays`. The lifecycle states are `initiated`, `offer_submitted`, `counter_offered`,
`accepted`, `rejected`, `expired`, and `cancelled`. Offer submission and decisions validate state
transitions transactionally. Each offer and transition appends a record under the negotiation's
`offers` or `events` subcollection. Expiry is marked and recorded on the first attempted mutation
after the deadline; there is no scheduled expiry worker.

Acceptance revalidates the latest offer against both active mandates, then reserves the agreed
amount against both budgets in the same Firestore transaction. Acceptance records agreement and
reserves budget only; it does not execute a service, contract, payment, or operation authorization.

### Planned contract, amendment, and payment APIs

The following routes are documented as future work and are not implemented:

| Method | Path | Planned purpose |
|--------|------|-----------------|
| POST | `/api/contracts` | Upload a contract and create its Firestore metadata. |
| GET | `/api/contracts/:id` | Read contract metadata. |
| DELETE | `/api/contracts/:id` | Delete a contract and associated storage. |
| POST | `/api/contracts/:id/process` | Extract and validate contract terms. |
| GET | `/api/contracts/:id/terms` | Read extracted terms. |
| GET | `/api/amendments/:id` | Read an amendment. |
| POST | `/api/amendments/:id/approve` | Approve an amendment. |
| POST | `/api/payments` | Create a PayPal authorization order. |
| POST | `/api/payments/:id/capture` | Capture authorized funds. |
| POST | `/api/payments/:id/void` | Void an uncaptured order. |
| POST | `/api/webhooks/paypal` | Verify PayPal webhook signatures and process events. |

### Error handling

Errors use a consistent response shape:

```json
{ "error": { "code": "INVALID_ARGUMENT", "message": "string", "details": [] } }
```

Error codes are stable semantic identifiers such as `INVALID_ARGUMENT`, `UNAUTHENTICATED`, and
`SERVICE_UNAVAILABLE`; HTTP status remains the authoritative transport status. Firebase Admin SDK
access bypasses Firestore rules, so API handlers independently enforce authorization and ownership.
