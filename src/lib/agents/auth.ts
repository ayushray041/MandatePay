import 'server-only';
import { adminFirestore } from '@/lib/firebase/admin';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { apiError } from '@/lib/api/responses';
import { timestampToIso } from '@/lib/mandates/format';
import { agentApiKeyHashMatches, getAgentApiKeyPepper, parseAgentApiKey } from '@/lib/agents/credentials';
import { agentApiScopesSchema, type AgentApiScope } from '@/models/agent-iam';

const sessionCollection = 'agentSessions';
const usageCollection = 'agentUsage';
const activityCollection = 'agentActivity';

export type AgentPrincipal = {
  uid: string;
  ownerId: string;
  agentId: string;
  keyId: string;
  sessionId: string;
  scopes: AgentApiScope[];
};

export type AgentAuthenticationResult =
  | { authenticated: true; agent: AgentPrincipal }
  | { authenticated: false; response: Response };

type AuthDecision =
  | { kind: 'allowed'; agent: AgentPrincipal }
  | { kind: 'invalid' }
  | { kind: 'forbidden' }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'quota_exceeded'; retryAfterSeconds: number };

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function apiKeyUnauthorized(): AgentAuthenticationResult {
  return {
    authenticated: false,
    response: apiError(401, 'INVALID_AGENT_CREDENTIAL', 'Agent credentials are invalid or inactive.'),
  };
}

function rateLimited(decision: Extract<AuthDecision, { kind: 'rate_limited' | 'quota_exceeded' }>) {
  const response = apiError(
    429,
    decision.kind === 'rate_limited' ? 'AGENT_RATE_LIMITED' : 'AGENT_QUOTA_EXCEEDED',
    decision.kind === 'rate_limited'
      ? 'Agent request rate limit exceeded.'
      : 'Agent daily usage quota exceeded.',
  );
  response.headers.set('Retry-After', String(decision.retryAfterSeconds));
  return { authenticated: false as const, response };
}

export async function authenticateAgentRequest(
  request: Request,
  requiredScope: AgentApiScope,
): Promise<AgentAuthenticationResult> {
  if (!getAgentApiKeyPepper()) {
    return {
      authenticated: false,
      response: apiError(503, 'SERVICE_UNAVAILABLE', 'Agent credential authentication is not configured.'),
    };
  }
  const authorization = request.headers.get('authorization');
  const bearerMatch = authorization ? /^Bearer\s+(\S+)$/i.exec(authorization.trim()) : null;
  const parsed = bearerMatch ? parseAgentApiKey(bearerMatch[1]) : null;
  if (!parsed) {
    return apiKeyUnauthorized();
  }
  if (!adminFirestore) {
    return {
      authenticated: false,
      response: apiError(503, 'SERVICE_UNAVAILABLE', 'Agent credential storage is unavailable.'),
    };
  }

  const firestore = adminFirestore;
  const keyRef = firestore.collection('agentApiKeys').doc(parsed.keyId);
  const sessionRef = firestore.collection(sessionCollection).doc(parsed.keyId);
  const activityRef = firestore.collection(activityCollection).doc();
  const now = new Date();
  const minuteWindow = Math.floor(now.getTime() / 60_000);
  const dayWindow = now.toISOString().slice(0, 10);
  const requestedPath = new URL(request.url).pathname.slice(0, 200);
  const method = request.method.toUpperCase();
  const runtimeVersion = request.headers.get('x-agent-version');
  const safeRuntimeVersion = runtimeVersion && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/.test(runtimeVersion)
    ? runtimeVersion
    : undefined;

  try {
    const decision = await firestore.runTransaction<AuthDecision>(async (transaction) => {
      const keySnapshot = await transaction.get(keyRef);
      if (!keySnapshot.exists) {
        return { kind: 'invalid' };
      }
      const key = keySnapshot.data();
      if (
        !key
        || !agentApiKeyHashMatches(parsed.tokenHash, key.tokenHash)
        || key.keyId !== parsed.keyId
        || typeof key.ownerId !== 'string'
        || typeof key.agentId !== 'string'
        || key.status !== 'active'
      ) {
        return { kind: 'invalid' };
      }

      const agentRef = firestore.collection('agents').doc(key.ownerId);
      const usageRef = firestore.collection(usageCollection).doc(key.agentId);
      const [agentSnapshot, usageSnapshot, sessionSnapshot] = await Promise.all([
        transaction.get(agentRef),
        transaction.get(usageRef),
        transaction.get(sessionRef),
      ]);
      if (!agentSnapshot.exists) {
        return { kind: 'invalid' };
      }
      const agent = agentSnapshot.data();
      const usage = usageSnapshot.data() ?? {};
      const session = sessionSnapshot.data();
      const keyExpiry = timestampToIso(key.expiresAt);
      if (
        !agent
        || agent.ownerId !== key.ownerId
        || agent.agentId !== key.agentId
        || agent.status !== 'active'
        || !keyExpiry
        || Date.parse(keyExpiry) <= now.getTime()
        || (
          sessionSnapshot.exists
          && (
            session?.status !== 'active'
            || session.ownerId !== key.ownerId
            || session.agentId !== key.agentId
            || session.keyId !== parsed.keyId
            || timestampToIso(session.expiresAt) !== keyExpiry
          )
        )
      ) {
        return { kind: 'invalid' };
      }

      const parsedScopes = agentApiScopesSchema.safeParse(key.scopes);
      if (!parsedScopes.success) {
        return { kind: 'invalid' };
      }
      const scopes = parsedScopes.data;
      if (!scopes.includes(requiredScope)) {
        if (usage.lastScopeDenyMinute !== minuteWindow) {
          const deniedAt = getServerTimestamp();
          transaction.set(usageRef, {
            lastScopeDenyMinute: minuteWindow,
            updatedAt: deniedAt,
          }, { merge: true });
          transaction.create(activityRef, {
            ownerId: key.ownerId,
            agentId: key.agentId,
            keyId: parsed.keyId,
            action: 'agent.api_request',
            outcome: 'denied',
            scope: requiredScope,
            method,
            path: requestedPath,
            createdAt: deniedAt,
          });
        }
        return { kind: 'forbidden' };
      }

      const rateLimit = agent.rateLimitPerMinute;
      const dailyQuota = agent.dailyQuota;
      if (
        !isNonnegativeInteger(rateLimit)
        || rateLimit < 1
        || rateLimit > 600
        || !isNonnegativeInteger(dailyQuota)
        || dailyQuota < 1
        || dailyQuota > 100_000
      ) {
        throw new Error('Stored agent rate limits are invalid.');
      }

      const minuteCount = usage.minuteWindow === minuteWindow
        ? usage.minuteCount
        : 0;
      const dailyCount = usage.dayWindow === dayWindow
        ? usage.dailyCount
        : 0;
      if (!isNonnegativeInteger(minuteCount) || !isNonnegativeInteger(dailyCount)) {
        throw new Error('Stored agent usage counters are invalid.');
      }
      if (minuteCount >= rateLimit) {
        if (usage.lastRateLimitEventMinute !== minuteWindow) {
          const deniedAt = getServerTimestamp();
          transaction.set(usageRef, {
            lastRateLimitEventMinute: minuteWindow,
            updatedAt: deniedAt,
          }, { merge: true });
          transaction.create(activityRef, {
            ownerId: key.ownerId,
            agentId: key.agentId,
            keyId: parsed.keyId,
            action: 'agent.rate_limit.exceeded',
            outcome: 'denied',
            scope: requiredScope,
            method,
            path: requestedPath,
            createdAt: deniedAt,
          });
        }
        return {
          kind: 'rate_limited',
          retryAfterSeconds: Math.max(1, Math.ceil(((minuteWindow + 1) * 60_000 - now.getTime()) / 1000)),
        };
      }
      if (dailyCount >= dailyQuota) {
        if (usage.lastQuotaEventDay !== dayWindow) {
          const deniedAt = getServerTimestamp();
          transaction.set(usageRef, {
            lastQuotaEventDay: dayWindow,
            updatedAt: deniedAt,
          }, { merge: true });
          transaction.create(activityRef, {
            ownerId: key.ownerId,
            agentId: key.agentId,
            keyId: parsed.keyId,
            action: 'agent.daily_quota.exceeded',
            outcome: 'denied',
            scope: requiredScope,
            method,
            path: requestedPath,
            createdAt: deniedAt,
          });
        }
        const nextDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
        return {
          kind: 'quota_exceeded',
          retryAfterSeconds: Math.max(1, Math.ceil((nextDay - now.getTime()) / 1000)),
        };
      }

      const nowTimestamp = getServerTimestamp();
      const principal = {
        uid: key.ownerId,
        ownerId: key.ownerId,
        agentId: key.agentId,
        keyId: parsed.keyId,
        sessionId: parsed.keyId,
        scopes,
      };
      transaction.update(keyRef, { lastUsedAt: nowTimestamp });
      transaction.update(agentRef, {
        healthStatus: 'healthy',
        lastSeenAt: nowTimestamp,
        ...(safeRuntimeVersion ? { runtimeVersion: safeRuntimeVersion } : {}),
        updatedAt: nowTimestamp,
      });
      transaction.set(usageRef, {
        minuteWindow,
        minuteCount: minuteCount + 1,
        dayWindow,
        dailyCount: dailyCount + 1,
        updatedAt: nowTimestamp,
      }, { merge: true });
      transaction.set(sessionRef, {
        ownerId: key.ownerId,
        agentId: key.agentId,
        keyId: parsed.keyId,
        status: 'active',
        createdAt: session?.createdAt ?? nowTimestamp,
        lastSeenAt: nowTimestamp,
        expiresAt: key.expiresAt,
      }, { merge: true });
      transaction.create(activityRef, {
        ownerId: key.ownerId,
        agentId: key.agentId,
        keyId: parsed.keyId,
        action: 'agent.api_request',
        outcome: 'allowed',
        scope: requiredScope,
        method,
        path: requestedPath,
        ...(safeRuntimeVersion ? { runtimeVersion: safeRuntimeVersion } : {}),
        createdAt: nowTimestamp,
      });
      return { kind: 'allowed', agent: principal };
    });

    if (decision.kind === 'allowed') {
      return { authenticated: true, agent: decision.agent };
    }
    if (decision.kind === 'forbidden') {
      return {
        authenticated: false,
        response: apiError(403, 'INSUFFICIENT_AGENT_SCOPE', 'Agent credential does not grant this permission.'),
      };
    }
    if (decision.kind === 'rate_limited' || decision.kind === 'quota_exceeded') {
      return rateLimited(decision);
    }
    return apiKeyUnauthorized();
  } catch (error: unknown) {
    console.error('Agent API authentication failed.', error);
    return {
      authenticated: false,
      response: apiError(503, 'SERVICE_UNAVAILABLE', 'Agent authentication could not be completed.'),
    };
  }
}
