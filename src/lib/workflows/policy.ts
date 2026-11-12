import { timestampToIso } from '@/lib/mandates/format';
import { mandateExecutionConditionsSchema } from '@/models/mandate';
import type { WorkflowCreateInput } from '@/models/workflow';
import { apiError } from '@/lib/api/responses';

export class WorkflowError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export function assertWorkflowMandate(
  mandate: Record<string, unknown>,
  ownerId: string,
  expectedVersion: number,
  now = new Date(),
): void {
  if (mandate.ownerId !== ownerId) {
    throw new WorkflowError(404, 'WORKFLOW_NOT_FOUND', 'Workflow was not found.');
  }
  if (
    mandate.status !== 'active'
    || !Number.isSafeInteger(mandate.version)
    || mandate.version !== expectedVersion
  ) {
    throw new WorkflowError(
      409,
      'MANDATE_CHANGED',
      'The workflow mandate is inactive or has changed; create a new workflow after owner review.',
    );
  }
  const startsAt = timestampToIso(mandate.startsAt);
  const expiresAt = timestampToIso(mandate.expiresAt);
  if (
    !startsAt
    || Date.parse(startsAt) > now.getTime()
    || (expiresAt !== null && Date.parse(expiresAt) <= now.getTime())
  ) {
    throw new WorkflowError(409, 'MANDATE_UNAVAILABLE', 'The workflow mandate is not currently valid.');
  }
}

export function getMandateDelegationPolicy(mandate: Record<string, unknown>) {
  const parsed = mandateExecutionConditionsSchema.safeParse(mandate.executionConditions);
  if (!parsed.success) {
    throw new WorkflowError(409, 'INVALID_MANDATE_POLICY', 'The mandate delegation policy is invalid.');
  }
  return parsed.data;
}

export function validateWorkflowAssignments(
  workflow: WorkflowCreateInput,
  primaryAgentId: string,
  allowedDelegateAgentIds: string[],
  maximumDelegationDepth: number,
): Map<string, number> {
  const tasks = new Map(workflow.tasks.map((task) => [task.key, task]));
  const depths = new Map<string, number>();

  const depthOf = (key: string): number => {
    const cached = depths.get(key);
    if (cached !== undefined) return cached;
    const task = tasks.get(key);
    if (!task) {
      throw new WorkflowError(400, 'INVALID_TASK_GRAPH', 'A task reference is invalid.');
    }
    const depth = task.parentTaskKey ? depthOf(task.parentTaskKey) + 1 : 0;
    depths.set(key, depth);
    return depth;
  };

  for (const task of workflow.tasks) {
    const depth = depthOf(task.key);
    if (depth > maximumDelegationDepth) {
      throw new WorkflowError(
        422,
        'DELEGATION_DEPTH_EXCEEDED',
        'A task exceeds the mandate’s maximum delegation depth.',
      );
    }
    if (depth === 0) {
      if (task.assignedAgentId !== primaryAgentId) {
        throw new WorkflowError(
          422,
          'UNAUTHORIZED_TASK_AGENT',
          'Root tasks must be assigned to the mandate’s authorized agent.',
        );
      }
      continue;
    }
    if (
      task.assignedAgentId === primaryAgentId
      || !allowedDelegateAgentIds.includes(task.assignedAgentId)
    ) {
      throw new WorkflowError(
        422,
        'UNAUTHORIZED_TASK_AGENT',
        'Delegated tasks must be assigned to an agent allowlisted by the mandate owner.',
      );
    }
    let parentKey = task.parentTaskKey;
    while (parentKey) {
      const ancestor = tasks.get(parentKey);
      if (!ancestor) {
        throw new WorkflowError(400, 'INVALID_TASK_GRAPH', 'A task parent is invalid.');
      }
      if (ancestor.assignedAgentId === task.assignedAgentId) {
        throw new WorkflowError(
          422,
          'DELEGATION_CYCLE',
          'An agent cannot appear more than once in a task’s delegation ancestry.',
        );
      }
      parentKey = ancestor.parentTaskKey;
    }
  }

  return depths;
}

export function calculateWorkflowStatus(
  statuses: string[],
): 'active' | 'awaiting_human' | 'completed' | 'failed' | 'cancelled' {
  if (statuses.length === 0) {
    throw new WorkflowError(500, 'INVALID_WORKFLOW', 'Workflow has no tasks.');
  }
  if (statuses.some((status) => status === 'awaiting_human')) return 'awaiting_human';
  if (statuses.some((status) =>
    ['ready', 'blocked', 'in_progress'].includes(status))) return 'active';
  if (statuses.every((status) => ['completed', 'handed_off'].includes(status))) return 'completed';
  if (statuses.every((status) => status === 'cancelled')) return 'cancelled';
  return 'failed';
}

export function workflowErrorResponse(error: unknown): Response {
  if (error instanceof WorkflowError) {
    return apiError(error.status, error.code, error.message);
  }
  console.error('Workflow request failed.', error);
  return apiError(500, 'INTERNAL_ERROR', 'Workflow request could not be completed.');
}
