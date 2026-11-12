import 'server-only';
import { createHash } from 'node:crypto';
import { adminFirestore } from '@/lib/firebase/admin';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { AiRequestError } from '@/lib/ai/errors';

const defaultDailyRequestLimit = 100;

function dailyRequestLimit(): number {
  const configured = process.env.AI_DAILY_REQUEST_LIMIT;
  if (!configured) {
    return defaultDailyRequestLimit;
  }
  const limit = Number(configured);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100_000) {
    throw new AiRequestError(503, 'AI_LIMIT_MISCONFIGURED', 'AI request limits are misconfigured.');
  }
  return limit;
}

export async function consumeAiRequestQuota(userId: string, now = new Date()): Promise<void> {
  if (!adminFirestore) {
    throw new AiRequestError(503, 'SERVICE_UNAVAILABLE', 'AI usage storage is unavailable.');
  }
  const day = now.toISOString().slice(0, 10);
  const userHash = createHash('sha256').update(userId).digest('hex');
  const usageRef = adminFirestore.collection('aiUsage').doc(userHash);
  const limit = dailyRequestLimit();

  await adminFirestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(usageRef);
    const stored = snapshot.data();
    const currentCount = snapshot.exists && stored?.day === day
      ? Number(stored.requestCount)
      : 0;
    if (!Number.isSafeInteger(currentCount) || currentCount < 0) {
      throw new AiRequestError(503, 'AI_USAGE_INVALID', 'AI usage data is invalid.');
    }
    if (currentCount >= limit) {
      throw new AiRequestError(429, 'AI_DAILY_LIMIT_REACHED', 'The daily AI request limit has been reached.');
    }
    transaction.set(usageRef, {
      userHash,
      day,
      requestCount: currentCount + 1,
      updatedAt: getServerTimestamp(),
    });
  });
}
