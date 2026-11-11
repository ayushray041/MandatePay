## Database Schema (Firestore)

The system uses **Firebase Firestore** as the primary data store. All collections are top‑level; sub‑collections are used for versioning and negotiation history.

| Collection | Document ID | Fields (type) | Description |
|------------|-------------|---------------|-------------|
| **users** | `uid` (string) | `email: string`, `displayName?: string`, `role: "client" | "freelancer" | "admin"`, `createdAt: timestamp` | Firebase Auth users. Used for ACL checks. |
| **contracts** | `contractId` (auto‑id) | `ownerId: string`, `title: string`, `status: "uploaded" | "processed" | "negotiating" | "completed"`, `originalUrl: string` (optional Cloud Storage link), `createdAt: timestamp`, `updatedAt: timestamp` | Raw contract documents uploaded by a user. |
| **contractTerms** (sub‑collection of a contract) | `termsId` (auto‑id) | `terms: object` (Zod‑validated structure), `validatedAt: timestamp` | Result of the Contract Intelligence service – extracted & classified terms. |
| **negotiations** | `negotiationId` (auto‑id) | `contractId: string`, `clientAgentId: string`, `freelancerAgentId: string`, `status: "in_progress" | "finalized" | "rejected"`, `currentRound: number`, `maxRounds: 5`, `createdAt: timestamp`, `updatedAt: timestamp` | Holds state for a negotiation session. |
| **negotiations/{negotiationId}/rounds** | `roundNumber` (int) | `proposals: { client?: object, freelancer?: object }`, `timestamp: timestamp` | Each round's proposals exchanged between agents. |
| **amendments** (sub‑collection of a negotiation) | `amendmentId` (auto‑id) | `finalProposal: object`, `approvedByClient: boolean`, `approvedByFreelancer: boolean`, `version: number`, `createdAt: timestamp` | The agreed‑upon contract amendment ready for payment. |
| **payments** | `paymentId` (auto‑id) | `amendmentId: string`, `orderId: string` (PayPal), `status: "authorized" | "captured" | "voided" | "failed"`, `amountCents: number`, `currency: string`, `createdAt: timestamp`, `updatedAt: timestamp` | PayPal order lifecycle. |
| **auditLogs** (optional) | `logId` (auto‑id) | `entity: string`, `entityId: string`, `action: string`, `payload: object`, `performedBy: string`, `timestamp: timestamp` | Immutable log for compliance and debugging. |

### Indexes & Security Rules
* Composite index on `contracts.ownerId` + `createdAt` for user‑wise contract listing.
* Security rules enforce:
  * Users can read/write only their own `contracts` and related sub‑collections.
  * Service accounts (admin) may write to `payments` and `auditLogs`.
  * No client can directly modify `payments.status`; it is only updated by server‑side webhook handling.

---
*See `docs/API_CONTRACTS.md` for the HTTP layer that manipulates these collections.*