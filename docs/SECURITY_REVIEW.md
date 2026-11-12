# Security Review

**Review date:** 2026-11-12

**Scope:** Repository authentication, API authorization, mandate and negotiation approval flows,
contract/payment transitions, marketplace visibility and owner workflows, Firestore
rules/configuration, and secret handling. This is a code-based review, not a penetration test or a
review of a live Firebase/PayPal deployment. The Agent Identity and Access Management and
marketplace implementations described below have not received a separate penetration test.

## Findings

No confirmed exploitable security vulnerability was identified in the reviewed repository scope.
The security review agent reported no vulnerabilities. The implementation and tests show
server-side Firebase ID-token verification, identity derivation from verified claims, API-level
participant/owner checks, Firestore deny-by-default rules for financial data, and transactional
approval and ledger updates.

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| — | — | — | — | No confirmed exploitable vulnerability identified in the reviewed scope. | — |

## Controls inspected

- **Firebase authentication:** protected APIs require a bearer ID token. `verifyIdToken` calls
  Firebase Admin `verifyIdToken(token, true)`, checking revoked tokens. Missing and malformed
  credentials are rejected. Admin unavailability fails closed.
- **Session model:** the browser uses Firebase local persistence and sends an ID token to protected
  APIs. There is no custom server session. Client route protection is UX only; server handlers
  independently authenticate.
- **Identity and isolation:** owner, agent, participant, payer, and approver identities are derived
  from verified claims and stored server records. Request payload UIDs are not authorization
  inputs. Test fixtures use fixed IDs, but production handler identity is token-derived.
- **Admin SDK:** Firebase Admin is initialized server-side using Application Default Credentials
  and the configured project. Admin SDK bypasses Firestore rules, so each API performs its own
  authorization. Configuration and live IAM behavior were not verified against a deployed project.
- **Mandates:** transaction-backed workflows validate active status, dates, allowed operations,
  conditions, approvals, and available budget. Owner revocation is irreversible, so a regression
  fix now rejects revocation while reservations remain.
- **Negotiations:** state changes and offers are transactional and compare the expected current
  offer ID; accepted/pending offers are locked, offer history is bounded, and versions/events are
  append-only. Required owners are revalidated before the final atomic dual-mandate reservation.
  Suspended agents cannot submit or accept offers. Multi-vendor batches remain independent and
  cross-vendor comparisons are restricted to the initiator. Owner actor identifiers are redacted
  from snapshots/events where the viewer is not authorized to see them.
- **Contracts:** one contract per accepted negotiation; required approvers are persisted; versions
  and events are append-only; amendment deltas and reservations are applied transactionally.
- **Payments:** client amounts are rejected; amounts are derived from approved contract terms;
  PayPal environment is fixed to sandbox; provider operations use stable request IDs; webhook
  signatures and event IDs are checked before transactional ledger reconciliation.
- **Firestore rules:** client writes are denied and financial/workflow collections are denied to
  direct clients, with a default deny. The emulator-backed rules tests were not run in this
  assessment.
- **Secrets:** `.env.local` is ignored by Git and is not tracked. Its contents were not opened.
- **Agent API authentication (implementation controls, not independently audited):** Keys use
  256-bit random secrets and a keyed HMAC-SHA-256 digest; the server-only
  `AGENT_API_KEY_PEPPER` must be at least 32 bytes. Raw keys are returned only during issuance or
  rotation. The owner-bound immutable agent ID registry prevents reassignment. The API key
  principal is accepted only by dedicated `/api/agent/v1/*` routes, where scope, current agent
  status, credential/session state, expiry, mandate assignment, and transactional per-agent quotas
  are checked. The broader Firebase user APIs continue to require Firebase ID tokens.
- **Agent audit and rules:** Key and session revocation, key rotation, owner security changes, and
  authenticated agent API requests append activity events. Direct client access to the agent
  identity registry, API keys, sessions, usage, activity, and webhook collections is explicitly
  denied by Firestore rules.
- **Marketplace visibility:** Directory and listing reads derive identity from verified Firebase
  tokens and check listing ownership, current directory settings, and current organization
  membership for both viewer and publisher. Owner-controlled listing content is projected through
  validated public schemas; private owner IDs, membership records, reviewer IDs, and credentials
  are not included. Organization membership and listing updates are server-side, transaction-backed
  operations. Reviews are tied to a completed payment by its authenticated payer and are unique per
  payment. Verification changes require a server-read admin role.
- **Marketplace metrics:** Capture success/failure aggregates are updated with deduplication
  receipts in the same Firestore transaction as payment reconciliation. Metrics are informational
  and do not authorize a transaction or establish a service guarantee.
- **AI decision and risk intelligence:** Negotiation/contract output is strict-schema validated,
  advisory, and marked for human review; no model tools or financial mutation paths are exposed.
  Risk analysis uses caller-scoped server records and deterministic thresholds. Sample-size
  confidence is not a calibrated probability. Provider telemetry excludes prompt/content data;
  structured results and bounded evidence references are stored in server-only, caller-scoped
  history. History currently has no automatic retention cleanup and needs an approved retention
  policy before production.

## Residual risks and verification gaps

1. **Expiry scheduling and reserved funds:** a bounded negotiation-expiry endpoint is implemented,
   but production must configure a scheduler and `CRON_SECRET`; no deployment scheduler is
   configured here. A reserved accepted commitment can outlive a mandate and lacks a general recovery path. This is a business
   and financial consistency decision requiring an explicit approved policy; do not resolve it by
   silently releasing funds or weakening owner approval.
2. **External service evidence:** Firebase, PayPal sandbox, and Gemini were not exercised with live
   credentials. The review does not establish deployed configuration, IAM, webhook registration,
   or provider reconciliation behavior.
3. **Firestore rules evidence:** tests are present but require a running emulator. Deployed rules
   and indexes were not inspected.
4. **Dependency advisories:** the locked install reported 24 npm audit findings (19 moderate and 5
   high). Review and remediate these before release.
5. **Test model:** unit/API tests mock Firebase, transactions, and providers. They establish route
   and policy behavior but do not establish Firebase transaction contention behavior or provider
   guarantees.
6. **Agent IAM deployment:** API key issuance/authentication fail closed until a strong
   `AGENT_API_KEY_PEPPER` is provisioned in the production secret manager. The new Firestore indexes
   and rules must be deployed before enabling management APIs. Changing the pepper invalidates all
   credentials; it must be preserved or coordinated with a full key reissue. Existing registered
   agent profiles receive immutable IDs on their next profile or credential-management access.
7. **Webhook delivery:** Webhooks are registration metadata only. There is no delivery, signature,
   or retry implementation; adding delivery requires SSRF-safe outbound networking and signed,
   replay-resistant payloads.
8. **Marketplace search scale:** Discovery scans a bounded window of up to 500 recent listings and
   reports when that window is full. Search is not exhaustive at larger catalog sizes; indexed
   filters and cursor pagination are required before relying on it as a large-scale directory.
9. **AI operational controls:** Gemini is the only bundled provider adapter. Token-cost telemetry
   is an estimate and requires operator-supplied rates; no global spend ceiling or live-provider
   cost/performance evaluation is configured. The per-user daily request quota is not a substitute
   for provider account-level budgets and alerting.

## Assessment outcome

No confirmed high/critical vulnerability was found that warranted a security hotfix. The
reservation-aware revocation change is a financial workflow safety fix, not a finding of an
exploitable vulnerability. Production release remains blocked on the verification gaps above.
