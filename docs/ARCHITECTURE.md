## Architecture Overview

MandatePay is a Next.js App Router application backed by Firebase Authentication and Firestore.
The browser handles Firebase email/password sign-in and sends Firebase ID tokens to protected
Route Handlers under `src/app/api/`. The server verifies each token, validates request data with
Zod, and performs authorized Firestore operations with the Firebase Admin SDK.

### Current implementation

1. **Authentication and profiles** — Firebase Auth provides signup, login, persisted browser
   sessions, and logout. User profiles are provisioned server-side from verified token claims;
   self-service role assignment cannot grant privileged roles.
2. **Mandates** — owners create and manage spending mandates. Server policy enforces ownership,
   assigned-agent authorization, lifecycle, time windows, permitted operations, approval rules,
   execution conditions, and available budget. Every mandate change is recorded in immutable
   audit logs.
3. **Agent IAM** — a registered agent profile is keyed by verified Firebase UID and carries a
   separate immutable random `agentId` with an immutable account owner association. Owner-issued
   API keys are 256-bit secrets; only HMAC-SHA-256 hashes are persisted. A separate API-key
   middleware enforces key expiry/revocation, agent activation state, explicit scopes, transactional
   per-agent rate/quota counters, and server-side session state. Discovery exposes only capability
   information.
4. **Agent marketplace** — owners publish versioned service listings and choose public, private
   agent-allowlist, or organization visibility. Firebase-authenticated discovery applies bounded
   filters and pagination, with live checks for both viewer and publisher organization membership.
   Owner-managed organizations, listing versions, validated capability documents, payment-eligible
   reviews, admin verification, and payment-capture-backed aggregates are server-only Firestore
   workflows. Public projections omit owner UIDs, organization membership data, and credentials.
5. **Negotiations** — two registered agents exchange deterministic offers and counters under their
   private active mandates. The server validates every transition and persists append-only offer
   and activity history. AI assistance is a separate, participant-authorized advisory layer.
6. **Contracts and amendments** — an accepted negotiation can produce one reviewable contract.
   The contract records the parties, mandates, agreed service and conditions. All required parties
   must approve before activation. Amendments are reviewed against current mandate authority and
   produce immutable versions with append-only audit events.
7. **Sandbox payments** — an approved active contract can start a PayPal sandbox authorization
   order. Server APIs calculate the amount from the approved version, check both reservations, and
   manage authorization, capture, cancellation, and full-refund transitions. Verified provider
   webhooks reconcile payment state and mandate ledgers transactionally; durable event receipts
   prevent duplicate processing.
8. **Negotiation intelligence** — a server-only Gemini provider supports recommendations, offer
   commentary, history summaries, and contract-clause review. Responses are strict-Zod validated;
   offer suggestions are independently checked against the requesting agent's mandate. No model
   tools, payment APIs, mandate mutation APIs, or approval actions are available to the provider.

### Negotiation and budget guarantees

- The initiating agent supplies an active mandate when creating a request. The recipient chooses
  their own mandate on their first counteroffer or acceptance; it is not disclosed during discovery.
- Each offer is validated against the submitting agent's active mandate, including currency,
  operation permission, amount, remaining budget, and configured execution conditions.
- Agent acceptance rechecks the latest offer against both mandates inside a Firestore transaction.
  If either mandate requires owner approval, acceptance remains pending and reserves no budget until
  each required owner approves. The final owner approval rechecks authorization, mandate state,
  terms, approval requirements, and capacity, then accepts and reserves both budgets atomically.
  Negotiations without an owner-approval requirement reserve budget in the agent acceptance
  transaction.
- Offer records and lifecycle events are stored in negotiation subcollections and are never edited.
  Firestore rules deny direct client access; participant authorization is enforced by the API.
- Negotiation expiry is recorded on the first attempted mutation after expiry; no scheduled expiry
  worker is implemented.
- Acceptance records agreement and a budget reservation only after any required owner approvals. It
  does not execute a service, contract, payment, or external operation. A later execution integration
  must consume or release that reservation under an explicit policy.
- Contract generation does not reserve the accepted amount again. Rejection releases the
  negotiation reservation transactionally. Approved amendments apply only the amount delta to both
  mandates in the same transaction as the new immutable version.
- Contract access and every review/amendment transition are checked server-side for participant
  identity and current mandate authority. Firestore rules deny direct client access to contract
  roots, versions, amendments, and audit events.
- Contract output records workflow terms; it does not claim legal enforceability, provide legal
  advice, create a digital signature, or authorize/process payment.
- AI context includes only the negotiation/contract terms needed for the requested analysis.
  Identifiers and party profiles are omitted; external text is treated as untrusted data and is
  never inserted into system instructions. Contract-analysis excerpts must match the current
  immutable version, and its disclaimer is fixed by the server.
- AI is advisory only. Mandate and state checks remain deterministic, approval requirements are
  surfaced, and no AI response is persisted or applied automatically. Provider outages never result
  in invented model output; safe deterministic metrics remain labeled as such.
- Payment initiation consumes the existing accepted-contract reservation; it does not reserve the
  amount a second time. Capture transactionally consumes both reservations and adds spending to
  the payer mandate only after PayPal confirms completion. Cancellation releases both reservations
  only when no provider order exists or provider authorization is confirmed void. An unapproved
  PayPal order cannot be safely canceled server-side and retains its reservation. Full refunds
  reverse payer spending only after provider confirmation.
- Provider calls run outside Firestore transactions and use stable operation-specific idempotency
  identifiers. Firestore transactions reserve/transition state before calls and reconcile results
  afterward, allowing safe retries without duplicate ledger changes.
- Webhook signatures are verified by the PayPal sandbox API. Processed event IDs are stored as
  hashed receipt document IDs in the same transaction as payment/ledger updates. Unmatched events
  remain retryable; amount, currency, authorization, and state mismatches are never treated as
  successful payment.
- Browser redirects and user confirmation can request an operation but cannot mark a payment
  complete. The protected APIs derive amounts from approved contract data and verify provider
  responses; Firestore rules deny all direct client access to payment and webhook records.
- The UI displays provider receipts only when a validated HTTPS PayPal receipt URL is present. This
  sandbox integration does not fabricate a receipt or claim that a receipt is available.

### Security considerations

- Firebase Admin credentials and other server secrets are used only by server-side modules and are
  never sent to the browser.
- Firebase ID tokens are verified server-side. The API derives identity only from verified claims;
  client-supplied UIDs are not authorization inputs.
- Firebase Admin SDK operations bypass Firestore Security Rules, so each Route Handler performs
  its own participant and ownership checks. Rules deny direct client access to agent, mandate,
  authorization, negotiation, offer, and event records.
- All API input is validated with strict Zod schemas before business logic. Transactional state
  changes protect against duplicate decisions and budget races.
- AI endpoints independently authenticate and authorize negotiation or contract participants.
  Provider keys stay server-side; structured logs exclude prompts, model output, IDs, and commercial
  text. Calls have a timeout and bounded output; untrusted text is sent without tools or execution
  authority.
- PayPal mode is fixed to sandbox in the server adapter; client credentials, webhook verification,
  and provider calls are never exposed to the browser. The project has not performed real or
  credential-backed financial transactions.
- The client route guard is an experience feature, not an API security boundary.
- Agent API keys are never accepted as Firebase identity. They are accepted only by dedicated
  `/api/agent/v1/*` handlers with explicit scopes. The credential maps to its registered agent
  owner account, and mandate queries additionally require the stored assignment to that account.
- API key secrets are returned only once. Firestore stores the key ID, scope/expiry/status metadata,
  and a keyed HMAC-SHA-256 digest; the pepper is a server-only `AGENT_API_KEY_PEPPER` secret. Key
  revoke/rotation atomically invalidates the paired session. Agent suspension is checked on every
  key-authenticated request.
- Per-agent requests-per-minute and UTC-day quotas share atomic Firestore counters across all
  credentials. Credential management and authenticated API requests append activity/security
  events without persisting raw keys, authorization headers, or request bodies.
- Marketplace reads and writes go through authenticated APIs because Firebase Admin bypasses
  Firestore rules. Public listing projections are explicit allowlisted schemas. Private and
  organization visibility is rechecked on reads; organization listings disappear when either the
  viewer or publisher loses membership. Review creation derives the recipient from a completed
  payment and keys uniqueness on that payment. Capture outcomes update reliability/count metrics
  with deduplication receipts in the same payment transaction.
- Marketplace discovery currently scans at most 500 recent published listings and returns a
  `truncated` indicator when that candidate window is full. This is bounded for safety but is not
  an exhaustive or high-scale index-backed search; production growth requires indexed filters and
  cursor-based pagination.
- Webhook endpoint registration is metadata-only. No event delivery, payload signing, or retry
  worker is implemented; registered URLs are not fetched by the server.

Contract generation, amendments, sandbox payment processing, and advisory negotiation intelligence
are implemented. See [API_CONTRACTS.md](./API_CONTRACTS.md),
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md), and [DEVELOPMENT_STATUS.md](./DEVELOPMENT_STATUS.md) for
implementation and verification details.
