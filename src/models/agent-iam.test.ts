import { describe, expect, it } from 'vitest';
import {
  agentApiKeyCreateSchema,
  agentSecuritySettingsSchema,
  agentWebhookCreateSchema,
} from '@/models/agent-iam';

describe('agent IAM schemas', () => {
  it('rejects duplicate or unknown credential scopes', () => {
    const key = {
      name: 'Deployment',
      scopes: ['mandates:read', 'mandates:read'],
      expiresAt: '2027-01-01T00:00:00.000Z',
    };
    expect(agentApiKeyCreateSchema.safeParse(key).success).toBe(false);
    expect(agentApiKeyCreateSchema.safeParse({
      ...key,
      scopes: ['payments:send'],
    }).success).toBe(false);
  });

  it('bounds owner-configured request limits', () => {
    expect(agentSecuritySettingsSchema.safeParse({ rateLimitPerMinute: 600 }).success).toBe(true);
    expect(agentSecuritySettingsSchema.safeParse({ rateLimitPerMinute: 601 }).success).toBe(false);
    expect(agentSecuritySettingsSchema.safeParse({ dailyQuota: 0 }).success).toBe(false);
  });

  it('requires HTTPS webhooks without embedded credentials or query values', () => {
    const accepted = { url: 'https://hooks.example.com/mandatepay', events: ['agent.status.changed'] };
    expect(agentWebhookCreateSchema.safeParse(accepted).success).toBe(true);
    expect(agentWebhookCreateSchema.safeParse({
      ...accepted,
      url: 'http://hooks.example.com/events',
    }).success).toBe(false);
    expect(agentWebhookCreateSchema.safeParse({
      ...accepted,
      url: 'https://user:secret@hooks.example.com/events',
    }).success).toBe(false);
    expect(agentWebhookCreateSchema.safeParse({
      ...accepted,
      url: 'https://hooks.example.com/events?token=secret',
    }).success).toBe(false);
  });
});
