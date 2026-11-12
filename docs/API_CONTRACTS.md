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

#### Negotiation intelligence

| Method | Path | Request | Response / notes |
|--------|------|---------|------------------|
| POST | `/api/negotiations/:negotiationId/intelligence` | `{ action: "recommend" \| "compare" \| "summarize" }` | Participant-only advisory output. Recommendations include deterministic mandate and approval checks; comparisons include deterministic price, delivery, and mandate metrics. Summaries report included and total event/offer counts and include at most the latest 30 offers and 50 events. |
| POST | `/api/negotiations/:negotiationId/intelligence` | `{ action: "explain_violation", terms }` | Deterministic explanation of whether proposed terms meet the caller's assigned mandate conditions. |

Recommendations are not decisions: a counteroffer is returned only after deterministic mandate
validation and is never submitted automatically. Model responses are strict-Zod validated. If Gemini
is unavailable, deterministic offer metrics remain available with an explicit notice; recommendation
and summary output is null rather than fabricated. Set server-only `GEMINI_API_KEY`; optional
`GEMINI_MODEL` defaults to `gemini-2.5-flash`. Provider keys and AI output are not stored in Firestore.
Contract analysis returns an explicit provider error when unavailable; it does not return a fabricated
analysis.

### Contracts and amendments

Contract routes require a verified Firebase ID token. A contract is generated only from an accepted
negotiation, and its participants are the two mandate owners and authorized agents. Each participant
must review the contract before it becomes active. These records are server-only in Firestore; all
reads and transitions enforce participant/approver access in the API.

| Method | Path | Request | Response / notes |
|--------|------|---------|------------------|
| GET | `/api/contracts` | – | Lists contracts for the caller, including lifecycle status. |
| POST | `/api/contracts` | `{ negotiationId }` | Generates one reviewable contract for an accepted negotiation. Uses the negotiation ID as the contract ID to prevent duplicates. |
| GET | `/api/contracts/:contractId` | – | Participant-only contract, current and prior versions, amendments, and audit events. |
| POST | `/api/contracts/:contractId/approval` | `{ decision: "approve" \| "reject", reason? }` | Required party review. Rejection requires a reason and releases the negotiation's reservation transactionally. All required approvals activate the contract. |
| POST | `/api/contracts/:contractId/amendments` | Changed contract terms | Proposes an amendment to an active contract; only one unresolved amendment is allowed. |
| POST | `/api/contracts/:contractId/amendments/:amendmentId/decision` | `{ decision: "approve" \| "reject", reason? }` | Required party review; final approval revalidates both mandates and creates a new immutable version. Rejection requires a reason. |
| GET | `/api/amendments` | – | Lists amendments requiring the caller's review. |
| POST | `/api/contracts/:contractId/analysis` | – | Participant-only, advisory analysis of the current immutable version. Exact excerpts are checked against source clauses; not legal advice. |

Contract terms include parties and agent identities, mandate references, negotiated service, price
and currency, payment and delivery conditions, expiry, and termination conditions. Payment
conditions explicitly do not authorize or process payment. The generated document is a record of
agreed workflow terms, not a legal opinion, enforceable legal instrument, or digital signature.
Contract versions and audit events are immutable; current status, approvals, and version pointers
are maintained on the contract record.

Amendments can change service details, amount, payment/delivery conditions, expiry, or termination
conditions. Final approval checks current party authorization, active mandates, operation rules,
currency/category, mandate expiry, and capacity after accounting for the existing reservation.
Any approved amount delta is applied to both mandate reservations in the same transaction that
creates the next contract version.

### Payments

Payment routes require a verified Firebase ID token except for the PayPal webhook, which verifies
the provider signature before processing. Payment amounts and parties are read from the current
approved contract version and server-owned mandate reservations; clients cannot submit an amount.
PayPal is pinned to its sandbox environment.

| Method | Path | Request | Response / notes |
|--------|------|---------|------------------|
| GET | `/api/payments` | – | Lists up to 50 payments involving the caller. |
| POST | `/api/payments` | `{ contractId }` and `Idempotency-Key` header | Creates or safely retries one sandbox authorization order for an active, approved contract. The verified payer must be the contract client. |
| GET | `/api/payments/:paymentId` | – | Participant-only payment record and append-only event history. |
| POST | `/api/payments/:paymentId/authorize` | – | Confirms the PayPal authorization against the server-owned order and approved amount. |
| POST | `/api/payments/:paymentId/capture` | `{ fulfillmentConfirmed: true }` | Requests provider capture after payer confirmation; only a verified provider result or webhook marks completion. |
| POST | `/api/payments/:paymentId/cancel` | `{ reason }` | Voids an authorization before transactionally releasing both mandate reservations. An unapproved provider order cannot be canceled or have its reservation released. |
| POST | `/api/payments/:paymentId/refund` | `{ reason }` | Requests a full refund of a provider-confirmed capture. Spending is reversed only on provider confirmation. |
| POST | `/api/payments/webhook` | Raw PayPal event JSON and transmission headers | Verifies the event through PayPal's sandbox signature-verification API, then processes supported authorization, capture, void, and refund events transactionally. Event IDs are durably deduplicated. |

Payment status is one of `created`, `pending`, `authorized`, `processing`, `completed`, `failed`,
`cancelled`, or `refunded`. Provider operations use stable idempotency request IDs; webhook updates
and mandate-ledger changes are committed in the same Firestore transaction. A canceled payment can
start a new cycle with a new idempotency key. Only full refunds are implemented. Unsupported or
unmatched verified events are not applied to a payment; unmatched events receive a retryable service
error. A browser redirect or client-reported success never marks a payment completed.

Provider credentials are server-only. Configure sandbox `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`,
`PAYPAL_WEBHOOK_ID`, and `APP_BASE_URL`; sandbox mode is fixed in the server adapter. No live
financial transactions are initiated by this integration.

### Error handling

Errors use a consistent response shape:

```json
{ "error": { "code": "INVALID_ARGUMENT", "message": "string", "details": [] } }
```

Error codes are stable semantic identifiers such as `INVALID_ARGUMENT`, `UNAUTHENTICATED`, and
`SERVICE_UNAVAILABLE`; HTTP status remains the authoritative transport status. Firebase Admin SDK
access bypasses Firestore rules, so API handlers independently enforce authorization and ownership.
