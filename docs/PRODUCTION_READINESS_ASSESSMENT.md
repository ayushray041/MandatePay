# Production Readiness Assessment

**Assessment date:** 2026-11-12  
**Scope:** Repository implementation, automated tests, Firestore configuration, and documented
deployment requirements. No live Firebase project, PayPal account, or Gemini provider was accessed.

## Executive summary

MandatePay has a substantial server-authoritative workflow: Firebase ID-token authentication,
owner/agent-scoped mandates, negotiations with owner approval, immutable contract versions, and a
PayPal sandbox payment state machine. APIs derive identity from verified Firebase claims, validate
inputs, and use Firestore transactions for financial state changes. Direct client access to
financial collections is denied by the current rules.

This is **not yet production-verified**. The Firestore rules suite is conditional on an emulator and
was skipped in the local test run; live Firebase, PayPal sandbox, and Gemini integrations were not
exercised. A fresh dependency install reports 24 npm audit findings (19 moderate, 5 high). There is
also no scheduled recovery for accepted reservations that outlive a mandate or workflow. The
irreversible mandate-revocation path was changed to refuse revocation while budget remains reserved,
so revocation cannot strand a known accepted commitment.

“Complete and tested” below means covered by the repository's automated unit/API tests. It does not
mean validated against deployed services or by end-to-end browser tests.

## Feature inventory

| Area | Classification | Evidence and limitations |
|---|---|---|
| Firebase login, signup, browser persistence, logout, and protected page experience | Implemented but untested end-to-end | Firebase client SDK and route guard exist. No browser E2E or credential-backed authentication run was performed. |
| Firebase ID-token verification and profile APIs | Complete and tested | Bearer tokens are verified with revocation checking; profile identity comes from verified claims. Tests cover invalid/missing tokens, profile isolation, and role restrictions. |
| Agent profiles and discovery | Implemented but untested end-to-end | Server-owned identity and filtered discovery APIs exist; route tests cover creation and listing behavior. |
| Mandate creation, editing, limits, lifecycle, authorization, and audit events | Complete and tested | API and policy tests cover ownership, budget, approvals, limit increases, expiry, and authorization. Revocation now fails with `409` while reservations remain. |
| Negotiation offers, transitions, owner approvals, and budget reservations | Complete and tested | Tests cover transitions, duplicate decisions, owner-only approvals, required approvals, and serialized competing reservations. The concurrency tests use a Firestore test double, not the emulator. |
| Contract generation, approval, amendment, and version history | Complete and tested | API tests cover accepted-negotiation requirements, duplicate generation, participant review, reservation release, amendment capacity, and immutable versions. |
| Payment authorization, capture, cancellation, refund, and webhook reconciliation | Partially implemented | Sandbox workflow and mocked API/webhook tests cover amount derivation, payer authorization, cancellation safeguards, signatures, replay handling, and ledger reconciliation. Provider calls were not made with credentials; real-money processing is absent. |
| Negotiation and contract AI assistance | Implemented but untested | Deterministic policy checks and provider error cases have automated tests; no live Gemini call was made. |
| Dashboard, projects, mandates, negotiations, contracts, amendments, and payments pages | Implemented but untested end-to-end | App Router pages and workflow components exist. No browser-level workflow suite was run. |
| Firestore schema, indexes, and security rules | Implemented but untested | Rules and composite indexes are checked in. Rules tests exist but were skipped without an emulator; deployment to a Firebase project was not verified. |
| Expiry scheduling and reservation recovery | Missing | Negotiation expiry is recorded on mutation, not by a scheduled worker. There is no general recovery/settlement worker for abandoned reservations. |
| Real-money payments, payouts, and external service execution | Missing | Current payment adapter is fixed to PayPal sandbox. Mandate operation authorization records approval; it does not execute the underlying operation. |
| Release security and operations controls | Security concern | No confirmed exploitable vulnerability was identified, but dependency advisories, unverified deployed rules/IAM, and unresolved reservation expiry require action before production. |

## Control review

| Control | Assessment |
|---|---|
| Authentication | Protected APIs verify Firebase bearer ID tokens with revocation checking. Authentication failures fail closed. |
| Session handling | Browser-local Firebase persistence is used. There is no server session cookie; APIs remain protected by per-request ID-token verification. The page guard is not an API security boundary. |
| User isolation | API handlers derive the user UID from verified claims and enforce owner, assigned-agent, participant, or approver checks. Tests cover representative unauthorized access. |
| Server-side authorization | Financial reads and transitions run through server handlers using Firebase Admin. Admin SDK bypasses Firestore rules, so route-level checks remain required. |
| Firebase Admin configuration | Server module uses Application Default Credentials and a configured project ID. Misconfiguration leaves Admin services unavailable and APIs return service errors. Live project/credential operation is unverified. |
| Mandate limits and expiration | Amounts use integer minor units; policy accounts for committed and reserved amounts, dates, status, operations, conditions, and approval requirements. Expiry is enforced on access but no background expiry job runs. |
| Revocation | Owner-only and irreversible. It is now blocked while positive budget reservations exist. A policy for reservations that naturally outlive mandate expiry remains an open production requirement. |
| Negotiation approvals | Required owners are persisted; acceptance remains pending without reserving funds until every required owner approves. Final approval rechecks mandate authority and budget in the same transaction as reservation. |
| Contracts and payments | Contract approval is distinct from negotiation acceptance. Payments derive amounts from the approved version, use provider state and idempotency identifiers, and reconcile ledger changes transactionally. Provider behavior is not live-verified. |
| Firestore client access | Rules allow a user to read their own profile and deny direct access to workflow/financial collections by default. Emulator execution and deployed-rule verification remain outstanding. |
| Secrets and identities | `.env.local` is ignored and not tracked. No secret values were opened or copied. Production identity is not client-supplied; deterministic IDs found in test fixtures are test data. |

## Verification snapshot

Validation run from the repository root after the code and documentation changes:

- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `npm test`: passed — 26 files passed, 1 skipped; 120 tests passed, 3 skipped.
- `npm run build`: passed; all App Router API and page routes were generated.
- Firestore emulator rules tests: skipped because `FIRESTORE_EMULATOR_HOST` was not configured.
- Live Firebase, PayPal, and Gemini checks: not run. Build-time client configuration is not proof of
  live service connectivity.

## Release blockers and follow-up

1. Run Firestore rules tests with the required emulator/JDK and deploy rules plus indexes to the
   authorized project; verify the deployed project ID and service identity.
2. Resolve and review the 24 npm audit findings, including 5 reported high-severity findings,
   before production release.
3. Decide and implement how accepted, reserved commitments are resolved when a mandate naturally
   expires before contract generation, approval, or payment settlement. Do not silently release
   funds or bypass owner approval.
4. Perform authorized PayPal sandbox end-to-end tests for retries, provider callbacks, webhook
   verification, duplicate events, and reconciliation. Keep live payments disabled until separately
   approved.
5. Add browser E2E coverage for signup/login, owner approval, contract review, and payment lifecycle.
6. Define production operations: secret provisioning/rotation, monitoring and alerting, backup and
   restore checks, incident response, and provider reconciliation ownership.
