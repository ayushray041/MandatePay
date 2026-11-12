# Development Status

## Phase 1: Authentication and database foundation

### Completed
- Email/password Firebase signup and login, explicit browser-local auth persistence, logout, loading/error states, and a client-side guard for workspace routes.
- Server-created Firestore profiles with UID/email from verified tokens, timestamps, and a signup role restricted to `client` or `freelancer`. Profile updates are limited to `displayName`.
- Shared Firestore document/timestamp utilities, collection names, a contracts owner/created-time index, and configured Security Rules in `firestore.rules`.
- Protected profile API handlers verify bearer ID tokens (including revocation), derive identity only from token claims, validate request bodies with strict Zod schemas, and return consistent response envelopes.
- Firebase health diagnostics and the implemented profile API use the same response format. Future workflow endpoints remain unimplemented.

### Verification
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm test`: passed — 3 test files passed, 1 skipped; 11 tests passed, 2 skipped.
- Firestore rules tests cover profile confidentiality, denied direct profile writes, contract ownership, and denied direct payment access. They are skipped unless a Firestore emulator is available.

### Firebase and emulator status
- The production build loaded the configured Firebase client settings; this does not verify a live Firebase Auth or Firestore operation.
- No credential-backed signup, login, profile write, or rules deployment was performed.
- `npm run test:rules` could not start the Firestore emulator because the installed Java runtime is older than the JDK 21 minimum required by the installed `firebase-tools`. Install/use JDK 21, then rerun the rules suite.

### Remaining work
- Run the emulator-backed rules tests under JDK 21.
- Verify signup/login/profile creation against an authorized Firebase project and deploy `firestore.rules` plus `firestore.indexes.json` to that project.
- Payment APIs remain future work. Contracts and amendments are implemented in Phase 4 below.

## Phase 2: Complete mandate management

### Completed
- Added strict Zod mandate schemas for supported currencies, lifecycle actions, spending-limit requests/decisions, and operation authorization requests.
- Implemented Firestore-backed mandate creation, owner/agent listing and detail access, draft updates, lifecycle transitions, limit approvals, operation approvals, and transactional audit events.
- Enforced ownership, active dates, expiry, allowed operations, per-operation constraints, approval policy, and remaining budget in authenticated server APIs. Caller identity is derived from verified Firebase ID tokens.
- Prevented direct spending-limit increases through mandate edits. Increases require an authorized-agent request and a separate owner decision; stale requests and requests on inactive/expired mandates cannot be approved.
- Added mandate creation/edit, list and detail interfaces with status/budget visualization, lifecycle actions, approval controls, and loading/error/empty states.
- Wrapped pathname-dependent shared components in Suspense boundaries so dynamic mandate routes prerender under the installed Next.js Cache Components configuration.

### Verification
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm test`: passed — 6 test files passed, 1 skipped; 25 tests passed, 2 skipped.
- Firestore emulator rules tests remain skipped unless an emulator is available; see the JDK 21 note above.

### Scope and remaining work
- Operation authorization validates and commits budget, but does not execute payments, create contracts, or invoke an external operation. Those integrations must consume approved authorizations in a later phase.
- No live Firebase credentials or external service operations were used for verification. Deploy the updated Firestore rules and indexes to the authorized Firebase project before rollout.
- Existing emulator-backed Firestore rules coverage still requires JDK 21+.

## Phase 3: Agent-to-agent negotiation

### Completed
- Added server-owned agent registration, profile updates, and category-filtered discovery. Agent IDs and display names come from verified Firebase identity and the user profile; discovery omits email and mandate data.
- Added private bilateral negotiation requests with offer submission, counteroffers, acceptance, rejection, cancellation, expiry, participant inbox/detail APIs, and an append-only offer and activity history.
- Enforced state transitions and participant access in server routes. Offer and acceptance checks validate active mandates, currencies, allowed operations, spending limits, execution conditions, and remaining budget.
- Made acceptance transactional and concurrency-safe: both active mandates are rechecked and the agreed amount is reserved against each mandate budget in the same transaction. A reservation records agreement only; it does not execute services, contracts, payments, or authorizations.
- Added authenticated agent registration, agent discovery, negotiation inbox, request form, detail view, offer comparison, counteroffer and decision actions, timeline, status, expiry, and loading/error/empty states.
- Updated Firestore rules to deny direct client access to agent and negotiation data, and documented the API and data model.

### Verification
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; Next.js generated the `/negotiations` inbox and dynamic detail route.
- `npm test`: passed — 12 test files passed, 1 skipped; 52 tests passed, 3 skipped.
- `git diff --check`: passed.
- Firestore emulator rules tests were skipped because no `FIRESTORE_EMULATOR_HOST` was configured; starting the emulator in this environment previously failed because its Java runtime is older than the installed Firebase CLI's JDK 21 minimum.

### Scope and remaining work
- Negotiation expiry is recorded on the first attempted mutation after expiry; no scheduled expiry worker is included.
- Accepted budget reservations remain reserved until a later explicit execution/settlement integration consumes or releases them. No release mechanism is implied or fabricated.
- AI-assisted negotiation, contract processing, amendments, payment execution, and webhook integrations remain separate future work.
- No live Firebase credentials or external service operations are used for local verification. Deploy the current Firestore rules and indexes to the authorized Firebase project before rollout.

## Phase 4: Contract generation and amendments

### Completed
- Added strict contract, version, approval, amendment, and audit-event schemas.
- Added participant-authorized contract generation from accepted negotiations, with the negotiation ID as the unique contract ID. Contract terms snapshot both parties and agents, mandate references, negotiated service and price, payment/delivery conditions, expiry, and termination conditions.
- Implemented participant review and approval. All required owners and agents must approve before activation; rejection requires a reason and transactionally releases the negotiation's reserved amount.
- Implemented immutable version history and amendment proposals, comparisons, decisions, and audit events. Final amendment approval rechecks both mandates and atomically applies any reservation delta while creating the next version.
- Added contract listing/detail/review, version history, amendment review, and comparison interfaces. User-facing terms state that the workflow does not provide legal advice, a digital signature, or payment authorization.
- Firestore rules deny direct client access to contract roots, versions, amendments, and events. Added API, policy, and rules-test coverage.

### Verification
- Focused contract model/policy tests: passed — 8 tests.
- Contract/amendment API tests: passed — 7 tests, including malformed input, unauthorized review, duplicate generation, reservation release, mandate-capacity enforcement, and immutable amendment versions.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; `/contracts`, `/contracts/[contractId]`, and `/amendments` were generated.
- `npm test`: passed — 15 test files passed, 1 skipped; 67 tests passed, 3 skipped.
- `git diff --check`: passed.
- `npm run test:rules`: could not start the emulator because the installed Firebase CLI requires JDK 21 or newer. The rules tests remain skipped without `FIRESTORE_EMULATOR_HOST`.

### Scope and remaining work
- Contract generation records accepted workflow terms; it does not claim legal enforceability, create digital signatures, or itself authorize/process payment. Payment execution is a separate Phase 5 system.
- No live Firebase project operations or rules deployment were performed. Deploy the current rules and indexes to an authorized project before rollout.
- Contract intelligence remains future work.

## Phase 5: Secure payment infrastructure

### Completed
- Added a strict payment model, lifecycle event model, and sandbox-only PayPal Server SDK adapter. Provider amounts are created from server-derived integer minor units, and provider responses are checked before being persisted.
- Implemented participant-scoped payment history and detail APIs, server-calculated initiation from an active approved contract, payer authorization, fulfillment-confirmed capture, cancellation/void, and full-refund operations.
- Added transaction-safe reservation consumption/release and refund ledger reversal. Provider calls use stable operation-specific request IDs and idempotent retries; a new request key starts a fresh cycle only after cancellation.
- Added PayPal signature verification through the fixed sandbox verification endpoint, durable hashed webhook-event receipts, transactional capture/refund/void reconciliation, and fail-closed handling for invalid signatures, unmatched records, and amount/state conflicts.
- Added server-only Firestore rules for payments, payment events, and webhook receipts, plus the composite participant/updated-time index for transaction history.
- Replaced the payment placeholder with authenticated transaction history, eligible contract initiation, sandbox checkout return handling, payment details, state/timeline display, authorization/capture/cancel/refund actions, retry paths, and explicit loading/error/empty states.
- Updated the API contracts, architecture, and database schema documentation. The UI displays a provider receipt only when a validated HTTPS PayPal receipt URL is present; no receipt is fabricated.

### Verification
- `npm test`: passed — 20 test files passed, 1 skipped; 91 tests passed, 3 skipped.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; generated `/payments`, `/payments/[paymentId]`, and all payment API routes.
- `firestore.indexes.json` JSON validation and `git diff --check`: passed.
- The Firestore rules test file was skipped because `FIRESTORE_EMULATOR_HOST` is not configured. The Phase 3 section records the known JDK 21 requirement for the local emulator.

### Scope and remaining work
- The adapter is pinned to PayPal sandbox and no real payments or live provider calls were made. Sandbox credential and webhook registration must be configured and verified in an authorized environment before rollout.
- PayPal does not provide a safe server-side cancellation operation for an order that has not yet been authorized. Such orders retain their mandate reservations until the order is approved/declined and reconciled; there is no scheduled order-expiry recovery worker in this phase.
- Direct client Firestore access remains denied; deploy the current Firestore rules and indexes to the authorized Firebase project.
- npm reported 24 dependency audit findings during the PayPal SDK installation (19 moderate and 5 high); dependency audit remediation was not part of this phase.
- Provider-supported receipt presentation is conditional; this integration does not manufacture receipts or guarantee availability.
