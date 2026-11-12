import { z } from 'zod';

export const agentApiScopes = [
  'agent:profile:read',
  'mandates:read',
  'mandates:authorize',
] as const;

export const agentApiScopeSchema = z.enum(agentApiScopes);
export const agentApiScopesSchema = z.array(agentApiScopeSchema)
  .min(1)
  .max(agentApiScopes.length)
  .refine((scopes) => new Set(scopes).size === scopes.length, {
    message: 'Credential scopes must be unique.',
  });
export const agentStatusSchema = z.enum(['active', 'suspended']);

export const agentApiKeyCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: agentApiScopesSchema,
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export const agentApiKeyRecordSchema = z.object({
  keyId: z.string().regex(/^[A-Za-z0-9_-]{16}$/),
  agentId: z.string().regex(/^agt_[A-Za-z0-9_-]{32}$/),
  name: z.string().min(1).max(80),
  prefix: z.string().min(1).max(24),
  scopes: agentApiScopesSchema,
  status: z.enum(['active', 'revoked', 'expired']),
  createdAt: z.string().nullable(),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
});

export const issuedAgentApiKeySchema = z.object({
  key: agentApiKeyRecordSchema,
  secret: z.string().regex(/^mpa_live_[A-Za-z0-9_-]{16}_[A-Za-z0-9_-]{43}$/),
  warning: z.string(),
});

export const agentSessionSchema = z.object({
  sessionId: z.string(),
  keyId: z.string(),
  status: z.enum(['active', 'revoked']),
  createdAt: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
});

export const agentWebhookEvents = [
  'mandate.authorization.created',
  'agent.status.changed',
] as const;

export const agentActivitySchema = z.object({
  id: z.string(),
  action: z.string(),
  actorId: z.string().nullable(),
  outcome: z.string().nullable(),
  scope: z.string().nullable(),
  method: z.string().nullable(),
  path: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.string().nullable(),
});

export const agentWebhookSchema = z.object({
  id: z.string(),
  url: z.string().url(),
  events: z.array(z.enum(agentWebhookEvents)),
  status: z.enum(['active', 'revoked']),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const agentSecuritySettingsSchema = z.object({
  rateLimitPerMinute: z.number().int().min(1).max(600),
  dailyQuota: z.number().int().min(1).max(100_000),
}).strict().partial().refine((settings) => Object.keys(settings).length > 0, {
  message: 'At least one security setting must be provided.',
});

export const agentStatusUpdateSchema = z.object({
  status: agentStatusSchema,
}).strict();

export const agentWebhookCreateSchema = z.object({
  url: z.string().url().max(2048),
  events: z.array(z.enum(agentWebhookEvents)).min(1).max(agentWebhookEvents.length),
}).strict().superRefine((webhook, context) => {
  let url: URL;
  try {
    url = new URL(webhook.url);
  } catch {
    context.addIssue({
      code: 'custom',
      path: ['url'],
      message: 'Webhook URL is invalid.',
    });
    return;
  }
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
    || url.hostname === 'localhost'
    || !url.hostname.includes('.')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['url'],
      message: 'Webhook URLs must use HTTPS and cannot include credentials or query parameters.',
    });
  }
  if (new Set(webhook.events).size !== webhook.events.length) {
    context.addIssue({
      code: 'custom',
      path: ['events'],
      message: 'Webhook event subscriptions must be unique.',
    });
  }
});

export type AgentApiScope = z.infer<typeof agentApiScopeSchema>;
export type AgentApiKeyCreateInput = z.infer<typeof agentApiKeyCreateSchema>;
export type AgentApiKeyRecord = z.infer<typeof agentApiKeyRecordSchema>;
export type AgentActivity = z.infer<typeof agentActivitySchema>;
export type AgentSession = z.infer<typeof agentSessionSchema>;
export type AgentSecuritySettings = z.infer<typeof agentSecuritySettingsSchema>;
export type AgentWebhook = z.infer<typeof agentWebhookSchema>;
export type AgentWebhookCreateInput = z.infer<typeof agentWebhookCreateSchema>;
