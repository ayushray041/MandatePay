import 'server-only';
import { adminFirestore } from '@/lib/firebase/admin';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { AiRequestError } from '@/lib/ai/errors';
import {
  aiDecisionHistoryEntrySchema,
  type AiDecisionHistoryEntry,
} from '@/models/ai';
import type { AiProvider } from '@/lib/ai/provider';

type AiHistoryInput = Omit<AiDecisionHistoryEntry, 'id' | 'createdAt'> & {
  userId: string;
  provider?: AiProvider | null;
};

export async function recordAiDecision(input: AiHistoryInput): Promise<void> {
  if (!adminFirestore) {
    throw new AiRequestError(503, 'AI_HISTORY_UNAVAILABLE', 'AI history storage is unavailable.');
  }
  const { provider, userId, ...entry } = input;
  const metadata = provider?.metadata;
  const record = aiDecisionHistoryEntrySchema.parse({
    ...entry,
    id: 'pending',
    providerId: metadata?.providerId ?? entry.providerId,
    modelVersion: metadata?.modelVersion ?? entry.modelVersion,
    createdAt: null,
  });
  try {
    const reference = adminFirestore.collection('aiDecisionHistory').doc();
    await reference.set({
      ...record,
      id: reference.id,
      createdAt: getServerTimestamp(),
      actorUserId: userId,
    });
  } catch (error: unknown) {
    console.error('Failed to persist AI recommendation history.', error);
    throw new AiRequestError(503, 'AI_HISTORY_UNAVAILABLE', 'AI recommendation history could not be saved.');
  }
}
