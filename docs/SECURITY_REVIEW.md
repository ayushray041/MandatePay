# Security Review

**Review date:** 2026-11-12  
**Scope:** Repository authentication, API authorization, mandate and negotiation approval flows,
contract/payment transitions, Firestore rules/configuration, and secret handling. This is a
code-based review, not a penetration test or a review of a live Firebase/PayPal deployment.

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
- **Negotiations:** state changes and offers are transactional; approval requirements are stored,
  owner decisions are restricted to required owners, final approval revalidates both mandates, and
  budget is reserved atomically only after all required approvals.
- **Contracts:** one contract per accepted negotiation; required approvers are persisted; versions
  and events are append-only; amendment deltas and reservations are applied transactionally.
- **Payments:** client amounts are rejected; amounts are derived from approved contract terms;
  PayPal environment is fixed to sandbox; provider operations use stable request IDs; webhook
  signatures and event IDs are checked before transactional ledger reconciliation.
- **Firestore rules:** client writes are denied and financial/workflow collections are denied to
  direct clients, with a default deny. The emulator-backed rules tests were not run in this
  assessment.
- **Secrets:** `.env.local` is ignored by Git and is not tracked. Its contents were not opened.

## Residual risks and verification gaps

1. **Natural expiry and reserved funds:** there is no scheduled expiry/recovery worker. A reserved
   accepted commitment can outlive a mandate and lacks a general recovery path. This is a business
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

## Assessment outcome

No confirmed high/critical vulnerability was found that warranted a security hotfix. The
reservation-aware revocation change is a financial workflow safety fix, not a finding of an
exploitable vulnerability. Production release remains blocked on the verification gaps above.
