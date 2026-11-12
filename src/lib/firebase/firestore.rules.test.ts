import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';

const emulatorAddress = process.env.FIRESTORE_EMULATOR_HOST;
const [emulatorHost, emulatorPort] = emulatorAddress?.split(':') ?? [];

describe.skipIf(!emulatorAddress)('Firestore security rules', () => {
  let environment: RulesTestEnvironment;

  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: 'demo-mandatepay',
      firestore: {
        host: emulatorHost,
        port: Number(emulatorPort),
        rules: await readFile(new URL('../../../firestore.rules', import.meta.url), 'utf8'),
      },
    });
  });

  afterEach(async () => {
    await environment.clearFirestore();
  });

  afterAll(async () => {
    await environment.cleanup();
  });

  it('allows profile reads only to the matching authenticated UID and denies profile writes', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/alice'), {
        uid: 'alice',
        email: 'alice@example.com',
        displayName: 'Alice',
        role: 'client',
      });
    });

    const aliceDb = environment.authenticatedContext('alice').firestore();
    const bobDb = environment.authenticatedContext('bob').firestore();

    await assertSucceeds(getDoc(doc(aliceDb, 'users/alice')));
    await assertFails(getDoc(doc(bobDb, 'users/alice')));
    await assertFails(
      setDoc(doc(aliceDb, 'users/alice'), {
        uid: 'alice',
        email: 'alice@example.com',
        displayName: 'Alice',
        role: 'admin',
      }),
    );
  });

  it('denies direct contract and payment access to all clients', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'contracts/contract-1'), {
        participantIds: ['alice', 'bob'],
        status: 'pending_review',
        currentVersion: 1,
      });
      await setDoc(doc(db, 'contracts/contract-1/versions/v1'), {
        contractId: 'contract-1',
        version: 1,
        terms: {},
      });
      await setDoc(doc(db, 'contracts/contract-1/amendments/amendment-1'), {
        contractId: 'contract-1',
        status: 'pending_review',
      });
      await setDoc(doc(db, 'contracts/contract-1/events/event-1'), {
        sequence: 1,
        type: 'contract.generated',
      });
      await setDoc(doc(db, 'payments/payment-1'), {
        participantIds: ['alice', 'bob'],
        status: 'pending',
      });
      await setDoc(doc(db, 'payments/payment-1/events/event-1'), {
        sequence: 1,
        type: 'payment.created',
      });
      await setDoc(doc(db, 'paypalWebhookEvents/event-1'), {
        providerEventId: 'event-1',
        outcome: 'processed',
      });
    });

    const aliceDb = environment.authenticatedContext('alice').firestore();
    const bobDb = environment.authenticatedContext('bob').firestore();
    await assertFails(getDoc(doc(bobDb, 'contracts/contract-1')));
    await assertFails(getDoc(doc(aliceDb, 'contracts/contract-1')));
    await assertFails(
      getDoc(doc(aliceDb, 'contracts/contract-1/versions/v1')),
    );
    await assertFails(getDoc(doc(aliceDb, 'contracts/contract-1/amendments/amendment-1')));
    await assertFails(getDoc(doc(aliceDb, 'contracts/contract-1/events/event-1')));
    await assertFails(setDoc(doc(aliceDb, 'contracts/contract-2'), { participantIds: ['alice'] }));
    await assertFails(getDoc(doc(aliceDb, 'payments/payment-1')));
    await assertFails(getDoc(doc(aliceDb, 'payments/payment-1/events/event-1')));
    await assertFails(getDoc(doc(aliceDb, 'paypalWebhookEvents/event-1')));
    await assertFails(setDoc(doc(aliceDb, 'paypalWebhookEvents/client-event'), { outcome: 'processed' }));
  });

  it('denies direct client access to agent and negotiation records and history', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'agents/alice'), { uid: 'alice', displayName: 'Alice' });
      await setDoc(doc(db, 'agentIdentities/agt_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), {
        agentId: 'agt_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        ownerId: 'alice',
        agentUid: 'alice',
      });
      await setDoc(doc(db, 'negotiations/negotiation-1'), {
        initiatorAgentId: 'alice',
        recipientAgentId: 'bob',
      });
      await setDoc(doc(db, 'negotiations/negotiation-1/offers/offer-1'), {
        sequence: 1,
        submittedByAgentId: 'alice',
      });
      await setDoc(doc(db, 'negotiations/negotiation-1/events/event-1'), {
        sequence: 1,
        actorAgentId: 'alice',
      });
      await setDoc(doc(db, 'aiDecisionHistory/history-1'), {
        actorUserId: 'alice',
        action: 'payment_anomaly',
      });
      await setDoc(doc(db, 'aiUsage/hashed-user'), {
        userHash: 'hashed-user',
        day: '2026-11-12',
        requestCount: 1,
      });

    });

    const aliceDb = environment.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(aliceDb, 'agents/alice')));
    await assertFails(getDoc(doc(aliceDb, 'agentIdentities/agt_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')));
    await assertFails(getDoc(doc(aliceDb, 'negotiations/negotiation-1')));
    await assertFails(getDoc(doc(aliceDb, 'negotiations/negotiation-1/offers/offer-1')));
    await assertFails(getDoc(doc(aliceDb, 'negotiations/negotiation-1/events/event-1')));
    await assertFails(getDoc(doc(aliceDb, 'aiDecisionHistory/history-1')));
    await assertFails(getDoc(doc(aliceDb, 'aiUsage/hashed-user')));
    await assertFails(
      setDoc(doc(aliceDb, 'negotiations/negotiation-2'), {
        initiatorAgentId: 'alice',
        recipientAgentId: 'bob',
      }),
    );
  });

  it('denies direct client access to agent credentials, sessions, usage, activity and webhooks', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'agentApiKeys/key-1'), { ownerId: 'alice', tokenHash: 'secret-hash' });
      await setDoc(doc(db, 'agentSessions/session-1'), { ownerId: 'alice', status: 'active' });
      await setDoc(doc(db, 'agentUsage/agent-1'), { dailyCount: 1 });
      await setDoc(doc(db, 'agentActivity/event-1'), { ownerId: 'alice', action: 'agent.api_key.created' });
      await setDoc(doc(db, 'agentWebhooks/webhook-1'), { ownerId: 'alice', url: 'https://example.com' });
    });

    const aliceDb = environment.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(aliceDb, 'agentApiKeys/key-1')));
    await assertFails(getDoc(doc(aliceDb, 'agentSessions/session-1')));
    await assertFails(getDoc(doc(aliceDb, 'agentUsage/agent-1')));
    await assertFails(getDoc(doc(aliceDb, 'agentActivity/event-1')));
    await assertFails(getDoc(doc(aliceDb, 'agentWebhooks/webhook-1')));
    await assertFails(setDoc(doc(aliceDb, 'agentApiKeys/forged'), { tokenHash: 'attacker' }));
  });
});
