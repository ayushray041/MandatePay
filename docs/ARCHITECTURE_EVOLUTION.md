# Architecture Evolution

**Assessment date:** 2026-11-12

## Current architecture

MandatePay is a Next.js App Router application with React/TypeScript pages and Route Handlers.
Firebase Authentication owns browser credentials; protected user handlers verify Firebase ID
tokens with Firebase Admin and use verified claims as the only user identity. Dedicated agent
handlers additionally support owner-issued, high-entropy API keys through a separate scoped
principal that never authenticates user/owner APIs. Firebase Admin uses Application Default
Credentials. Firestore is the authoritative store for profiles, mandates, negotiations, contracts,
payments, agent credentials and quotas, and append-only workflow history.

The current dependency flow is:

1. Browser Firebase SDK signs users in and obtains an ID token; external agents receive owner-issued
   API keys whose secret is shown once and whose hash is stored server-side.
2. Browser API clients send the ID token; external integrations send the API key only to the
   dedicated `/api/agent/v1/*` surface.
3. Route Handlers authenticate the correct principal type, validate strict request schemas, and enforce ownership/participant
   policy.
4. Domain policies validate mandate authority and workflow state; agent middleware revalidates key
   status, owner/agent binding, scope, expiry, suspension, and quota on each request.
5. Firestore transactions atomically update workflow records, reservations/ledgers, usage counters,
   and audit
   events.
6. External provider calls occur outside Firestore transactions; persisted pending state, stable
   provider request IDs, and verified webhooks reconcile results.

## Domain boundaries

| Domain | Server modules | Persistence and invariants |
|---|---|---|
| Authentication and profiles | `src/lib/firebase`, `src/lib/api/auth.ts`, `/api/users/me` | User documents keyed by Firebase UID; caller identity is verified server-side. |
| Mandates and authorizations | `src/lib/mandates`, `/api/mandates` | Integer minor units, owner/agent boundaries, lifecycle/expiry, approval rules, committed spend, reservations, and immutable audit events. |
| Agents and agent IAM | `src/lib/agents`, `/api/agents`, `/api/agent/v1` | Verified account owner, immutable random agent ID registry, HMAC-hashed scoped API keys, expiry/revocation/session state, shared transactional minute/day quotas, runtime status/version and append-only activity; external mandate APIs additionally check mandate assignment. |
| Negotiations | `src/lib/negotiations`, `/api/negotiations` | Participant-only state machine; CAS against current offer, versioned snapshots, independent comparison batches, owner approval gates atomic dual-mandate reservation, bounded expiry and dispute handling. |
| Contracts and amendments | `src/lib/contracts`, `/api/contracts`, `/api/amendments` | Contract ID is the accepted negotiation ID; immutable version snapshots; required party approvals; transactional reservation deltas. |
| Payments | `src/lib/payments`, `/api/payments` | One payment record per contract and cycle; amount from the approved version; PayPal sandbox operations; webhook receipts and ledger transitions are transactional. |
| Advisory AI | `src/lib/ai`, intelligence and analysis routes | Stateless, participant-authorized advisory calls; output does not approve or mutate financial workflows. |

## Firestore layout and access model

The primary collections are `users`, `agents`, `agentIdentities`, `agentApiKeys`, `agentSessions`,
`agentUsage`, `agentActivity`, `agentWebhooks`, `mandates`, `mandateAuthorizations`,
`auditLogs`, `negotiations`, `negotiationStrategyProfiles`, `contracts`, `payments`, and
`paypalWebhookEvents`. Offers, negotiation events/versions/disputes, contract versions, amendments,
contract events, and payment events are subcollections.
Composite indexes are maintained in `firestore.indexes.json`.

Client rules allow only a user to read their own profile. Workflow and financial collections are
server-only; default rules deny unmatched paths. Since Admin SDK access bypasses these rules,
participant and ownership authorization in every handler is a required invariant, not an optional
defense.

## Existing consistency guarantees

- Negotiation acceptance and final owner approval re-read both mandates and atomically reserve both
  budgets with the negotiation transition.
- Offer writes and decisions use the expected current offer ID as a compare-and-swap boundary.
  Offers are append-only and capped at 100; acceptance/owner approval locks the accepted offer.
- Each mutation advances a monotonic negotiation version and writes a replay snapshot. Independent
  vendor batch children have isolated state and budget reservations; only the initiating agent can
  access the cross-vendor comparison response.
- Duplicate/stale decisions and offer retries are rejected without another append. Tests cover
  owner-approval integration and serialized competing reservations using transaction test doubles.
- Negotiated quantity pricing is checked against its exact total, and optional SLA, contract, and
  conditional clauses are preserved into immutable contract versions. These clauses do not bypass
  deterministic mandate authorization.
- Dispute escalation is participant-only, accepted-state-only, and unique per negotiation. AI
  comparison, strategy, observed-price references, and qualitative outcome predictions are
  advisory; they never mutate approval or financial state.
- Negotiation expiry is available through a credential-protected, bounded worker endpoint, while
  access-time expiry remains in place. A deployment scheduler and `CRON_SECRET` are still required.
- Contract generation uses the negotiation ID as a unique document key. Contract review and
  amendment decisions update approval state, immutable versions, audit events, and reservation
  deltas transactionally.
- Payment initiation uses the existing reservation rather than reserving again. Capture and
  provider webhook reconciliation update payment state and mandate ledgers transactionally.
- Provider calls are outside Firestore transactions and use operation-specific idempotency IDs.
  Webhook event IDs are durably deduplicated.
- An accepted operation authorization is a budget/policy record; it is not evidence that the
  requested external operation has executed.
- Agent ID allocation and owner binding are persisted transactionally in `agentIdentities`.
  Credential issuance stores an HMAC-SHA-256 digest keyed with `AGENT_API_KEY_PEPPER`; the API key
  itself is never persisted. Credential revocation, key rotation, and paired session invalidation
  are transactional.
- API keys are isolated from Firebase-authenticated application routes. Their dedicated API surface
  supports profile reads and assigned-mandate reads/operation requests, and uses the existing
  mandate authorization transaction rather than a second policy implementation.
- Per-agent usage counters serialize requests across every active credential. API calls record
  activity and runtime version; invalid unauthenticated probes are not persisted to avoid
  unbounded attacker-triggered log writes.
- Webhook endpoint registration is currently metadata-only; no sender, payload signature, or retry
  worker exists.

## Assessment changes

Mandate revocation is irreversible. It is now rejected while `reservedAmountMinor` is positive,
avoiding a known path where revocation strands an accepted reservation. This does not resolve
natural expiry: an accepted reservation can outlive its mandate and the repository has no general
scheduled settlement/recovery worker. The rule for completing versus releasing such commitments
must be approved before adding an automated recovery process.

## Evolution priorities

1. Verify rules and indexes with the Firestore emulator and an authorized deployed project.
2. Provision and rotate `AGENT_API_KEY_PEPPER` in a production secret manager; deploy the new
   agent IAM indexes and rules before issuing API credentials.
3. Add emulator-backed concurrency tests for independent workflows sharing mandates and for
   payment ledger contention. Existing mock-based tests cannot validate Firestore retry semantics.
4. Define an explicit reservation lifecycle with terminal outcomes, time bounds, idempotent recovery,
   actor attribution, and immutable audit events. Preserve the existing owner-approval boundary.
5. Implement authenticated webhook delivery only with SSRF-safe egress controls, signed payloads,
   durable delivery attempts, and bounded retries.
6. Configure a production scheduler for the bounded negotiation-expiry endpoint with a
   server-managed `CRON_SECRET`; deployment-specific scheduling is intentionally not assumed.
7. Add browser E2E tests and operational monitoring/runbooks before production rollout.
8. Keep real-money movement and external service execution out of scope until separate compliance,
   legal, security, and operational approvals.
