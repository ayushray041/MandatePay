import 'server-only';
import type { DocumentSnapshot, Firestore, Transaction } from 'firebase-admin/firestore';
import { getServerTimestamp } from '@/lib/firebase/firestore';
import { timestampToIso } from '@/lib/mandates/format';
import type { AgentPrincipal } from '@/lib/agents/auth';
import {
  workflowTaskRecordSchema,
  type WorkflowCreateInput,
  type WorkflowTaskRecord,
  type WorkflowTaskUpdateInput,
} from '@/models/workflow';
import {
  assertWorkflowMandate,
  calculateWorkflowStatus,
  getMandateDelegationPolicy,
  validateWorkflowAssignments,
  WorkflowError,
} from '@/lib/workflows/policy';

const workflowCollection = 'workflows';
const taskCollection = 'workflowTasks';
const maximumWorkflowTasks = 50;
const workflowReadScope = 'workflows:read';
const workflowExecuteScope = 'workflows:execute';
const workflowDelegateScope = 'workflows:delegate';

function formatWorkflow(id: string, data: Record<string, unknown>) {
  return {
    id,
    ownerId: data.ownerId,
    mandateId: data.mandateId,
    mandateVersion: data.mandateVersion,
    title: data.title,
    description: data.description,
    originatingAgentId: data.originatingAgentId,
    status: data.status,
    version: data.version,
    taskCount: data.taskCount,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  };
}

function formatTask(id: string, data: Record<string, unknown>): WorkflowTaskRecord {
  const parsed = workflowTaskRecordSchema.safeParse({
    id,
    workflowId: String(data.workflowId ?? ''),
    key: String(data.key ?? ''),
    type: data.type,
    title: String(data.title ?? ''),
    description: String(data.description ?? ''),
    assignedAgentId: String(data.assignedAgentId ?? ''),
    originatingAgentId: String(data.originatingAgentId ?? ''),
    delegatedFromAgentId: typeof data.delegatedFromAgentId === 'string'
      ? data.delegatedFromAgentId
      : null,
    delegationAgentPath: Array.isArray(data.delegationAgentPath)
      ? data.delegationAgentPath
      : [],
    parentTaskId: typeof data.parentTaskId === 'string' ? data.parentTaskId : null,
    dependencyTaskIds: Array.isArray(data.dependencyTaskIds)
      ? data.dependencyTaskIds
      : [],
    delegationDepth: Number(data.delegationDepth ?? 0),
    delegatedScopes: Array.isArray(data.delegatedScopes)
      ? data.delegatedScopes
      : [],
    status: data.status,
    attempts: Number(data.attempts ?? 0),
    maxAttempts: Number(data.maxAttempts ?? 1),
    ownerRetries: Number(data.ownerRetries ?? 0),
    timeoutSeconds: Number(data.timeoutSeconds ?? 3600),
    version: Number(data.version ?? 1),
    leaseExpiresAt: timestampToIso(data.leaseExpiresAt),
    resultSummary: typeof data.resultSummary === 'string' ? data.resultSummary : null,
    lastFailureReason: typeof data.lastFailureReason === 'string' ? data.lastFailureReason : null,
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt),
  });
  if (!parsed.success) {
    throw new WorkflowError(500, 'INVALID_TASK', 'Stored workflow task data is invalid.');
  }
  return parsed.data;
}

function recordFromSnapshot(snapshot: DocumentSnapshot): Record<string, unknown> {
  const data = snapshot.data();
  if (!snapshot.exists || !data) {
    throw new WorkflowError(404, 'WORKFLOW_NOT_FOUND', 'Workflow was not found.');
  }
  return data;
}

function writeEvent(
  transaction: Transaction,
  firestore: Firestore,
  workflowId: string,
  event: {
    sequence: number;
    action: string;
    actorType: 'owner' | 'agent' | 'system';
    actorId: string;
    taskId?: string;
    reason?: string;
    details?: Record<string, string | number | boolean | null>;
  },
): void {
  const eventRef = firestore.collection(workflowCollection).doc(workflowId).collection('events').doc();
  transaction.create(eventRef, {
    ...event,
    createdAt: getServerTimestamp(),
  });
}

function requireVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new WorkflowError(500, 'INVALID_WORKFLOW', 'Stored workflow version is invalid.');
  }
  return value;
}

function requireTaskVersion(value: unknown, expected: number): number {
  const version = requireVersion(value);
  if (version !== expected) {
    throw new WorkflowError(409, 'STALE_TASK', 'The task changed; reload it before continuing.');
  }
  return version;
}

function dependenciesAreComplete(
  task: Record<string, unknown>,
  taskDataById: Map<string, Record<string, unknown>>,
): boolean {
  const dependencyIds = Array.isArray(task.dependencyTaskIds)
    ? task.dependencyTaskIds.filter((value): value is string => typeof value === 'string')
    : [];
  return dependencyIds.every((dependencyId) => taskDataById.get(dependencyId)?.status === 'completed');
}

function cascadeBlockedTasks(
  taskDocuments: Array<{ id: string; data: Record<string, unknown> }>,
  taskDataById: Map<string, Record<string, unknown>>,
  failedTaskId: string,
  status: 'failed' | 'cancelled',
  reason: string,
): Array<{ id: string; data: Record<string, unknown> }> {
  const terminalTaskIds = new Set([failedTaskId]);
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const document of taskDocuments) {
      const task = taskDataById.get(document.id);
      const dependencies = Array.isArray(task?.dependencyTaskIds)
        ? task.dependencyTaskIds.filter((value): value is string => typeof value === 'string')
        : [];
      if (
        task?.status === 'blocked'
        && dependencies.some((dependencyId) => terminalTaskIds.has(dependencyId))
      ) {
        const updatedTask = {
          ...task,
          status,
          lastFailureReason: reason,
          version: requireVersion(task.version) + 1,
        };
        taskDataById.set(document.id, updatedTask);
        terminalTaskIds.add(document.id);
        updates.push({ id: document.id, data: updatedTask });
        changed = true;
      }
    }
  }
  return updates;
}

function newWorkflowStatus(
  workflow: Record<string, unknown>,
  tasks: Record<string, unknown>[],
): 'active' | 'paused' | 'awaiting_human' | 'completed' | 'failed' | 'cancelled' {
  if (workflow.status === 'paused' || workflow.status === 'cancelled') {
    return workflow.status;
  }
  return calculateWorkflowStatus(tasks.map((task) => String(task.status)));
}

async function assertActiveWorkflowMandate(
  transaction: Transaction,
  firestore: Firestore,
  workflow: Record<string, unknown>,
  now: Date,
): Promise<Record<string, unknown>> {
  const mandateRef = firestore.collection('mandates').doc(String(workflow.mandateId));
  const mandateSnapshot = await transaction.get(mandateRef);
  const mandate = recordFromSnapshot(mandateSnapshot);
  assertWorkflowMandate(
    mandate,
    String(workflow.ownerId),
    Number(workflow.mandateVersion),
    now,
  );
  return mandate;
}

function validateAgentProfile(
  profile: Record<string, unknown> | undefined,
  ownerId: string,
  agentId: string,
): void {
  if (
    !profile
    || profile.ownerId !== ownerId
    || profile.agentId !== agentId
    || profile.status !== 'active'
  ) {
    throw new WorkflowError(409, 'AGENT_UNAVAILABLE', 'An assigned agent is no longer active.');
  }
}

function assertTaskBelongsToWorkflow(
  task: Record<string, unknown>,
  workflowId: string,
  workflow: Record<string, unknown>,
): void {
  if (
    task.workflowId !== workflowId
    || task.ownerId !== workflow.ownerId
    || task.mandateId !== workflow.mandateId
    || task.mandateVersion !== workflow.mandateVersion
  ) {
    throw new WorkflowError(404, 'TASK_NOT_FOUND', 'Task was not found.');
  }
}

function assertTaskLeaseActive(task: Record<string, unknown>, now: Date): void {
  const leaseExpiresAt = timestampToIso(task.leaseExpiresAt);
  if (!leaseExpiresAt || Date.parse(leaseExpiresAt) <= now.getTime()) {
    throw new WorkflowError(409, 'TASK_LEASE_EXPIRED', 'The task lease expired; wait for timeout processing.');
  }
}

export async function listOwnedWorkflows(firestore: Firestore, ownerId: string) {
  const snapshot = await firestore.collection(workflowCollection)
    .where('ownerId', '==', ownerId)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return snapshot.docs.map((document) => formatWorkflow(document.id, document.data()));
}

export async function getOwnedWorkflow(
  firestore: Firestore,
  workflowId: string,
  ownerId: string,
) {
  const workflowRef = firestore.collection(workflowCollection).doc(workflowId);
  const [workflowSnapshot, tasksSnapshot, eventsSnapshot] = await Promise.all([
    workflowRef.get(),
    firestore.collection(taskCollection).where('workflowId', '==', workflowId)
      .orderBy('createdAt', 'asc').limit(maximumWorkflowTasks).get(),
    workflowRef.collection('events').orderBy('sequence', 'asc').limit(200).get(),
  ]);
  const workflow = recordFromSnapshot(workflowSnapshot);
  if (workflow.ownerId !== ownerId) {
    throw new WorkflowError(404, 'WORKFLOW_NOT_FOUND', 'Workflow was not found.');
  }
  return {
    workflow: formatWorkflow(workflowSnapshot.id, workflow),
    tasks: tasksSnapshot.docs.map((task) => formatTask(task.id, task.data())),
    events: eventsSnapshot.docs.map((event) => ({
      id: event.id,
      sequence: event.data().sequence,
      action: event.data().action,
      actorType: event.data().actorType,
      actorId: event.data().actorId,
      taskId: event.data().taskId ?? null,
      reason: event.data().reason ?? null,
      details: event.data().details ?? {},
      createdAt: timestampToIso(event.data().createdAt),
    })),
  };
}

export async function createWorkflow(
  firestore: Firestore,
  ownerId: string,
  input: WorkflowCreateInput,
): Promise<string> {
  const workflowRef = firestore.collection(workflowCollection).doc();
  const taskRefs = new Map(input.tasks.map((task) => [
    task.key,
    firestore.collection(taskCollection).doc(),
  ]));
  const now = new Date();
  const workflowVersion = 1;
  const workflowData: Record<string, unknown> = {
    ownerId,
    mandateId: input.mandateId,
    mandateVersion: null,
    title: input.title,
    description: input.description,
    originatingAgentId: null,
    status: 'active',
    version: workflowVersion,
    taskCount: input.tasks.length,
    createdAt: getServerTimestamp(),
    updatedAt: getServerTimestamp(),
  };
  await firestore.runTransaction(async (transaction) => {
    const mandateRef = firestore.collection('mandates').doc(input.mandateId);
    const mandateSnapshot = await transaction.get(mandateRef);
    const mandate = recordFromSnapshot(mandateSnapshot);
    if (mandate.ownerId !== ownerId) {
      throw new WorkflowError(404, 'MANDATE_NOT_FOUND', 'Mandate was not found.');
    }
    const mandateVersion = requireVersion(mandate.version);
    assertWorkflowMandate(mandate, ownerId, mandateVersion, now);
    const policy = getMandateDelegationPolicy(mandate);
    const allowedDelegateAgentIds = policy.allowedDelegateAgentIds ?? [];
    const primaryProfileSnapshot = await transaction.get(
      firestore.collection('agents').doc(String(mandate.authorizedAgentId)),
    );
    const primaryProfile = primaryProfileSnapshot.data();
    const primaryAgentId = primaryProfile?.agentId;
    if (
      typeof primaryAgentId !== 'string'
      || primaryProfile?.ownerId !== mandate.authorizedAgentId
      || primaryProfile?.status !== 'active'
    ) {
      throw new WorkflowError(
        409,
        'AGENT_UNAVAILABLE',
        'The mandate’s authorized agent must be registered and active to create a workflow.',
      );
    }
    const rootIdentity = await transaction.get(
      firestore.collection('agentIdentities').doc(primaryAgentId),
    );
    if (
      !rootIdentity.exists
      || rootIdentity.data()?.agentUid !== mandate.authorizedAgentId
      || rootIdentity.data()?.agentId !== primaryAgentId
    ) {
      throw new WorkflowError(409, 'AGENT_UNAVAILABLE', 'The mandate’s agent identity is invalid.');
    }

    const depths = validateWorkflowAssignments(
      input,
      primaryAgentId,
      allowedDelegateAgentIds,
      policy.maximumDelegationDepth,
    );
    const assignedIds = [...new Set(input.tasks.map((task) => task.assignedAgentId))];
    const identitySnapshots = await Promise.all(assignedIds.map((agentId) =>
      transaction.get(firestore.collection('agentIdentities').doc(agentId))));
    const assignedOwners = identitySnapshots.map((identity) => identity.data()?.agentUid);
    const profileSnapshots = await Promise.all(assignedOwners
      .filter((uid): uid is string => typeof uid === 'string')
      .map((uid) => transaction.get(firestore.collection('agents').doc(uid))));
    const profileByOwner = new Map(profileSnapshots.map((profile) => [
      String(profile.data()?.ownerId ?? ''),
      profile.data(),
    ]));
    for (let index = 0; index < assignedIds.length; index += 1) {
      const identity = identitySnapshots[index].data();
      const assignedOwner = assignedOwners[index];
      if (
        !identitySnapshots[index].exists
        || identity?.agentId !== assignedIds[index]
        || typeof assignedOwner !== 'string'
      ) {
        throw new WorkflowError(422, 'INVALID_TASK_AGENT', 'A task agent identity is invalid.');
      }
      validateAgentProfile(profileByOwner.get(assignedOwner), assignedOwner, assignedIds[index]);
    }

    const taskByKey = new Map(input.tasks.map((task) => [task.key, task]));
    const pathByKey = new Map<string, string[]>();
    const scopesByKey = new Map<string, string[]>();
    const getPath = (key: string): string[] => {
      const existing = pathByKey.get(key);
      if (existing) return existing;
      const task = taskByKey.get(key);
      if (!task) throw new WorkflowError(400, 'INVALID_TASK_GRAPH', 'A task parent is invalid.');
      const path = task.parentTaskKey
        ? [...getPath(task.parentTaskKey), task.assignedAgentId]
        : [task.assignedAgentId];
      pathByKey.set(key, path);
      return path;
    };
    const getScopes = (key: string): string[] => {
      const existing = scopesByKey.get(key);
      if (existing) return existing;
      const depth = depths.get(key) ?? 0;
      const scopes = [
        workflowReadScope,
        workflowExecuteScope,
        ...(depth < policy.maximumDelegationDepth ? [workflowDelegateScope] : []),
      ];
      scopesByKey.set(key, scopes);
      return scopes;
    };

    for (const task of input.tasks) {
      const taskRef = taskRefs.get(task.key);
      if (!taskRef) throw new WorkflowError(400, 'INVALID_TASK_GRAPH', 'A task key is invalid.');
      const parentTask = task.parentTaskKey ? taskByKey.get(task.parentTaskKey) : undefined;
      const dependencyTaskIds = task.dependsOn.map((key) => {
        const dependencyRef = taskRefs.get(key);
        if (!dependencyRef) throw new WorkflowError(400, 'INVALID_TASK_GRAPH', 'A dependency is invalid.');
        return dependencyRef.id;
      });
      const taskData: Record<string, unknown> = {
        workflowId: workflowRef.id,
        ownerId,
        mandateId: input.mandateId,
        mandateVersion,
        key: task.key,
        type: task.type,
        title: task.title,
        description: task.description,
        assignedAgentId: task.assignedAgentId,
        originatingAgentId: primaryAgentId,
        delegatedFromAgentId: parentTask?.assignedAgentId ?? null,
        delegationAgentPath: getPath(task.key),
        parentTaskId: task.parentTaskKey ? taskRefs.get(task.parentTaskKey)?.id ?? null : null,
        dependencyTaskIds,
        delegationDepth: depths.get(task.key) ?? 0,
        delegatedScopes: getScopes(task.key),
        status: dependencyTaskIds.length > 0 ? 'blocked' : 'ready',
        attempts: 0,
        maxAttempts: task.maxAttempts,
        ownerRetries: 0,
        timeoutSeconds: task.timeoutSeconds,
        version: 1,
        leaseExpiresAt: null,
        resultSummary: null,
        lastFailureReason: null,
        createdAt: getServerTimestamp(),
        updatedAt: getServerTimestamp(),
      };
      transaction.create(taskRef, taskData);
    }
    transaction.create(workflowRef, {
      ...workflowData,
      mandateVersion,
      originatingAgentId: primaryAgentId,
    });
    writeEvent(transaction, firestore, workflowRef.id, {
      sequence: workflowVersion,
      action: 'workflow.created',
      actorType: 'owner',
      actorId: ownerId,
      details: { taskCount: input.tasks.length, mandateVersion },
    });
  });
  return workflowRef.id;
}

export async function listAgentTasks(
  firestore: Firestore,
  principal: AgentPrincipal,
) {
  const snapshot = await firestore.collection(taskCollection)
    .where('assignedAgentId', '==', principal.agentId)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  const tasks: WorkflowTaskRecord[] = [];
  await Promise.all(snapshot.docs.map(async (taskSnapshot) => {
    const task = taskSnapshot.data();
    if (
      task.assignedAgentId !== principal.agentId
      || !['ready', 'in_progress', 'awaiting_human'].includes(String(task.status))
      || !Array.isArray(task.delegatedScopes)
      || !task.delegatedScopes.includes(workflowReadScope)
    ) {
      return;
    }
    const workflowSnapshot = await firestore.collection(workflowCollection)
      .doc(String(task.workflowId)).get();
    const workflow = workflowSnapshot.data();
    if (
      !workflowSnapshot.exists
      || !workflow
      || workflow.status !== 'active'
      || task.ownerId !== workflow.ownerId
      || task.mandateId !== workflow.mandateId
      || task.mandateVersion !== workflow.mandateVersion
    ) return;
    const mandateSnapshot = await firestore.collection('mandates').doc(String(workflow.mandateId)).get();
    const mandate = mandateSnapshot.data();
    if (!mandate) return;
    try {
      assertWorkflowMandate(mandate, String(workflow.ownerId), Number(workflow.mandateVersion));
      const leaseExpiresAt = timestampToIso(task.leaseExpiresAt);
      if (task.status === 'in_progress' && (!leaseExpiresAt || Date.parse(leaseExpiresAt) <= Date.now())) return;
      tasks.push(formatTask(taskSnapshot.id, task));
    } catch (error: unknown) {
      if (!(error instanceof WorkflowError)) throw error;
    }
  }));
  return tasks;
}

export async function claimWorkflowTask(
  firestore: Firestore,
  principal: AgentPrincipal,
  taskId: string,
  expectedVersion: number,
): Promise<WorkflowTaskRecord> {
  const taskRef = firestore.collection(taskCollection).doc(taskId);
  const now = new Date();
  return firestore.runTransaction(async (transaction) => {
    const taskSnapshot = await transaction.get(taskRef);
    const task = recordFromSnapshot(taskSnapshot);
    const workflowRef = firestore.collection(workflowCollection).doc(String(task.workflowId));
    const workflowSnapshot = await transaction.get(workflowRef);
    const workflow = recordFromSnapshot(workflowSnapshot);
    await assertActiveWorkflowMandate(transaction, firestore, workflow, now);
    assertTaskBelongsToWorkflow(task, workflowSnapshot.id, workflow);
    const version = requireTaskVersion(task.version, expectedVersion);
    if (
      task.assignedAgentId !== principal.agentId
      || !Array.isArray(task.delegatedScopes)
      || !task.delegatedScopes.includes(workflowExecuteScope)
    ) {
      throw new WorkflowError(404, 'TASK_NOT_FOUND', 'Task was not found.');
    }
    if (workflow.status !== 'active' || task.status !== 'ready') {
      throw new WorkflowError(409, 'TASK_NOT_READY', 'Task is not available to claim.');
    }
    const allTasks = await transaction.get(
      firestore.collection(taskCollection).where('workflowId', '==', String(task.workflowId)),
    );
    const dataById = new Map(allTasks.docs.map((document) => [document.id, document.data()]));
    if (!dependenciesAreComplete(task, dataById)) {
      throw new WorkflowError(409, 'TASK_DEPENDENCIES_PENDING', 'Task dependencies are not complete.');
    }
    const attempts = Number(task.attempts);
    if (!Number.isSafeInteger(attempts) || attempts < 0 || attempts >= Number(task.maxAttempts)) {
      throw new WorkflowError(409, 'TASK_ATTEMPTS_EXHAUSTED', 'Task has no remaining execution attempts.');
    }
    const leaseExpiresAt = new Date(now.getTime() + Number(task.timeoutSeconds) * 1000);
    const updatedTask = {
      ...task,
      status: 'in_progress',
      attempts: attempts + 1,
      leaseExpiresAt,
      version: version + 1,
    };
    const workflowVersion = requireVersion(workflow.version) + 1;
    transaction.update(taskRef, {
      status: updatedTask.status,
      attempts: updatedTask.attempts,
      leaseExpiresAt,
      version: updatedTask.version,
      updatedAt: getServerTimestamp(),
    });
    transaction.update(workflowRef, {
      version: workflowVersion,
      updatedAt: getServerTimestamp(),
    });
    writeEvent(transaction, firestore, workflowRef.id, {
      sequence: workflowVersion,
      action: 'task.claimed',
      actorType: 'agent',
      actorId: principal.agentId,
      taskId,
      details: { attempt: updatedTask.attempts, mandateVersion: Number(workflow.mandateVersion) },
    });
    return formatTask(taskId, {
      ...task,
      status: updatedTask.status,
      attempts: updatedTask.attempts,
      leaseExpiresAt,
      version: updatedTask.version,
    });
  });
}

export async function updateWorkflowTask(
  firestore: Firestore,
  principal: AgentPrincipal,
  taskId: string,
  input: WorkflowTaskUpdateInput,
): Promise<WorkflowTaskRecord> {
  const taskRef = firestore.collection(taskCollection).doc(taskId);
  const now = new Date();
  return firestore.runTransaction(async (transaction) => {
    const taskSnapshot = await transaction.get(taskRef);
    const task = recordFromSnapshot(taskSnapshot);
    const workflowRef = firestore.collection(workflowCollection).doc(String(task.workflowId));
    const workflowSnapshot = await transaction.get(workflowRef);
    const workflow = recordFromSnapshot(workflowSnapshot);
    await assertActiveWorkflowMandate(transaction, firestore, workflow, now);
    assertTaskBelongsToWorkflow(task, workflowSnapshot.id, workflow);
    const version = requireTaskVersion(task.version, input.expectedVersion);
    if (
      task.assignedAgentId !== principal.agentId
      || !Array.isArray(task.delegatedScopes)
      || !task.delegatedScopes.includes(workflowExecuteScope)
    ) {
      throw new WorkflowError(404, 'TASK_NOT_FOUND', 'Task was not found.');
    }
    if (workflow.status !== 'active' || task.status !== 'in_progress') {
      throw new WorkflowError(409, 'TASK_NOT_IN_PROGRESS', 'Only an active assigned task can be updated.');
    }
    assertTaskLeaseActive(task, now);
    const allTasks = await transaction.get(
      firestore.collection(taskCollection).where('workflowId', '==', String(task.workflowId)),
    );
    const taskDataById = new Map(allTasks.docs.map((document) => [document.id, document.data()]));
    const taskStatus = input.action === 'complete'
      ? 'completed'
      : input.action === 'request_human'
        ? 'awaiting_human'
        : Number(task.attempts) < Number(task.maxAttempts)
          ? 'ready'
          : 'failed';
    const updatedTask = {
      ...task,
      status: taskStatus,
      leaseExpiresAt: null,
      resultSummary: input.action === 'complete' ? input.summary : task.resultSummary ?? null,
      lastFailureReason: input.action === 'fail' ? input.reason : task.lastFailureReason ?? null,
      version: version + 1,
    };
    taskDataById.set(taskId, updatedTask);
    const dependentUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
    if (input.action === 'complete') {
      for (const document of allTasks.docs) {
        const dependent = document.data();
        if (
          dependent.status === 'blocked'
          && dependenciesAreComplete(dependent, taskDataById)
        ) {
          const readyTask = {
            ...dependent,
            status: 'ready',
            version: requireVersion(dependent.version) + 1,
          };
          taskDataById.set(document.id, readyTask);
          dependentUpdates.push({ id: document.id, data: readyTask });
        }
      }
    }
    const terminalUpdates = input.action === 'fail' && taskStatus === 'failed'
      ? cascadeBlockedTasks(
        allTasks.docs.map((document) => ({ id: document.id, data: document.data() })),
        taskDataById,
        taskId,
        'failed',
        'A required dependency failed.',
      )
      : [];
    const workflowStatus = newWorkflowStatus(workflow, [...taskDataById.values()]);
    const workflowVersion = requireVersion(workflow.version) + 1;
    transaction.update(taskRef, {
      status: updatedTask.status,
      leaseExpiresAt: null,
      ...(input.action === 'complete' ? { resultSummary: input.summary } : {}),
      ...(input.action === 'fail' ? { lastFailureReason: input.reason } : {}),
      version: updatedTask.version,
      updatedAt: getServerTimestamp(),
    });
    for (const dependent of dependentUpdates) {
      transaction.update(firestore.collection(taskCollection).doc(dependent.id), {
        status: 'ready',
        version: dependent.data.version,
        updatedAt: getServerTimestamp(),
      });
    }
    for (const dependent of terminalUpdates) {
      transaction.update(firestore.collection(taskCollection).doc(dependent.id), {
        status: dependent.data.status,
        lastFailureReason: dependent.data.lastFailureReason,
        version: dependent.data.version,
        updatedAt: getServerTimestamp(),
      });
    }
    transaction.update(workflowRef, {
      status: workflowStatus,
      version: workflowVersion,
      updatedAt: getServerTimestamp(),
    });
    writeEvent(transaction, firestore, workflowRef.id, {
      sequence: workflowVersion,
      action: input.action === 'complete'
        ? 'task.reported_complete'
        : input.action === 'fail'
          ? 'task.failed'
          : 'task.requested_human',
      actorType: 'agent',
      actorId: principal.agentId,
      taskId,
      ...(input.action === 'complete'
        ? { details: { summary: input.summary } }
        : { reason: input.reason }),
    });
    for (const dependent of dependentUpdates) {
      writeEvent(transaction, firestore, workflowRef.id, {
        sequence: workflowVersion,
        action: 'task.dependencies_satisfied',
        actorType: 'system',
        actorId: 'system',
        taskId: dependent.id,
      });
    }
    for (const dependent of terminalUpdates) {
      writeEvent(transaction, firestore, workflowRef.id, {
        sequence: workflowVersion,
        action: 'task.dependency_failed',
        actorType: 'system',
        actorId: 'system',
        taskId: dependent.id,
      });
    }
    return formatTask(taskId, updatedTask);
  });
}

export async function handoffWorkflowTask(
  firestore: Firestore,
  principal: AgentPrincipal,
  taskId: string,
  delegatedAgentId: string,
  expectedVersion: number,
  reason: string,
): Promise<WorkflowTaskRecord> {
  const taskRef = firestore.collection(taskCollection).doc(taskId);
  const now = new Date();
  return firestore.runTransaction(async (transaction) => {
    const taskSnapshot = await transaction.get(taskRef);
    const task = recordFromSnapshot(taskSnapshot);
    const workflowRef = firestore.collection(workflowCollection).doc(String(task.workflowId));
    const workflowSnapshot = await transaction.get(workflowRef);
    const workflow = recordFromSnapshot(workflowSnapshot);
    const mandate = await assertActiveWorkflowMandate(transaction, firestore, workflow, now);
    assertTaskBelongsToWorkflow(task, workflowSnapshot.id, workflow);
    const version = requireTaskVersion(task.version, expectedVersion);
    if (
      task.assignedAgentId !== principal.agentId
      || task.status !== 'in_progress'
      || workflow.status !== 'active'
      || !Array.isArray(task.delegatedScopes)
      || !task.delegatedScopes.includes(workflowDelegateScope)
    ) {
      throw new WorkflowError(404, 'TASK_NOT_FOUND', 'Task is not delegable by this agent.');
    }
    assertTaskLeaseActive(task, now);
    const policy = getMandateDelegationPolicy(mandate);
    const depth = Number(task.delegationDepth);
    const agentPath = Array.isArray(task.delegationAgentPath)
      ? task.delegationAgentPath.filter((value): value is string => typeof value === 'string')
      : [];
    if (
      depth >= policy.maximumDelegationDepth
      || !policy.allowedDelegateAgentIds?.includes(delegatedAgentId)
      || agentPath.includes(delegatedAgentId)
    ) {
      throw new WorkflowError(
        403,
        'DELEGATION_NOT_ALLOWED',
        'The target agent is not approved by the mandate or delegation depth is exhausted.',
      );
    }
    const identitySnapshot = await transaction.get(
      firestore.collection('agentIdentities').doc(delegatedAgentId),
    );
    const identity = identitySnapshot.data();
    if (
      !identitySnapshot.exists
      || identity?.agentId !== delegatedAgentId
      || typeof identity.agentUid !== 'string'
    ) {
      throw new WorkflowError(422, 'INVALID_DELEGATED_AGENT', 'Delegated agent identity is invalid.');
    }
    const profileSnapshot = await transaction.get(
      firestore.collection('agents').doc(identity.agentUid),
    );
    validateAgentProfile(profileSnapshot.data(), identity.agentUid, delegatedAgentId);

    const nextDepth = depth + 1;
    const delegatedScopes = task.delegatedScopes.filter((scope): scope is string =>
      typeof scope === 'string'
      && (scope !== workflowDelegateScope || nextDepth < policy.maximumDelegationDepth));
    if (!delegatedScopes.includes(workflowReadScope) || !delegatedScopes.includes(workflowExecuteScope)) {
      throw new WorkflowError(403, 'DELEGATION_NOT_ALLOWED', 'Workflow execution permissions cannot be inherited.');
    }
    const workflowVersion = requireVersion(workflow.version) + 1;
    const updatedTask = {
      ...task,
      assignedAgentId: delegatedAgentId,
      delegatedFromAgentId: principal.agentId,
      delegationAgentPath: [...agentPath, delegatedAgentId],
      delegationDepth: nextDepth,
      delegatedScopes,
      status: 'ready',
      leaseExpiresAt: null,
      version: version + 1,
    };
    transaction.update(taskRef, {
      assignedAgentId: delegatedAgentId,
      delegatedFromAgentId: principal.agentId,
      delegationAgentPath: updatedTask.delegationAgentPath,
      delegationDepth: nextDepth,
      delegatedScopes,
      status: 'ready',
      leaseExpiresAt: null,
      version: updatedTask.version,
      updatedAt: getServerTimestamp(),
    });
    transaction.update(workflowRef, {
      version: workflowVersion,
      updatedAt: getServerTimestamp(),
    });
    writeEvent(transaction, firestore, workflowRef.id, {
      sequence: workflowVersion,
      action: 'task.handed_off',
      actorType: 'agent',
      actorId: principal.agentId,
      taskId,
      reason,
      details: { delegatedAgentId, delegationDepth: nextDepth },
    });
    return formatTask(taskId, updatedTask);
  });
}

export async function decideOwnedWorkflowTask(
  firestore: Firestore,
  ownerId: string,
  workflowId: string,
  taskId: string,
  action: 'resume' | 'cancel' | 'retry',
  reason: string,
): Promise<WorkflowTaskRecord> {
  const workflowRef = firestore.collection(workflowCollection).doc(workflowId);
  const taskRef = firestore.collection(taskCollection).doc(taskId);
  const now = new Date();
  return firestore.runTransaction(async (transaction) => {
    const [workflowSnapshot, taskSnapshot] = await Promise.all([
      transaction.get(workflowRef),
      transaction.get(taskRef),
    ]);
    const workflow = recordFromSnapshot(workflowSnapshot);
    const task = recordFromSnapshot(taskSnapshot);
    if (workflow.ownerId !== ownerId || task.workflowId !== workflowId) {
      throw new WorkflowError(404, 'WORKFLOW_NOT_FOUND', 'Workflow was not found.');
    }
    if (action !== 'cancel') {
      await assertActiveWorkflowMandate(transaction, firestore, workflow, now);
    }
    assertTaskBelongsToWorkflow(task, workflowId, workflow);
    const allTasks = await transaction.get(
      firestore.collection(taskCollection).where('workflowId', '==', workflowId),
    );
    const dataById = new Map(allTasks.docs.map((document) => [document.id, document.data()]));
    if (action === 'resume' && task.status !== 'awaiting_human') {
      throw new WorkflowError(409, 'TASK_NOT_AWAITING_HUMAN', 'Task is not awaiting human review.');
    }
    if (action === 'cancel' && ['completed', 'handed_off', 'cancelled'].includes(String(task.status))) {
      throw new WorkflowError(409, 'TASK_NOT_CANCELLABLE', 'Task is already terminal.');
    }
    if (
      action === 'retry'
      && (
        !['failed', 'timed_out'].includes(String(task.status))
        || Number(task.ownerRetries) >= 3
      )
    ) {
      throw new WorkflowError(409, 'TASK_NOT_RETRYABLE', 'Task cannot be retried again.');
    }
    const dependenciesComplete = dependenciesAreComplete(task, dataById);
    const updatedTask = {
      ...task,
      status: action === 'cancel'
        ? 'cancelled'
        : dependenciesComplete
          ? 'ready'
          : 'blocked',
      attempts: action === 'retry' ? 0 : Number(task.attempts),
      ownerRetries: action === 'retry' ? Number(task.ownerRetries) + 1 : Number(task.ownerRetries),
      leaseExpiresAt: null,
      version: requireVersion(task.version) + 1,
      ...(action === 'retry' ? { lastFailureReason: null } : {}),
    };
    dataById.set(taskId, updatedTask);
    const terminalUpdates = action === 'cancel'
      ? cascadeBlockedTasks(
        allTasks.docs.map((document) => ({ id: document.id, data: document.data() })),
        dataById,
        taskId,
        'cancelled',
        'A required dependency was cancelled by the owner.',
      )
      : [];
    const workflowStatus = action === 'cancel'
      ? calculateWorkflowStatus([...dataById.values()].map((item) => String(item.status)))
      : workflow.status === 'paused'
        ? 'paused'
        : 'active';
    const workflowVersion = requireVersion(workflow.version) + 1;
    transaction.update(taskRef, {
      status: updatedTask.status,
      attempts: updatedTask.attempts,
      ownerRetries: updatedTask.ownerRetries,
      leaseExpiresAt: null,
      version: updatedTask.version,
      ...(action === 'retry' ? { lastFailureReason: null } : {}),
      updatedAt: getServerTimestamp(),
    });
    for (const dependent of terminalUpdates) {
      transaction.update(firestore.collection(taskCollection).doc(dependent.id), {
        status: 'cancelled',
        lastFailureReason: dependent.data.lastFailureReason,
        version: dependent.data.version,
        updatedAt: getServerTimestamp(),
      });
    }
    transaction.update(workflowRef, {
      status: workflowStatus,
      version: workflowVersion,
      updatedAt: getServerTimestamp(),
    });
    writeEvent(transaction, firestore, workflowId, {
      sequence: workflowVersion,
      action: `task.owner_${action}`,
      actorType: 'owner',
      actorId: ownerId,
      taskId,
      reason,
    });
    return formatTask(taskId, updatedTask);
  });
}

export async function changeOwnedWorkflowStatus(
  firestore: Firestore,
  ownerId: string,
  workflowId: string,
  action: 'pause' | 'resume' | 'cancel',
) {
  const workflowRef = firestore.collection(workflowCollection).doc(workflowId);
  const now = new Date();
  return firestore.runTransaction(async (transaction) => {
    const workflowSnapshot = await transaction.get(workflowRef);
    const workflow = recordFromSnapshot(workflowSnapshot);
    if (workflow.ownerId !== ownerId) {
      throw new WorkflowError(404, 'WORKFLOW_NOT_FOUND', 'Workflow was not found.');
    }
    if (action !== 'cancel') {
      await assertActiveWorkflowMandate(transaction, firestore, workflow, now);
    }
    const allTasks = action === 'pause'
      ? null
      : await transaction.get(firestore.collection(taskCollection).where('workflowId', '==', workflowId));
    if (action === 'pause' && workflow.status !== 'active') {
      throw new WorkflowError(409, 'WORKFLOW_NOT_ACTIVE', 'Only an active workflow can be paused.');
    }
    if (action === 'resume' && workflow.status !== 'paused') {
      throw new WorkflowError(409, 'WORKFLOW_NOT_PAUSED', 'Only a paused workflow can be resumed.');
    }
    if (action === 'cancel' && ['cancelled', 'completed', 'failed'].includes(String(workflow.status))) {
      throw new WorkflowError(409, 'WORKFLOW_TERMINAL', 'Workflow is already terminal.');
    }
    const workflowVersion = requireVersion(workflow.version) + 1;
    if (action === 'cancel' && allTasks) {
      for (const document of allTasks.docs) {
        const task = document.data();
        if (!['completed', 'handed_off', 'cancelled', 'failed', 'timed_out'].includes(String(task.status))) {
          transaction.update(document.ref, {
            status: 'cancelled',
            leaseExpiresAt: null,
            version: requireVersion(task.version) + 1,
            updatedAt: getServerTimestamp(),
          });
        }
      }
    }
    const status = action === 'pause'
      ? 'paused'
      : action === 'cancel'
        ? 'cancelled'
        : calculateWorkflowStatus((allTasks?.docs ?? []).map((document) =>
          String(document.data().status)));
    transaction.update(workflowRef, {
      status,
      version: workflowVersion,
      updatedAt: getServerTimestamp(),
    });
    writeEvent(transaction, firestore, workflowId, {
      sequence: workflowVersion,
      action: action === 'pause'
        ? 'workflow.paused'
        : action === 'resume'
          ? 'workflow.resumed'
          : 'workflow.cancelled',
      actorType: 'owner',
      actorId: ownerId,
    });
    return formatWorkflow(workflowId, { ...workflow, status, version: workflowVersion });
  });
}

export async function expireDueWorkflowTasks(firestore: Firestore, now = new Date()) {
  const dueSnapshot = await firestore.collection(taskCollection)
    .where('status', '==', 'in_progress')
    .where('leaseExpiresAt', '<=', now)
    .orderBy('leaseExpiresAt', 'asc')
    .limit(100)
    .get();
  let expiredCount = 0;
  for (const dueTask of dueSnapshot.docs) {
    const taskRef = dueTask.ref;
    const didExpire = await firestore.runTransaction(async (transaction) => {
      const taskSnapshot = await transaction.get(taskRef);
      const task = taskSnapshot.data();
      if (
        !taskSnapshot.exists
        || !task
        || task.status !== 'in_progress'
        || timestampToIso(task.leaseExpiresAt) === null
        || Date.parse(timestampToIso(task.leaseExpiresAt) ?? '') > now.getTime()
      ) {
        return false;
      }
      const workflowRef = firestore.collection(workflowCollection).doc(String(task.workflowId));
      const workflowSnapshot = await transaction.get(workflowRef);
      const workflow = recordFromSnapshot(workflowSnapshot);
      const allTasks = await transaction.get(
        firestore.collection(taskCollection).where('workflowId', '==', String(task.workflowId)),
      );
      const retryAvailable = Number(task.attempts) < Number(task.maxAttempts);
      const taskStatus = retryAvailable ? 'ready' : 'timed_out';
      const updatedTask = {
        ...task,
        status: taskStatus,
        leaseExpiresAt: null,
      };
      const taskData = allTasks.docs.map((document) =>
        document.id === taskSnapshot.id ? updatedTask : document.data());
      const workflowStatus = workflow.status === 'paused'
        ? 'paused'
        : calculateWorkflowStatus(taskData.map((item) => String(item.status)));
      const workflowVersion = requireVersion(workflow.version) + 1;
      transaction.update(taskRef, {
        status: taskStatus,
        leaseExpiresAt: null,
        lastFailureReason: 'Execution lease expired.',
        version: requireVersion(task.version) + 1,
        updatedAt: getServerTimestamp(),
      });
      transaction.update(workflowRef, {
        status: workflowStatus,
        version: workflowVersion,
        updatedAt: getServerTimestamp(),
      });
      writeEvent(transaction, firestore, workflowRef.id, {
        sequence: workflowVersion,
        action: retryAvailable ? 'task.timed_out_retryable' : 'task.timed_out',
        actorType: 'system',
        actorId: 'system',
        taskId: taskSnapshot.id,
      });
      return true;
    });
    if (didExpire) expiredCount += 1;
  }
  return { expiredCount, scannedCount: dueSnapshot.size };
}

