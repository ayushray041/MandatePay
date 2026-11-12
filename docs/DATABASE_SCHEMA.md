## Database Schema (Firestore)

Firestore is the primary data store. Client access is deliberately limited: user profiles may be
read by their owner; agents, mandates, authorizations, negotiations, contracts, and their histories
are accessed through authenticated server APIs only. Agent IAM records are server-only and every
credential write, session, usage counter, webhook registration, and activity event is scoped to the
authenticated agent owner.

| Collection | Document ID | Main fields | Purpose |
|------------|-------------|-------------|---------|
| `users` | Firebase `uid` | `uid`, `email`, `displayName`, `role`, `createdAt`, `updatedAt` | User profile created and updated by trusted API handlers. Self-service roles are `client` or `freelancer`. |
| `agents` | Firebase `uid` | `uid`, immutable `agentId`, immutable `ownerId`, `displayName`, capabilities, `status`, `healthStatus`, profile `version`, `runtimeVersion`, `rateLimitPerMinute`, `dailyQuota`, `lastSeenAt`, timestamps | One registered agent identity per owning Firebase account, with profile, runtime health, and server-enforced quota configuration. |
| `agentIdentities` | Immutable `agentId` | `agentId`, `ownerId`, `agentUid`, `createdAt` | Transactionally allocated identity registry. A document ID can be claimed once; the owner association is immutable. |
| `agentApiKeys` | Random key ID | `keyId`, `agentId`, `ownerId`, `name`, display-only prefix, HMAC-SHA-256 `tokenHash`, scopes, status, expiry, last-use and revocation timestamps | API credential metadata. The raw high-entropy secret is returned only during issuance/rotation and is never persisted. |
| `agentSessions` | API key ID | `keyId`, `agentId`, `ownerId`, status, `createdAt`, `lastSeenAt`, `expiresAt`, optional revocation time | One revocable server-side session per API credential. Session and key revocation are atomic. |
| `agentUsage` | Immutable `agentId` | UTC minute/day window identifiers, request counters, `updatedAt` | Shared per-agent quota counters updated atomically across all keys. |
| `agentActivity` | Auto ID | `ownerId`, `agentId`, actor, action, outcome, scope, request method/path, safe details, `createdAt` | Append-only agent activity and security events; raw credentials and request bodies are excluded. |
| `agentWebhooks` | Auto ID | `ownerId`, `agentId`, HTTPS URL, subscribed event names, status, timestamps | Owner-managed webhook endpoint registrations. Delivery/signature generation is not enabled. |
| `mandates` | Auto ID | `ownerId`, one `authorizedAgentId`, title and description, `durationType`, `startsAt`, nullable `expiresAt`, `spendingLimitMinor`, `spentAmountMinor`, negotiation `reservedAmountMinor`, pending-approval `authorizationReservedAmountMinor`, `velocityUsage`, currency, allowed operations, approval requirements (approver IDs, all/quorum), execution conditions, lifecycle/version, emergency suspension, renewal request, optional pending limit request, timestamps | Server-enforced spending authority. Budget and velocity counters are mutated transactionally; only the owner and assigned agent can access it through APIs. |
| `mandates/{id}/versions` | Zero-padded version number | `version`, `createdBy`, `createdAt`, `reason`, complete `snapshot` | Append-only mandate policy/lifecycle snapshots. Direct client access is denied. |
| `mandateAuthorizations` | Auto ID or SHA-256 idempotency key | `mandateId`, owner and assigned-agent IDs, operation, amount, currency, description, captured `mandateVersion`, approver IDs/quorum/approvals, pending reservation window keys, status, idempotency fingerprint, timestamps | Operation authorization requests and decisions. Pending requests reserve both total and UTC velocity budget transactionally; retries with the same idempotency key do not create duplicate reservations. Direct client access is denied. |
| `auditLogs` | Auto ID | `entity`, `entityId`, `action`, `performedBy`, `payload`, `timestamp` | Immutable server-side mandate audit events. |
| `negotiations` | Auto ID | `initiatorAgentId`, `recipientAgentId`, `initiatorMandateId`, nullable `recipientMandateId`, title, lifecycle status, expiry, current offer snapshot and ID, `requiredOwnerApprovalIds`, `ownerApprovals`, optional acceptance requester, `offerCount`, `eventCount`, resolution fields, timestamps | Private bilateral negotiation state. The recipient mandate is bound on the recipient's first counteroffer or acceptance. |
| `negotiations/{id}/offers` | Auto ID | `negotiationId`, sequence, `submittedByAgentId`, `mandateId`, terms, `createdAt` | Append-only offer and counteroffer history. Terms contain title, category, description, amount in integer minor units, currency, and delivery days. |
| `negotiations/{id}/events` | Auto ID | sequence, event type, exactly one agent or owner actor ID, optional offer ID and details, `createdAt` | Append-only negotiation lifecycle and activity history. |
| `contracts` | Accepted negotiation ID | `negotiationId`, participant and approver UIDs, mandate IDs, lifecycle status, current version pointer, approvals, active amendment ID, expiry, event count, timestamps | One server-generated contract per accepted negotiation; all participant access is through authorized APIs. |
| `contracts/{id}/versions` | `v1`, `v2`, ... | `contractId`, version, previous version ID, negotiation ID, optional amendment ID, creator, creation time, complete terms snapshot | Immutable contract documents. Approved amendments create a new version instead of modifying prior terms. |
| `contracts/{id}/amendments` | Auto ID | base version, complete proposed terms, review status, required approvers, approvals, creator, rejection reason, timestamps | Amendment proposals and party decisions. |
| `contracts/{id}/events` | Auto ID | sequence, event type, actor UID, optional amendment/version IDs and details, creation time | Append-only contract and amendment audit history. |
| `payments` | Contract ID | `contractId`, negotiation and participant IDs, payer/payee and mandate IDs, server-derived amount/currency, provider order/authorization/capture/refund IDs, idempotency hash, status, pending operation, attempt counters, mandate approval, timestamps | One payment record per contract, with a new idempotent cycle allowed after cancellation. Secret credentials and raw webhook payloads are not stored. |
| `payments/{contractId}/events` | Auto ID | sequence, lifecycle event, source, actor, optional provider event ID and details, `createdAt` | Append-only payment and provider activity history. |
| `paypalWebhookEvents` | SHA-256 of provider event ID | original provider event ID, event type, processing outcome, payment ID, receive timestamp | Durable webhook idempotency receipts; does not store raw event bodies or signature headers. |

Negotiation lifecycle states are `initiated`, `offer_submitted`, `counter_offered`,
`pending_owner_approval`, `accepted`, `rejected`, `expired`, and `cancelled`. When either mandate
requires owner approval, the negotiation records each required owner and their decisions; no budget
is reserved until all required owners approve. Final approval revalidates both active mandates and
reserves the amount transactionally on both participant mandates. Reserved amounts reduce available
mandate capacity and are not an execution or payment record.

Negotiation intelligence and contract analysis are stateless: requests use existing participant and
contract-version records, and prompts/model responses are not persisted in Firestore.

Mandate daily, ISO-weekly, monthly, and recurring usage windows are computed in UTC. Pending
operation approvals and accepted negotiations count against the applicable budget windows. Rejected
operation approvals and rejected contracts release their reservations transactionally. Mandate
version snapshots are written for creation, policy/lifecycle changes, limit increases, renewal, and
access-triggered expiry.

Mandate expiry is enforced on reads and authorization; a lifecycle access after the date marks the
record expired. There is no scheduled expiry worker. Permanent mandates have `expiresAt: null`.
Geographic, vendor, category, and contract-duration restrictions require trusted server-side
execution context; when that context is not available, authorization fails closed rather than
accepting client-provided identity or location.

### Indexes

`firestore.indexes.json` defines the composite indexes used for:

- Mandate listing by `ownerId` or `authorizedAgentId`, ordered by `createdAt`.
- Mandate approval inbox listing by `approvalRequirements.approverIds` and `createdAt`.
- Authorization listing by `mandateId`, ordered by `createdAt`.
- Contract listing by `ownerId`, ordered by `createdAt`.
- Agent discovery by category and `updatedAt`.
- Agent API key listing by `ownerId` and `createdAt`.
- Agent session, activity, and webhook listings by owner/agent and their respective timestamps.
- Negotiation inbox queries by `initiatorAgentId` or `recipientAgentId`, ordered by `updatedAt`.
- Contract participant listing by `participantIds` and `updatedAt`.
- Payment history listing by `participantIds` and `updatedAt`.
- Amendment reviewer listing by `requiredApproverIds` and `updatedAt`.

### Security rules

Rules in `firestore.rules`:

- Allow users to read only their own profile; all profile writes go through the authenticated API.
- Deny direct client reads and writes for agent profiles, identity registry, API credentials,
  sessions, usage counters, activity, webhook registrations, mandates, authorizations, negotiations,
  negotiation offers/events, contracts, contract versions, amendments, contract events, payments,
  payment events, and webhook idempotency receipts. APIs perform identity, participant, and
  ownership checks because Firebase Admin SDK access bypasses rules.
- Deny all other direct client access by default.

The rules are configured by `firebase.json`. Emulator-backed rules tests require
`FIRESTORE_EMULATOR_HOST`; see [DEVELOPMENT_STATUS.md](./DEVELOPMENT_STATUS.md) for the local JDK
requirement.
