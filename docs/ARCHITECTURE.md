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
3. **Agents** — a registered freelancer profile is keyed by verified Firebase UID. It contains
   capability, category, currency, and availability data. Discovery omits email and mandate data.
4. **Negotiations** — two registered agents exchange deterministic offers and counters under their
   private active mandates. The server validates every transition and persists append-only offer
   and activity history. AI integration is intentionally separate and is not part of this flow.
5. **Contracts and amendments** — an accepted negotiation can produce one reviewable contract.
   The contract records the parties, mandates, agreed service and conditions. All required parties
   must approve before activation. Amendments are reviewed against current mandate authority and
   produce immutable versions with append-only audit events.

### Negotiation and budget guarantees

- The initiating agent supplies an active mandate when creating a request. The recipient chooses
  their own mandate on their first counteroffer or acceptance; it is not disclosed during discovery.
- Each offer is validated against the submitting agent's active mandate, including currency,
  operation permission, amount, remaining budget, and configured execution conditions.
- Acceptance rechecks the latest offer against both mandates inside a Firestore transaction. The
  same transaction reserves the accepted amount against both mandate budgets, preventing concurrent
  acceptances from exceeding available limits.
- Offer records and lifecycle events are stored in negotiation subcollections and are never edited.
  Firestore rules deny direct client access; participant authorization is enforced by the API.
- Negotiation expiry is recorded on the first attempted mutation after expiry; no scheduled expiry
  worker is implemented.
- Acceptance records agreement and a budget reservation only. It does not execute a service,
  contract, payment, or external operation. A later execution integration must consume or release
  that reservation under an explicit policy.
- Contract generation does not reserve the accepted amount again. Rejection releases the
  negotiation reservation transactionally. Approved amendments apply only the amount delta to both
  mandates in the same transaction as the new immutable version.
- Contract access and every review/amendment transition are checked server-side for participant
  identity and current mandate authority. Firestore rules deny direct client access to contract
  roots, versions, amendments, and audit events.
- Contract output records workflow terms; it does not claim legal enforceability, provide legal
  advice, create a digital signature, or authorize/process payment.

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
- The client route guard is an experience feature, not an API security boundary.

Contract generation and amendments are implemented. Contract intelligence, payment processing,
and webhook integrations remain planned work. See [API_CONTRACTS.md](./API_CONTRACTS.md),
[DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md), and [DEVELOPMENT_STATUS.md](./DEVELOPMENT_STATUS.md) for
implementation and verification details.
