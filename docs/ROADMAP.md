# Roadmap

This roadmap is based on the implementation and evidence available in the repository as of
2026-11-12. It is ordered by launch risk; it does not imply that an external service is configured
or production-ready.

## P0 — Resolve launch blockers

- **Verify Firestore access controls:** run `npm run test:rules` with the required JDK/emulator,
  review any failures, and deploy `firestore.rules` plus `firestore.indexes.json` to the authorized
  Firebase project. Confirm the deployed project ID and least-privilege service identity.
- **Resolve dependency advisories:** review and remediate the 24 npm audit findings reported by the
  locked install (19 moderate, 5 high), then rerun the full validation commands.
- **Prove sandbox payment reconciliation:** in an authorized PayPal sandbox, test create,
  authorize, capture, void, refund, duplicate/replayed webhooks, provider timeouts, and retries.
  Verify provider and Firestore state after every failure.
- **Define reserved-commitment expiry policy:** accepted negotiation reservations can remain after a
  mandate expires. Decide how such commitments can complete or be released without violating prior
  approval; add auditable transitions and recovery tests before enabling production money flows.
- **Validate deployment credentials:** provision Firebase Admin credentials and PayPal/Gemini
  secrets through a managed secret store. Do not place secret values in source or client bundles.

## P1 — Improve workflow assurance

- Add browser E2E tests for authentication, mandate lifecycle, required owner approval, contract
  rejection/activation, and sandbox payment recovery.
- Add emulator-backed Firestore transaction tests for distinct concurrent negotiations competing
  for shared mandate capacity, concurrent owner approvals, and payment ledger transitions. Existing
  API concurrency tests use serialized test doubles and are not a substitute for emulator tests.
- Add scheduled expiry and operational reconciliation jobs with idempotent, auditable state
  transitions. Alert on pending provider operations and reservations that exceed their expected
  lifecycle.
- Add production-grade monitoring for authentication availability, Firestore errors, webhook
  retries, provider timeouts, stale reservations, and failed financial state transitions. Exclude
  credentials, prompts, and commercial content from logs.
- Establish an operational runbook for provider incidents, key rotation, backups, restore tests, and
  financial reconciliation.

## P2 — Extend only after control verification

- Add a separately reviewed real-payment provider integration only after sandbox, legal, compliance,
  and reconciliation requirements are approved. The current PayPal adapter is sandbox-only.
- Add explicit execution/settlement integrations for mandate operations; an approved operation
  authorization currently records policy approval and budget commitment but performs no external
  operation.
- Consider pagination and retention/archival policies for growing histories, preserving required
  audit evidence and idempotency receipts.
- Revisit availability and disaster recovery targets for Firebase, provider callbacks, and AI
  advisory services.

## Completed in this assessment

- Prevented irreversible mandate revocation while accepted budget reservations remain outstanding.
- Added regression tests for blocked revocation and revocation after reservations are resolved.
- Added production-readiness, security-review, architecture-evolution, and roadmap assessments.
