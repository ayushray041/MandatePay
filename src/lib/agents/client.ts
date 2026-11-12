'use client';

import { z } from 'zod';
import { ApiClientError, authenticatedApiRequest } from '@/lib/api/client';
import {
  agentProfileSchema,
  agentDiscoveryProfileSchema,
  type AgentDiscoveryProfile,
  type AgentProfile,
  type AgentProfileCreateInput,
} from '@/models/agent';
import {
  agentActivitySchema,
  agentApiKeyRecordSchema,
  agentSecuritySettingsSchema,
  agentSessionSchema,
  agentStatusSchema,
  agentWebhookSchema,
  issuedAgentApiKeySchema,
  type AgentApiKeyCreateInput,
  type AgentSecuritySettings,
  type AgentWebhookCreateInput,
} from '@/models/agent-iam';

export async function getMyAgentProfile(): Promise<AgentProfile | null> {
  try {
    return await authenticatedApiRequest(
      '/api/agents/me',
      agentProfileSchema,
      {},
      'Agent profile request failed.',
    );
  } catch (error: unknown) {
    if (error instanceof ApiClientError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

export async function registerAgentProfile(
  input: AgentProfileCreateInput,
): Promise<AgentProfile> {
  return authenticatedApiRequest(
    '/api/agents/me',
    agentProfileSchema,
    { method: 'POST', body: JSON.stringify(input) },
    'Agent profile request failed.',
  );
}

export async function updateAgentProfile(
  input: Partial<AgentProfileCreateInput>,
): Promise<AgentProfile> {
  return authenticatedApiRequest(
    '/api/agents/me',
    agentProfileSchema,
    { method: 'PATCH', body: JSON.stringify(input) },
    'Agent profile request failed.',
  );
}

export async function discoverAgents(category?: string): Promise<AgentDiscoveryProfile[]> {
  const query = category ? `?category=${encodeURIComponent(category)}` : '';
  return authenticatedApiRequest(
    `/api/agents${query}`,
    z.array(agentDiscoveryProfileSchema),
    {},
    'Agent discovery request failed.',
  );
}

export async function listAgentApiKeys() {
  return authenticatedApiRequest(
    '/api/agents/me/keys',
    z.array(agentApiKeyRecordSchema),
    {},
    'Agent credentials could not be loaded.',
  );
}

export async function createAgentApiKey(input: AgentApiKeyCreateInput) {
  return authenticatedApiRequest(
    '/api/agents/me/keys',
    issuedAgentApiKeySchema,
    { method: 'POST', body: JSON.stringify(input) },
    'Agent credential could not be created.',
  );
}

export async function rotateAgentApiKey(keyId: string) {
  return authenticatedApiRequest(
    `/api/agents/me/keys/${encodeURIComponent(keyId)}/rotate`,
    issuedAgentApiKeySchema,
    { method: 'POST' },
    'Agent credential could not be rotated.',
  );
}

export async function revokeAgentApiKey(keyId: string) {
  return authenticatedApiRequest(
    `/api/agents/me/keys/${encodeURIComponent(keyId)}`,
    z.object({ keyId: z.string(), status: z.literal('revoked') }),
    { method: 'DELETE' },
    'Agent credential could not be revoked.',
  );
}

export async function updateAgentStatus(status: z.infer<typeof agentStatusSchema>) {
  return authenticatedApiRequest(
    '/api/agents/me/status',
    z.object({ status: agentStatusSchema }),
    { method: 'PATCH', body: JSON.stringify({ status }) },
    'Agent status could not be updated.',
  );
}

export async function updateAgentSecuritySettings(input: AgentSecuritySettings) {
  return authenticatedApiRequest(
    '/api/agents/me/security',
    agentSecuritySettingsSchema,
    { method: 'PATCH', body: JSON.stringify(input) },
    'Agent security settings could not be updated.',
  );
}

export async function listAgentActivity() {
  return authenticatedApiRequest(
    '/api/agents/me/activity',
    z.array(agentActivitySchema),
    {},
    'Agent activity could not be loaded.',
  );
}

export async function listAgentSessions() {
  return authenticatedApiRequest(
    '/api/agents/me/sessions',
    z.array(agentSessionSchema),
    {},
    'Agent sessions could not be loaded.',
  );
}

export async function revokeAgentSession(sessionId: string) {
  return authenticatedApiRequest(
    `/api/agents/me/sessions/${encodeURIComponent(sessionId)}`,
    z.object({ sessionId: z.string(), status: z.literal('revoked') }),
    { method: 'DELETE' },
    'Agent session could not be revoked.',
  );
}

export async function listAgentWebhooks() {
  return authenticatedApiRequest(
    '/api/agents/me/webhooks',
    z.array(agentWebhookSchema),
    {},
    'Agent webhooks could not be loaded.',
  );
}

export async function registerAgentWebhook(input: AgentWebhookCreateInput) {
  return authenticatedApiRequest(
    '/api/agents/me/webhooks',
    agentWebhookSchema,
    { method: 'POST', body: JSON.stringify(input) },
    'Agent webhook could not be registered.',
  );
}

export async function revokeAgentWebhook(webhookId: string) {
  return authenticatedApiRequest(
    `/api/agents/me/webhooks/${encodeURIComponent(webhookId)}`,
    z.object({ webhookId: z.string(), status: z.literal('revoked') }),
    { method: 'DELETE' },
    'Agent webhook could not be revoked.',
  );
}
