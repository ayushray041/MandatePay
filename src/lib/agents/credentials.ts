import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export type GeneratedAgentApiKey = {
  keyId: string;
  token: string;
  tokenHash: string;
  prefix: string;
};

export type ParsedAgentApiKey = {
  keyId: string;
  tokenHash: string;
};

export function getAgentApiKeyPepper(): string | null {
  const pepper = process.env.AGENT_API_KEY_PEPPER;
  return pepper && Buffer.byteLength(pepper, 'utf8') >= 32 ? pepper : null;
}

export function generateAgentId(): string {
  return `agt_${randomBytes(24).toString('base64url')}`;
}

export function generateAgentApiKey(): GeneratedAgentApiKey | null {
  const pepper = getAgentApiKeyPepper();
  if (!pepper) {
    return null;
  }
  const keyId = randomBytes(12).toString('base64url');
  const token = `mpa_live_${keyId}_${randomBytes(32).toString('base64url')}`;
  return {
    keyId,
    token,
    tokenHash: hashAgentApiKey(token, pepper),
    prefix: `${token.slice(0, 14)}…`,
  };
}

export function parseAgentApiKey(token: string): ParsedAgentApiKey | null {
  const match = /^mpa_live_([A-Za-z0-9_-]{16})_([A-Za-z0-9_-]{43})$/.exec(token);
  const pepper = getAgentApiKeyPepper();
  if (!match || !pepper) {
    return null;
  }
  return {
    keyId: match[1],
    tokenHash: hashAgentApiKey(token, pepper),
  };
}

export function agentApiKeyHashMatches(candidateHash: string, storedHash: unknown): boolean {
  if (
    typeof storedHash !== 'string'
    || !/^[a-f0-9]{64}$/.test(candidateHash)
    || !/^[a-f0-9]{64}$/.test(storedHash)
  ) {
    return false;
  }
  return timingSafeEqual(Buffer.from(candidateHash, 'hex'), Buffer.from(storedHash, 'hex'));
}

function hashAgentApiKey(token: string, pepper: string): string {
  return createHmac('sha256', pepper).update(token, 'utf8').digest('hex');
}
