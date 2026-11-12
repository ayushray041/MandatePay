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
