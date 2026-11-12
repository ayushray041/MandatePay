import { z } from 'zod';

export const workflowTaskTypes = [
  'research',
  'discovery',
  'negotiation',
  'contract',
  'payment',
  'custom',
] as const;
export const workflowTaskTypeSchema = z.enum(workflowTaskTypes);

export const workflowStatuses = [
  'active',
  'paused',
  'awaiting_human',
  'completed',
  'failed',
  'cancelled',
] as const;
export const workflowStatusSchema = z.enum(workflowStatuses);

export const workflowTaskStatuses = [
  'blocked',
  'ready',
  'in_progress',
  'awaiting_human',
  'handed_off',
  'completed',
  'failed',
  'cancelled',
  'timed_out',
] as const;
export const workflowTaskStatusSchema = z.enum(workflowTaskStatuses);

export const workflowApiScopes = [
  'workflows:read',
  'workflows:execute',
  'workflows:delegate',
] as const;
export const workflowApiScopeSchema = z.enum(workflowApiScopes);
export const workflowDelegatedScopesSchema = z.array(workflowApiScopeSchema)
  .max(workflowApiScopes.length)
  .refine((scopes) => new Set(scopes).size === scopes.length, {
    message: 'Workflow permissions must be unique.',
  });

const agentIdSchema = z.string().regex(/^agt_[A-Za-z0-9_-]{32}$/);

export const workflowTaskInputSchema = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]{1,48}$/),
  type: workflowTaskTypeSchema,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  assignedAgentId: agentIdSchema,
  dependsOn: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,48}$/)).max(25).default([]),
  parentTaskKey: z.string().regex(/^[A-Za-z0-9_-]{1,48}$/).optional(),
  timeoutSeconds: z.number().int().min(30).max(86_400).default(3600),
  maxAttempts: z.number().int().min(1).max(3).default(2),
}).strict();

export const workflowCreateSchema = z.object({
  mandateId: z.string().min(1).max(128),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(1000),
  tasks: z.array(workflowTaskInputSchema).min(1).max(25),
}).strict().superRefine((workflow, context) => {
  const taskByKey = new Map(workflow.tasks.map((task) => [task.key, task]));
  if (taskByKey.size !== workflow.tasks.length) {
    context.addIssue({
      code: 'custom',
      path: ['tasks'],
      message: 'Task keys must be unique.',
    });
  }

  workflow.tasks.forEach((task, index) => {
    if (new Set(task.dependsOn).size !== task.dependsOn.length) {
      context.addIssue({
        code: 'custom',
        path: ['tasks', index, 'dependsOn'],
        message: 'Task dependencies must be unique.',
      });
    }
    if (task.dependsOn.includes(task.key) || task.parentTaskKey === task.key) {
      context.addIssue({
        code: 'custom',
        path: ['tasks', index],
        message: 'A task cannot depend on or delegate to itself.',
      });
    }
    for (const reference of [...task.dependsOn, ...(task.parentTaskKey ? [task.parentTaskKey] : [])]) {
      if (!taskByKey.has(reference)) {
        context.addIssue({
          code: 'custom',
          path: ['tasks', index],
          message: `Task reference "${reference}" does not exist in this workflow.`,
        });
      }
    }
  });

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (key: string): void => {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      context.addIssue({
        code: 'custom',
        path: ['tasks'],
        message: 'Task dependencies and delegation ancestry must not contain cycles.',
      });
      return;
    }
    visiting.add(key);
    const task = taskByKey.get(key);
    if (task) {
      for (const reference of [...task.dependsOn, ...(task.parentTaskKey ? [task.parentTaskKey] : [])]) {
        visit(reference);
      }
    }
    visiting.delete(key);
    visited.add(key);
  };
  for (const task of workflow.tasks) visit(task.key);
});

export const workflowTaskClaimSchema = z.object({
  expectedVersion: z.number().int().positive(),
}).strict();

export const workflowTaskUpdateSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('complete'),
    expectedVersion: z.number().int().positive(),
    summary: z.string().trim().min(1).max(1000),
  }).strict(),
  z.object({
    action: z.literal('fail'),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    action: z.literal('request_human'),
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(500),
  }).strict(),
]);

export const workflowTaskHandoffSchema = z.object({
  expectedVersion: z.number().int().positive(),
  delegatedAgentId: agentIdSchema,
  reason: z.string().trim().min(1).max(500),
}).strict();

export const workflowActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.enum(['pause', 'resume', 'cancel']) }).strict(),
]);

export const workflowTaskDecisionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('resume'),
    reason: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    action: z.literal('cancel'),
    reason: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    action: z.literal('retry'),
    reason: z.string().trim().min(1).max(500),
  }).strict(),
]);

export const workflowTaskRecordSchema = z.object({
  id: z.string().min(1),
  workflowId: z.string().min(1),
  key: z.string(),
  type: workflowTaskTypeSchema,
  title: z.string(),
  description: z.string(),
  assignedAgentId: agentIdSchema,
  originatingAgentId: agentIdSchema,
  delegatedFromAgentId: agentIdSchema.nullable(),
  delegationAgentPath: z.array(agentIdSchema).min(1).max(4),
  parentTaskId: z.string().nullable(),
  dependencyTaskIds: z.array(z.string()),
  delegationDepth: z.number().int().min(0).max(3),
  delegatedScopes: workflowDelegatedScopesSchema,
  status: workflowTaskStatusSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().min(1).max(3),
  ownerRetries: z.number().int().min(0).max(3),
  timeoutSeconds: z.number().int().min(30).max(86_400),
  version: z.number().int().positive(),
  leaseExpiresAt: z.string().nullable(),
  resultSummary: z.string().nullable(),
  lastFailureReason: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
}).strict();

export const workflowRecordSchema = z.object({
  id: z.string().min(1),
  ownerId: z.string().min(1),
  mandateId: z.string().min(1),
  mandateVersion: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  originatingAgentId: agentIdSchema,
  status: workflowStatusSchema,
  version: z.number().int().positive(),
  taskCount: z.number().int().positive().max(50),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
}).strict();

export type WorkflowCreateInput = z.infer<typeof workflowCreateSchema>;
export type WorkflowTaskInput = z.infer<typeof workflowTaskInputSchema>;
export type WorkflowRecord = z.infer<typeof workflowRecordSchema>;
export type WorkflowTaskRecord = z.infer<typeof workflowTaskRecordSchema>;
export type WorkflowTaskUpdateInput = z.infer<typeof workflowTaskUpdateSchema>;
export type WorkflowTaskType = z.infer<typeof workflowTaskTypeSchema>;
export type WorkflowTaskStatus = z.infer<typeof workflowTaskStatusSchema>;
export type WorkflowApiScope = z.infer<typeof workflowApiScopeSchema>;
