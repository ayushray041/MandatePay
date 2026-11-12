import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
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

  it('enforces contract ownership and denies direct payment access', async () => {
    const aliceDb = environment.authenticatedContext('alice').firestore();
    const bobDb = environment.authenticatedContext('bob').firestore();

    await assertSucceeds(
      setDoc(doc(aliceDb, 'contracts/contract-1'), {
        ownerId: 'alice',
        title: 'Services agreement',
        status: 'uploaded',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(getDoc(doc(aliceDb, 'contracts/contract-1')));
    await assertFails(getDoc(doc(bobDb, 'contracts/contract-1')));
    await assertFails(
      setDoc(doc(bobDb, 'contracts/contract-2'), {
        ownerId: 'alice',
        title: 'Forged owner',
        status: 'uploaded',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(getDoc(doc(aliceDb, 'payments/payment-1')));
  });

  it('denies direct client access to agent and negotiation records and history', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, 'agents/alice'), { uid: 'alice', displayName: 'Alice' });
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
    });

    const aliceDb = environment.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(aliceDb, 'agents/alice')));
    await assertFails(getDoc(doc(aliceDb, 'negotiations/negotiation-1')));
    await assertFails(getDoc(doc(aliceDb, 'negotiations/negotiation-1/offers/offer-1')));
    await assertFails(getDoc(doc(aliceDb, 'negotiations/negotiation-1/events/event-1')));
    await assertFails(
      setDoc(doc(aliceDb, 'negotiations/negotiation-2'), {
        initiatorAgentId: 'alice',
        recipientAgentId: 'bob',
      }),
    );
  });
});
