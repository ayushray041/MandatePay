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
| `agentMarketplaceProfiles` | Immutable `agentId` | `agentId`, `ownerId`, directory visibility/allowlist/organization, admin verification status/reason, version and timestamps | Owner-controlled marketplace visibility and platform-managed verification; all access is through authorized APIs. |
| `agentServiceListings` | Auto ID | `agentId`, private `ownerUid`, listing content/actions/pricing/SLA, visibility/organization, status, version, timestamps | Service catalog entries. New entries are drafts; search exposes published entries only after directory and organization membership checks. |
| `agentServiceListings/{id}/versions` | Zero-padded version | `version`, `createdBy`, `createdAt`, full listing snapshot | Append-only service listing and visibility history, capped at 50 returned versions. |
| `marketplaceOrganizations` | Auto ID | `name`, `ownerId`, timestamps | Server-managed private directory organization; owner association cannot be changed through the API. |
| `marketplaceOrganizations/{id}/members` | Firebase `uid` | `uid`, `role`, `createdAt` | Owner-managed membership; owner additions require an existing user and membership is capped at 200. |
| `marketplacePreferences` | Firebase `uid` | `ownerUid`, allowlisted and blocklisted immutable agent IDs, `updatedAt` | Per-user marketplace discovery filters. |
| `marketplaceReviews` | SHA-256 of payment ID | `agentId`, `paymentId`, private `reviewerUid`, rating, comment, `createdAt` | One review per completed payment, submitted by its verified payer; only reviewer label and review content are public. |
| `marketplaceAgentMetrics` | Immutable `agentId` | `reviewCount`, `ratingTotal`, completed transaction and capture outcome counts, `updatedAt` | Server-maintained aggregate marketplace ratings and payment-backed reliability metrics. |
| `marketplacePaymentOutcomes` | SHA-256 of payment ID and outcome key | `paymentId`, `agentId`, outcome, `createdAt` | Deduplication receipt written transactionally with capture outcome metrics. |
| `mandates` | Auto ID | `ownerId`, one `authorizedAgentId`, title and description, `durationType`, `startsAt`, nullable `expiresAt`, `spendingLimitMinor`, `spentAmountMinor`, negotiation `reservedAmountMinor`, pending-approval `authorizationReservedAmountMinor`, `velocityUsage`, currency, allowed operations, approval requirements (approver IDs, all/quorum), execution conditions, lifecycle/version, emergency suspension, renewal request, optional pending limit request, timestamps | Server-enforced spending authority. Budget and velocity counters are mutated transactionally; only the owner and assigned agent can access it through APIs. |
| `mandates/{id}/versions` | Zero-padded version number | `version`, `createdBy`, `createdAt`, `reason`, complete `snapshot` | Append-only mandate policy/lifecycle snapshots. Direct client access is denied. |
| `mandateAuthorizations` | Auto ID or SHA-256 idempotency key | `mandateId`, owner and assigned-agent IDs, operation, amount, currency, description, captured `mandateVersion`, approver IDs/quorum/approvals, pending reservation window keys, status, idempotency fingerprint, timestamps | Operation authorization requests and decisions. Pending requests reserve both total and UTC velocity budget transactionally; retries with the same idempotency key do not create duplicate reservations. Direct client access is denied. |
| `auditLogs` | Auto ID | `entity`, `entityId`, `action`, `performedBy`, `payload`, `timestamp` | Immutable server-side mandate audit events. |
| `negotiations` | Auto ID | `initiatorAgentId`, `recipientAgentId`, both mandate IDs, title, lifecycle status, expiry, current and locked offer snapshots/IDs, `requiredOwnerApprovalIds`, `ownerApprovals`, decision reasons, `version`, `offerCount`, `eventCount`, optional batch metadata, reservation windows, resolution fields, timestamps | Private bilateral negotiation state. A batch groups independent negotiations; vendor decisions and reservations never affect siblings. The recipient mandate is bound on the first counteroffer or acceptance. |
| `negotiations/{id}/offers` | Zero-padded sequence | `negotiationId`, sequence/version, `submittedByAgentId`, `mandateId`, terms, `createdAt` | Append-only offer/counteroffer history. A transaction checks `expectedOfferId` and serializes sequence allocation; no more than 100 offers are accepted. |
| `negotiations/{id}/events` | Auto ID | sequence, event type, one agent, owner, or system actor ID, optional offer ID/details, `createdAt` | Append-only negotiation lifecycle and activity history. Owner and system actor identifiers are redacted in participant responses as needed. |
| `negotiations/{id}/versions` | Zero-padded version | version, status, current offer snapshot/ID, offer count, redacted-on-read actor ID, timestamps | Append-only snapshots used for chronological replay and version history. |
| `negotiations/{id}/disputes` | `current` | participant agent ID, category, bounded reason, open status, `createdAt` | One participant-raised dispute escalation per accepted negotiation; read/write is server-only. |
| `negotiationStrategyProfiles` | Firebase `uid` | posture, unique priorities, concession step, owner ID, `updatedAt` | User-owned advisory preferences. They do not change mandate policy or grant transaction authority. |
| `contracts` | Accepted negotiation ID | `negotiationId`, participant and approver UIDs, mandate IDs, lifecycle status, current version pointer, approvals, active amendment ID, expiry, event count, timestamps | One server-generated contract per accepted negotiation; all participant access is through authorized APIs. Expiry is recorded by the scheduler or on participant detail access. |
| `contracts/{id}/versions` | `v1`, `v2`, ... | `contractId`, version, previous version ID, negotiation ID, optional amendment ID, creator, creation time, complete terms snapshot, canonical SHA-256 integrity hash, document metadata | Immutable contract documents. Approved amendments create a new version instead of modifying prior terms. Legacy versions created before integrity hashes remain readable but unverified. |
| `contracts/{id}/amendments` | Auto ID | base version, complete proposed terms, review status, required approvers, approvals, creator, rejection reason, timestamps | Amendment proposals and party decisions. |
| `contracts/{id}/events` | Auto ID | sequence, event type, actor UID, optional amendment/version IDs and details, creation time | Append-only contract and amendment audit history. |
| `payments` | Contract ID | `contractId`, negotiation and participant IDs, payer/payee and mandate IDs, server-derived amount/currency, provider order/authorization/capture/refund IDs, idempotency hash, status, pending operation, attempt counters, mandate approval, timestamps | One payment record per contract, with a new idempotent cycle allowed after cancellation. Secret credentials and raw webhook payloads are not stored. |
| `payments/{contractId}/events` | Auto ID | sequence, lifecycle event, source, actor, optional provider event ID and details, `createdAt` | Append-only payment and provider activity history. |
| `paypalWebhookEvents` | SHA-256 of provider event ID | original provider event ID, event type, processing outcome, payment ID, receive timestamp | Durable webhook idempotency receipts; does not store raw event bodies or signature headers. |
| `aiDecisionHistory` | Auto ID | `actorUserId`, action, resource type/ID, source, provider/model/prompt version, confidence basis, human-review flag, bounded evidence references, structured result, `createdAt` | Private caller-scoped recommendation and risk history. Prompt context and raw source documents are not stored. |
| `aiUsage` | SHA-256 of Firebase UID | `userHash`, UTC day, daily request count, `updatedAt` | Atomic per-user LLM request quota; contains no raw UID and keeps one rolling daily record per user. |

Negotiation lifecycle states are `initiated`, `offer_submitted`, `counter_offered`,
`pending_owner_approval`, `accepted`, `rejected`, `expired`, and `cancelled`. Every state change
advances the negotiation version and writes a snapshot. Mutations compare the expected current offer;
acceptance locks that offer until all required owners approve or reject. When approval is required,
no budget is reserved until the final approval revalidates both mandates and atomically reserves the
amount against both. Reserved amounts reduce available mandate capacity and are not an execution or
payment record. Optional quantity/SLA/contract/conditional terms are strictly validated and copied
into immutable contract versions without being interpreted as payment authorization.

Negotiation intelligence and contract analysis use existing participant and immutable contract
version records plus caller-owned strategy profiles. Prompts and source text are not persisted.
Validated structured results and references to their evidence are persisted in
`aiDecisionHistory` for the verified caller; entries currently have no automatic retention/TTL
cleanup. Risk analysis is deterministic and reads only caller-visible payment history or the
caller's registered-agent activity. Its price references are based only on observed completed
payments/offers and are labeled as non-market data. `aiUsage` stores a hashed user key and one daily
counter, not prompt or model content.

Negotiations expire on access and through `POST /api/negotiations/expire`. The worker transactionally
marks at most 100 due records per call and appends the corresponding event/version. Production must
configure a trusted scheduler to call the endpoint with server-only `CRON_SECRET`; no deployment
platform or schedule is configured in this repository.

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
- Marketplace listings by publication status/time, owner/time, and agent/status/time.
- Marketplace reviews by agent/time and organization membership by UID (collection group).
- Negotiation inbox queries by `initiatorAgentId` or `recipientAgentId`, ordered by `updatedAt`.
- Negotiation batch lookup by `batchId` and scheduled expiry by `status`/`expiresAt`.
- Contract participant listing by `participantIds` and `updatedAt`.
- Payment history listing by `participantIds` and `updatedAt`.
- AI recommendation history listing by `actorUserId` and `createdAt`.
- Amendment reviewer listing by `requiredApproverIds` and `updatedAt`.

### Security rules

Rules in `firestore.rules`:

- Allow users to read only their own profile; all profile writes go through the authenticated API.
- Deny direct client reads and writes for agent profiles, identity registry, API credentials,
  sessions, usage counters, activity, webhook registrations, mandates, authorizations, negotiations,
  negotiation offers/events/versions/disputes, strategy profiles, contracts, contract versions, amendments, contract events, payments,
  payment events, marketplace profiles/listings/organizations/members/preferences/reviews/metrics,
  payment outcome receipts, AI recommendation history, AI usage counters, and webhook idempotency
  receipts. APIs perform identity, participant, visibility, and ownership checks because Firebase
  Admin SDK access bypasses rules.
- Deny all other direct client access by default.

The rules are configured by `firebase.json`. Emulator-backed rules tests require
`FIRESTORE_EMULATOR_HOST`; see [DEVELOPMENT_STATUS.md](./DEVELOPMENT_STATUS.md) for the local JDK
requirement.
