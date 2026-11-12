'use client';

import { z } from 'zod';
import { authenticatedApiRequest } from '@/lib/api/client';
import {
  workflowCreateSchema,
  workflowRecordSchema,
  workflowTaskRecordSchema,
  type WorkflowCreateInput,
} from '@/models/workflow';

const workflowEventSchema = z.object({
  id: z.string(),
  sequence: z.number().int(),
  action: z.string(),
  actorType: z.enum(['owner', 'agent', 'system']),
  actorId: z.string(),
  taskId: z.string().nullable(),
  reason: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  createdAt: z.string().nullable(),
}).strict();

export const workflowDetailsSchema = z.object({
  workflow: workflowRecordSchema,
  tasks: z.array(workflowTaskRecordSchema),
  events: z.array(workflowEventSchema),
}).strict();

export const workflowAgentOptionSchema = z.object({
  agentId: z.string().regex(/^agt_[A-Za-z0-9_-]{32}$/),
  displayName: z.string(),
  role: z.enum(['authorized', 'delegated']),
}).strict();

export type WorkflowDetails = z.infer<typeof workflowDetailsSchema>;
export type WorkflowAgentOption = z.infer<typeof workflowAgentOptionSchema>;

export function listWorkflows() {
  return authenticatedApiRequest(
    '/api/workflows',
    z.array(workflowRecordSchema),
    {},
    'Workflows could not be loaded.',
  );
}

export function getWorkflow(workflowId: string) {
  return authenticatedApiRequest(
    `/api/workflows/${encodeURIComponent(workflowId)}`,
    workflowDetailsSchema,
    {},
    'Workflow details could not be loaded.',
  );
}

export function getWorkflowAgents(mandateId: string) {
  return authenticatedApiRequest(
    `/api/workflows/agents?mandateId=${encodeURIComponent(mandateId)}`,
    z.array(workflowAgentOptionSchema),
    {},
    'Mandate agents could not be loaded.',
  );
}

export function createWorkflow(input: WorkflowCreateInput) {
  const parsed = workflowCreateSchema.parse(input);
  return authenticatedApiRequest(
    '/api/workflows',
    z.object({ id: z.string().min(1) }),
    {
      method: 'POST',
      body: JSON.stringify(parsed),
    },
    'Workflow could not be created.',
  );
}

export function performWorkflowAction(workflowId: string, action: 'pause' | 'resume' | 'cancel') {
  return authenticatedApiRequest(
    `/api/workflows/${encodeURIComponent(workflowId)}/actions`,
    workflowRecordSchema,
    { method: 'POST', body: JSON.stringify({ action }) },
    'Workflow could not be updated.',
  );
}

export function decideWorkflowTask(
  workflowId: string,
  taskId: string,
  action: 'resume' | 'cancel' | 'retry',
  reason: string,
) {
  return authenticatedApiRequest(
    `/api/workflows/${encodeURIComponent(workflowId)}/tasks/${encodeURIComponent(taskId)}/decision`,
    workflowTaskRecordSchema,
    {
      method: 'POST',
      body: JSON.stringify({ action, reason }),
    },
    'Workflow task could not be updated.',
  );
}
