'use client';

import { z } from 'zod';
import { ApiClientError, authenticatedApiRequest } from '@/lib/api/client';
import {
  agentProfileSchema,
  type AgentProfile,
  type AgentProfileCreateInput,
} from '@/models/agent';

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

export async function discoverAgents(category?: string): Promise<AgentProfile[]> {
  const query = category ? `?category=${encodeURIComponent(category)}` : '';
  return authenticatedApiRequest(
    `/api/agents${query}`,
    z.array(agentProfileSchema),
    {},
    'Agent discovery request failed.',
  );
}
