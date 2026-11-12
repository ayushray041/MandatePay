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
- Build the remaining contract, negotiation, amendment, and payment APIs; their planned contracts are documented in [API_CONTRACTS.md](./API_CONTRACTS.md).

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
