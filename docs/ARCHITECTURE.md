## Architecture Overview

MandatePay is organized around three core backend services that run on Vercel serverless functions (or a dedicated Node.js backend if needed). All services share a common **Firebase** environment for authentication and data storage.

```
src/
├─ app/                     # Next.js App Router (frontend UI)
│   ├─ layout.tsx
│   └─ page.tsx
├─ lib/                     # Shared utilities
│   ├─ firebase.ts           # Firebase client init
│   ├─ admin.ts              # Firebase Admin SDK init (server only)
│   ├─ genai.ts              # Gemini client wrapper
│   └─ paypal.ts             # PayPal SDK wrapper (server only)
├─ services/                # Business‑logic layer
│   ├─ contractIntelligence/ # Parsing & term extraction
│   ├─ negotiation/          # Multi‑agent negotiation engine
│   └─ payment/              # PayPal order creation, capture, void
└─ models/                  # Zod schemas for request/response validation
    ├─ contract.ts
    ├─ negotiation.ts
    └─ payment.ts
```

### Data Flow
1. **User signs up or signs in** via Firebase Auth email/password (client-side, persisted locally). A verified ID token is sent to protected API routes; route guards provide UX redirects while APIs independently verify the token.
2. **Contract upload** → stored in Firestore (`contracts` collection) and optionally in Cloud Storage for PDF blobs.
3. **Contract Intelligence Service** reads the raw contract, calls Gemini, returns a structured `ContractTerms` object validated by Zod.
4. **Negotiation Service** creates two isolated agent contexts, each provided with the private mandate (generated server‑side). Agents exchange proposals via a persisted `negotiationRounds` sub‑collection. After ≤5 rounds the final proposal is stored as `amendments`.
5. **Payment Service** creates a PayPal order (authorization) using the approved amendment amount (in integer cents). The order ID is saved in the amendment document. Capture is triggered by a backend webhook after delivery confirmation.

### Security Considerations
- **Secrets** (Gemini API key, PayPal client secret, Firebase admin credentials) live only in Vercel environment variables and are accessed via server‑only code (`/src/app/api/...` routes). No secret is exposed to the browser.
- **Private mandates** are generated on the server, stored encrypted (e.g., using `crypto.subtle` with a KMS‑managed key) and never sent to the opposite agent.
- **Input validation** – every incoming JSON payload is validated with Zod before any business logic runs.
- **Identity and authorization** – API identity is derived only from a verified Firebase ID token. Firestore Admin SDK calls bypass Security Rules, so API handlers must enforce ownership themselves.
- **Payment integrity** – amounts are stored as integer cents; the front‑end never trusts user‑provided amounts – the server recomputes the total from the amendment data.
- **Firestore security rules** enforce that only the authenticated user can read/write their own contracts and that only admin service accounts may write payment status fields.

---
*For a deeper dive see the `docs/` files below.*
