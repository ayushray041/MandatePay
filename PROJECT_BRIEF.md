# Project Brief – MandatePay

**Purpose**

MandatePay is an AI‑powered freelance contract negotiation platform. It ingests existing freelance contracts, extracts the terms, and lets two independent AI agents (client‑side and freelancer‑side) negotiate amendments under private financial mandates. Once both parties approve, a versioned contract amendment is generated and a PayPal payment authorization is created. Capture occurs after delivery‑based fulfillment.

**Core Systems**

1. **Contract Intelligence** – Uses Gemini API (`@google/genai`) to parse contract documents, identify added/modified/removed/ambiguous requirements, and present evidence from the original text for human confirmation. Validation is performed with Zod schemas.
2. **Multi‑Agent Negotiation** – Two deterministic agents negotiate price, deliverables, revisions, and deadlines. Negotiation is limited to a maximum of five rounds and supports stress‑testing and “no‑deal” outcomes.
3. **Contract & PayPal Integration** – Generates versioned contract amendments stored in Firestore, requires dual‑party human approval, creates a PayPal order (authorization) via the PayPal Orders API v2, and captures payment only after successful fulfillment. Uncaptured authorizations are voided where supported.

**Technology Stack**

- **Framework**: Next.js App Router (v16) with TypeScript
- **Styling**: Tailwind CSS (dark navy, white, emerald green theme)
- **Auth / DB**: Firebase Authentication + Firestore (via `firebase` and `firebase-admin`)
- **AI**: Gemini API (`@google/genai`)
- **Validation**: Zod
- **Payments**: PayPal Orders API v2 (`@paypal/react-paypal-js` on front‑end, server‑side SDK for calls)
- **Testing**: Vitest (unit) & Playwright (e2e)
- **Deployment**: Vercel

**High‑Level Architecture** – see `docs/ARCHITECTURE.md`.

**Next Steps** – build the contract‑intelligence service, negotiation engine, and secure PayPal integration while keeping secrets server‑side only.
