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
| GET | `/api/agents/me/keys` | – | Lists credential metadata for the authenticated owner. Hashes and secrets are never returned. |
| POST | `/api/agents/me/keys` | `{ name, scopes, expiresAt }` | Creates a scoped key and returns the raw secret once. Expiration must be future and within one year. |
| DELETE | `/api/agents/me/keys/:keyId` | – | Immediately revokes the key and its associated session. |
| POST | `/api/agents/me/keys/:keyId/rotate` | – | Atomically revokes the old key/session and issues a replacement with the same scopes and expiration. The new secret is returned once. |
| PATCH | `/api/agents/me/status` | `{ status: "active" \| "suspended" }` | Owner-only activation/suspension. Suspended agents cannot authenticate API keys. |
| PATCH | `/api/agents/me/security` | `{ rateLimitPerMinute?, dailyQuota? }` | Owner-only quota configuration: 1–600 requests per minute and 1–100,000 per UTC day. |
| GET | `/api/agents/me/activity` | – | Returns up to 50 owner-scoped activity/security events. |
| GET | `/api/agents/me/sessions` | – | Lists up to 50 owner-scoped API sessions without credential material. |
| DELETE | `/api/agents/me/sessions/:sessionId` | – | Revokes the session and associated API key. |
| GET / POST | `/api/agents/me/webhooks` | HTTPS URL and event names | Lists or registers owner-scoped webhook endpoint metadata. |
| DELETE | `/api/agents/me/webhooks/:webhookId` | – | Revokes an endpoint registration. |

Supported categories are `software`, `design`, `writing`, `marketing`, `consulting`, `finance`,
`legal`, and `other`. Profiles include a headline, bio, per-category capabilities, supported
currencies, and availability. Registration creates a random immutable `agt_` identifier and
associates it with the verified Firebase account as its immutable owner. Existing agent accounts are
assigned an ID on their next profile/credential management access. Caller-supplied identity and
ownership fields are rejected. Status, health, profile version, runtime version, and usage limits
are managed by server endpoints; ownership transfer is not supported.

Agent API keys are 256-bit random secrets formatted as `mpa_live_<keyId>_<secret>`. The server stores
only an HMAC-SHA-256 hash keyed by server-only `AGENT_API_KEY_PEPPER` (at least 32 bytes). Key
issuance and authentication fail closed when that environment secret is missing or too short.
Generate it with a cryptographically secure secret manager and do not commit it. The raw secret is
shown only by create/rotate responses, held in the UI only in memory until dismissed, and must be
copied into a secret manager. A hash, raw key, or authorization header is never returned by
credential-list APIs. Rotations preserve the current expiration and permissions; create a separate
key to extend a credential lifetime. Changing the pepper invalidates every existing key; preserve it
in the secret manager or coordinate a full credential reissue during pepper rotation.

API-key authentication uses `Authorization: Bearer mpa_live_...`, is separate from Firebase user
authentication, and is accepted only by the scoped `/api/agent/v1/*` endpoints below. It never
authenticates `/api/agents/me`, user, owner, or general Firebase endpoints. Each key is bound to the
immutable agent ID and verified account owner.
The middleware checks the keyed hash, key/session status, expiry, current agent status, ownership,
scope, and atomically updated per-agent UTC minute/day counters on every request. Default limits
are 60 requests/minute and 10,000/day. A `429` response includes `Retry-After`. Valid requests
update the runtime version from a validated optional `X-Agent-Version` header and record an
append-only activity event. One server-side session is maintained per key; revoking either the
session or key invalidates both immediately.

Suspension blocks all API keys while the agent is suspended. Reactivation makes any still-active,
unexpired keys usable again; owners should revoke or rotate credentials suspected of compromise.

Supported API-key scopes and endpoints:

| Scope | Method | Path | Authorization |
|-------|--------|------|---------------|
| `agent:profile:read` | GET | `/api/agent/v1/me` | Returns only the authenticated agent profile. |
| `mandates:read` | GET | `/api/agent/v1/mandates` | Lists only mandates whose assigned agent is this credential's bound account. |
| `mandates:read` | GET | `/api/agent/v1/mandates/:mandateId/authorizations` | Lists only operation records created by the authenticated agent for that mandate. |
| `mandates:authorize` | POST | `/api/agent/v1/mandates/:mandateId/authorizations` | Reuses the same transactional mandate policy and reservation logic as Firebase-authenticated requests. The server derives agent identity from the credential and rejects mandates assigned to another agent. |

Webhook registration currently stores HTTPS endpoint and event-subscription metadata only. The
platform does not yet deliver events, sign webhook payloads, or retry failed deliveries.

### Mandates

Mandate routes require a verified Firebase ID token. The server derives owner and agent identity
from that token. Amounts are integer currency minor units.

| Method | Path | Request | Response / notes |
|--------|------|---------|------------------|
| GET | `/api/mandates` | – | Lists mandates owned by or assigned to the caller. |
| POST | `/api/mandates` | Mandate definition | Creates a draft owned by the caller. The authorized agent and every configured approver must have a profile; the caller must be an approver and the assigned agent cannot approve its own operations. |
| GET | `/api/mandates/:mandateId` | – | Owner- or assigned-agent-only detail. |
| PATCH | `/api/mandates/:mandateId` | Partial mandate definition | Owner-only draft editing. Includes permanent/temporary dates, limits, currency, vendor/category/country restrictions, approval policy, and conditional rules. Limit increases are rejected; reductions cannot undercut committed spend and reservations. Each policy edit writes an immutable version. |
| POST | `/api/mandates/:mandateId/duplicate` | `{ title? }` | Owner-only copy as a new draft with reset utilization/reservations and a new version history. |
| GET | `/api/mandates/:mandateId/versions` | – | Owner/assigned-agent-only immutable version history, capped at 50 entries. |
| POST | `/api/mandates/:mandateId/lifecycle` | `{ action: "activate" \| "pause" \| "resume" \| "revoke" }` or `{ action: "emergency_suspend", reason }` | Owner-only lifecycle transition. Revocation is irreversible and refuses outstanding reservations; emergency suspension pauses authority and invalidates pending authorization versions. |
| POST | `/api/mandates/:mandateId/limit-requests` | `{ requestedLimitMinor, reason }` | Assigned-agent request for a limit increase. |
| POST | `/api/mandates/:mandateId/limit-requests/decision` | `{ decision: "approve" \| "reject" }` | Owner decision on the pending increase. |
| POST | `/api/mandates/:mandateId/renewal` | `{ requestedExpiresAt, reason }` | Assigned-agent request to extend a temporary mandate. Does not change spending or execution permissions. |
| PATCH | `/api/mandates/:mandateId/renewal` | `{ decision: "approve" \| "reject", reason? }` | Owner decision; rejection requires a reason. Approval extends expiry and creates a new version. |
| GET | `/api/mandates/:mandateId/authorizations` | – | Lists operation authorizations for the owner and assigned agent. |
| POST | `/api/mandates/:mandateId/authorizations` | `{ operation, amountMinor, description, idempotencyKey? }` | Enforces mandate version, status, dates, allowed operations, total/agent/period limits, transaction count, approvals, and conditions transactionally. Pending approvals reserve budget immediately. An idempotency key makes retries safe. |
| PATCH | `/api/mandates/:mandateId/authorizations/:authorizationId` | `{ decision: "approve" \| "reject" }` | A configured approver records one vote. All-approver or quorum policy applies; final approval revalidates the captured mandate version and all rules. Rejection, stale policy, or expired authority releases reservations atomically. |

An approved operation authorization records permission and commits budget only; it does not claim
that a contract, payment, or external operation has executed. Daily, ISO-weekly, monthly, and
configured recurring limits roll over on UTC boundaries. The creation form provides general,
time-boxed project, and recurring-service templates; templates are only prefills and never bypass
server validation.

Geography, allowed/blocked vendor, allowed category, and contract-duration rules are enforced only
when the server has trusted context. Client-provided vendor identity, category, country, or duration
is not accepted as authorization evidence. The standalone operation-authorization endpoint fails
closed when one of these configured conditions cannot be verified. No trusted geolocation provider
or scheduled expiry worker is currently configured; expiry is enforced on access/authorization.

### Negotiations

All negotiation routes require a verified Firebase ID token and a registered agent profile.
Negotiations are private to the two agent participants. Mandate IDs and terms are not exposed during
discovery. Each participant's mandate is checked server-side when submitting or accepting terms.

| Method | Path | Request | Response / notes |
|--------|------|---------|------------------|
| POST | `/api/negotiations` | `{ mandateId, recipientAgentId, title, expiresAt }` | `{ data: NegotiationRecord }`; creates an `initiated` request. Expiry must be in the future and within 30 days. |
| GET | `/api/negotiations` | – | `{ data: NegotiationRecord[] }`; lists up to 50 negotiations involving the caller, including owner approvals assigned to the caller. |
| GET | `/api/negotiations/:negotiationId` | – | `{ data: { negotiation, offers, events } }`; complete history for agent participants and specifically required mandate owners. |
| POST | `/api/negotiations/:negotiationId/offers` | `{ mandateId?, terms }` | `{ data: NegotiationOffer }`; initiator submits the first offer and the other participant counters. Recipient selects a mandate on their first response. |
| POST | `/api/negotiations/:negotiationId/decision` | `{ decision: "accept" \| "reject" \| "cancel", mandateId?, reason? }` | `{ data: NegotiationRecord }`; acceptance returns `202` with `pending_owner_approval` when any mandate requires owner approval. Rejection requires a reason and only the initiator can cancel. |
| POST | `/api/negotiations/:negotiationId/owner-approval` | `{ decision: "approve" \| "reject", reason? }` | Authenticated required-owner decision. Rejection requires a reason. The final approval revalidates both mandates and atomically reserves their budgets; earlier approvals reserve nothing. |

Offer `terms` contain `title`, `category`, `description`, integer `amountMinor`, `currency`, and
`deliveryDays`. The lifecycle states are `initiated`, `offer_submitted`, `counter_offered`,
`pending_owner_approval`, `accepted`, `rejected`, `expired`, and `cancelled`. Offer submission,
agent decisions, and owner approvals validate state transitions transactionally. Each offer and
transition appends a record under the negotiation's `offers` or `events` subcollection. Owners
without agent profiles can review only negotiations that explicitly require their approval. Expiry
is marked and recorded on the first attempted mutation after the deadline; there is no scheduled
expiry worker.

Acceptance revalidates the latest offer against both active mandates. If no owner approval is
required, it reserves the agreed amount against both budgets in the same Firestore transaction. If
approval is required, the negotiation remains pending without a reservation until every required
owner approves. The final owner approval rechecks mandate status, terms, approval requirements, and
budget capacity before atomically accepting and reserving. Acceptance records agreement and reserves
budget only; it does not execute a service, contract, payment, or operation authorization.

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
