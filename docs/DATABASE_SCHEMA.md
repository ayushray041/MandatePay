## Database Schema (Firestore)

The system uses **Firebase Firestore** as the primary data store. All collections are top‑level; sub‑collections are used for versioning and negotiation history.

| Collection | Document ID | Fields (type) | Description |
|------------|-------------|---------------|-------------|
| **users** | `uid` (string) | `email: string`, `displayName: string`, `role: "client" | "freelancer" | "admin"`, `createdAt: timestamp`, `updatedAt: timestamp` | Firebase Auth users. Roles are provisioned by the trusted API; self-service signup may choose only `client` or `freelancer`. |
| **contracts** | `contractId` (auto‑id) | `ownerId: string`, `title: string`, `status: "uploaded" | "processed" | "negotiating" | "completed"`, `originalUrl: string` (optional Cloud Storage link), `createdAt: timestamp`, `updatedAt: timestamp` | Raw contract documents uploaded by a user. |
| **contractTerms** (sub‑collection of a contract) | `termsId` (auto‑id) | `terms: object` (Zod‑validated structure), `validatedAt: timestamp` | Result of the Contract Intelligence service – extracted & classified terms. |
| **negotiations** | `negotiationId` (auto‑id) | `contractId: string`, `clientAgentId: string`, `freelancerAgentId: string`, `status: "in_progress" | "finalized" | "rejected"`, `currentRound: number`, `maxRounds: 5`, `createdAt: timestamp`, `updatedAt: timestamp` | Holds state for a negotiation session. |
| **negotiations/{negotiationId}/rounds** | `roundNumber` (int) | `proposals: { client?: object, freelancer?: object }`, `timestamp: timestamp` | Each round's proposals exchanged between agents. |
| **amendments** (sub‑collection of a negotiation) | `amendmentId` (auto‑id) | `finalProposal: object`, `approvedByClient: boolean`, `approvedByFreelancer: boolean`, `version: number`, `createdAt: timestamp` | The agreed‑upon contract amendment ready for payment. |
| **payments** | `paymentId` (auto‑id) | `amendmentId: string`, `orderId: string` (PayPal), `status: "authorized" | "captured" | "voided" | "failed"`, `amountCents: number`, `currency: string`, `createdAt: timestamp`, `updatedAt: timestamp` | PayPal order lifecycle. |
| **auditLogs** (optional) | `logId` (auto‑id) | `entity: string`, `entityId: string`, `action: string`, `payload: object`, `performedBy: string`, `timestamp: timestamp` | Immutable log for compliance and debugging. |

### Indexes & Security Rules
* Composite index on `contracts.ownerId` + `createdAt` for user‑wise contract listing (`firestore.indexes.json`).
* Security rules enforce:
  * Users can read their own profile; profile writes go through the authenticated API.
  * Users can create, read, update the title of, and delete only their own contracts.
  * Contract terms are readable only by the owning contract user and writable only by trusted server code.
  * Negotiations, amendments, payments, and audit logs are denied to direct client access until their server workflows are implemented.
  * No client can directly modify `payments.status`; it is only updated by server‑side webhook handling.

Firestore rules are deployed from `firestore.rules`, configured in `firebase.json`. Firebase Admin SDK operations bypass these rules, so API routes must independently verify identity and ownership.

---
*See `docs/API_CONTRACTS.md` for the HTTP layer that manipulates these collections.*