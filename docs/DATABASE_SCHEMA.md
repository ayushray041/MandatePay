## Database Schema (Firestore)

Firestore is the primary data store. Client access is deliberately limited: user profiles may be
read by their owner; agents, mandates, authorizations, negotiations, contracts, and their histories
are accessed through authenticated server APIs only.

| Collection | Document ID | Main fields | Purpose |
|------------|-------------|-------------|---------|
| `users` | Firebase `uid` | `uid`, `email`, `displayName`, `role`, `createdAt`, `updatedAt` | User profile created and updated by trusted API handlers. Self-service roles are `client` or `freelancer`. |
| `agents` | Firebase `uid` | `uid`, `displayName`, `headline`, `bio`, `categories`, `capabilities`, `supportedCurrencies`, `availability`, timestamps | Registered freelancer identity and discovery capabilities. Does not contain email or mandate data. |
| `mandates` | Auto ID | `ownerId`, `authorizedAgentId`, title and description, `spendingLimitMinor`, `spentAmountMinor`, `reservedAmountMinor`, currency, date window, allowed operations, approval requirements, execution conditions, lifecycle status, optional pending limit request, timestamps | Server-enforced spending authority. Only the owner and assigned agent can access it through APIs. |
| `mandateAuthorizations` | Auto ID | `mandateId`, `ownerId`, `authorizedAgentId`, operation, amount, currency, description, status, timestamps | Operation authorization requests and owner decisions. Direct client access is denied. |
| `auditLogs` | Auto ID | `entity`, `entityId`, `action`, `performedBy`, `payload`, `timestamp` | Immutable server-side mandate audit events. |
| `negotiations` | Auto ID | `initiatorAgentId`, `recipientAgentId`, `initiatorMandateId`, nullable `recipientMandateId`, title, lifecycle status, expiry, current offer snapshot and ID, `offerCount`, `eventCount`, resolution fields, timestamps | Private bilateral negotiation state. The recipient mandate is bound on the recipient's first counteroffer or acceptance. |
| `negotiations/{id}/offers` | Auto ID | `negotiationId`, sequence, `submittedByAgentId`, `mandateId`, terms, `createdAt` | Append-only offer and counteroffer history. Terms contain title, category, description, amount in integer minor units, currency, and delivery days. |
| `negotiations/{id}/events` | Auto ID | sequence, event type, `actorAgentId`, optional offer ID and details, `createdAt` | Append-only negotiation lifecycle and activity history. |
| `contracts` | Accepted negotiation ID | `negotiationId`, participant and approver UIDs, mandate IDs, lifecycle status, current version pointer, approvals, active amendment ID, expiry, event count, timestamps | One server-generated contract per accepted negotiation; all participant access is through authorized APIs. |
| `contracts/{id}/versions` | `v1`, `v2`, ... | `contractId`, version, previous version ID, negotiation ID, optional amendment ID, creator, creation time, complete terms snapshot | Immutable contract documents. Approved amendments create a new version instead of modifying prior terms. |
| `contracts/{id}/amendments` | Auto ID | base version, complete proposed terms, review status, required approvers, approvals, creator, rejection reason, timestamps | Amendment proposals and party decisions. |
| `contracts/{id}/events` | Auto ID | sequence, event type, actor UID, optional amendment/version IDs and details, creation time | Append-only contract and amendment audit history. |
| `payments` | Contract ID | `contractId`, negotiation and participant IDs, payer/payee and mandate IDs, server-derived amount/currency, provider order/authorization/capture/refund IDs, idempotency hash, status, pending operation, attempt counters, mandate approval, timestamps | One payment record per contract, with a new idempotent cycle allowed after cancellation. Secret credentials and raw webhook payloads are not stored. |
| `payments/{contractId}/events` | Auto ID | sequence, lifecycle event, source, actor, optional provider event ID and details, `createdAt` | Append-only payment and provider activity history. |
| `paypalWebhookEvents` | SHA-256 of provider event ID | original provider event ID, event type, processing outcome, payment ID, receive timestamp | Durable webhook idempotency receipts; does not store raw event bodies or signature headers. |

Negotiation lifecycle states are `initiated`, `offer_submitted`, `counter_offered`, `accepted`,
`rejected`, `expired`, and `cancelled`. Accepted amounts are added transactionally to
`reservedAmountMinor` on both participant mandates. Reserved amounts reduce available mandate
capacity and are not an execution or payment record.

Negotiation intelligence and contract analysis are stateless: requests use existing participant and
contract-version records, and prompts/model responses are not persisted in Firestore.

### Indexes

`firestore.indexes.json` defines the composite indexes used for:

- Mandate listing by `ownerId` or `authorizedAgentId`, ordered by `createdAt`.
- Authorization listing by `mandateId`, ordered by `createdAt`.
- Contract listing by `ownerId`, ordered by `createdAt`.
- Agent discovery by category and `updatedAt`.
- Negotiation inbox queries by `initiatorAgentId` or `recipientAgentId`, ordered by `updatedAt`.
- Contract participant listing by `participantIds` and `updatedAt`.
- Payment history listing by `participantIds` and `updatedAt`.
- Amendment reviewer listing by `requiredApproverIds` and `updatedAt`.

### Security rules

Rules in `firestore.rules`:

- Allow users to read only their own profile; all profile writes go through the authenticated API.
- Deny direct client reads and writes for agent profiles, mandates, authorizations, negotiations,
  negotiation offers/events, contracts, contract versions, amendments, contract events, payments,
  payment events, and webhook idempotency receipts. APIs perform identity, participant, and
  ownership checks because Firebase Admin SDK access bypasses rules.
- Deny all other direct client access by default.

The rules are configured by `firebase.json`. Emulator-backed rules tests require
`FIRESTORE_EMULATOR_HOST`; see [DEVELOPMENT_STATUS.md](./DEVELOPMENT_STATUS.md) for the local JDK
requirement.
