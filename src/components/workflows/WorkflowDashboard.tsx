'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, CircleAlert, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/Button';
import { listMandates } from '@/lib/mandates/client';
import {
  createWorkflow,
  decideWorkflowTask,
  getWorkflow,
  getWorkflowAgents,
  listWorkflows,
  performWorkflowAction,
  type WorkflowAgentOption,
  type WorkflowDetails,
} from '@/lib/workflows/client';
import type { MandateRecord } from '@/models/mandate';
import type { WorkflowRecord, WorkflowTaskType } from '@/models/workflow';

type DraftTask = {
  key: string;
  type: WorkflowTaskType;
  title: string;
  description: string;
  assignedAgentId: string;
  dependsOn: string[];
  parentTaskKey: string;
};

const taskTypes: WorkflowTaskType[] = [
  'research',
  'discovery',
  'negotiation',
  'contract',
  'payment',
  'custom',
];

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Not available';
}

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

export function WorkflowDashboard() {
  const { user } = useAuth();
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([]);
  const [mandates, setMandates] = useState<MandateRecord[]>([]);
  const [details, setDetails] = useState<WorkflowDetails | null>(null);
  const [agents, setAgents] = useState<WorkflowAgentOption[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState('');
  const [selectedMandateId, setSelectedMandateId] = useState('');
  const [draftTasks, setDraftTasks] = useState<DraftTask[]>([{
    key: 'step-1',
    type: 'research',
    title: '',
    description: '',
    assignedAgentId: '',
    dependsOn: [],
    parentTaskKey: '',
  }]);
  const [ownerReason, setOwnerReason] = useState('Reviewed by the mandate owner.');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const ownedActiveMandates = useMemo(
    () => mandates.filter((mandate) => mandate.ownerId === user?.uid && mandate.status === 'active'),
    [mandates, user?.uid],
  );
  const authorizedAgent = agents.find((agent) => agent.role === 'authorized');
  const delegatedAgents = agents.filter((agent) => agent.role === 'delegated');
  const agentNames = useMemo(
    () => new Map(agents.map((agent) => [agent.agentId, agent.displayName])),
    [agents],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [workflowRecords, mandateRecords] = await Promise.all([listWorkflows(), listMandates()]);
      setWorkflows(workflowRecords);
      setMandates(mandateRecords);
      setSelectedWorkflowId((current) => current || workflowRecords[0]?.id || '');
      setSelectedMandateId((current) =>
        current || mandateRecords.find((mandate) =>
          mandate.ownerId === user?.uid && mandate.status === 'active')?.id || '');
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Workflow data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    let active = true;
    if (!selectedWorkflowId) {
      setDetails(null);
      return () => { active = false; };
    }
    void getWorkflow(selectedWorkflowId)
      .then((workflowDetails) => {
        if (active) setDetails(workflowDetails);
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setDetails(null);
          setError(caughtError instanceof Error ? caughtError.message : 'Workflow details could not be loaded.');
        }
      });
    return () => { active = false; };
  }, [selectedWorkflowId]);

  useEffect(() => {
    let active = true;
    if (!selectedMandateId) {
      setAgents([]);
      return () => { active = false; };
    }
    void getWorkflowAgents(selectedMandateId)
      .then((options) => {
        if (active) {
          setAgents(options);
          setDraftTasks((current) => current.map((task) => ({
            ...task,
            assignedAgentId: task.assignedAgentId || options.find((agent) => agent.role === 'authorized')?.agentId || '',
          })));
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setAgents([]);
          setError(caughtError instanceof Error ? caughtError.message : 'Mandate agents could not be loaded.');
        }
      });
    return () => { active = false; };
  }, [selectedMandateId]);

  const loadSelected = async () => {
    if (!selectedWorkflowId) return;
    const updated = await getWorkflow(selectedWorkflowId);
    setDetails(updated);
    const updatedWorkflows = await listWorkflows();
    setWorkflows(updatedWorkflows);
  };

  const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await refresh();
      if (selectedWorkflowId) {
        setDetails(await getWorkflow(selectedWorkflowId));
      }
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Workflow action failed.');
    } finally {
      setBusy(false);
    }
  };

  const updateTask = (key: string, update: Partial<DraftTask>) => {
    setDraftTasks((current) => current.map((task) =>
      task.key === key ? { ...task, ...update } : task));
  };

  const addTask = () => {
    setDraftTasks((current) => {
      const key = `step-${current.length + 1}`;
      const parent = current.at(-1);
      return [...current, {
        key,
        type: 'custom',
        title: '',
        description: '',
        assignedAgentId: delegatedAgents[0]?.agentId ?? authorizedAgent?.agentId ?? '',
        dependsOn: parent ? [parent.key] : [],
        parentTaskKey: parent && delegatedAgents.length > 0 ? parent.key : '',
      }];
    });
  };

  const removeTask = (key: string) => {
    setDraftTasks((current) => current
      .filter((task) => task.key !== key)
      .map((task) => ({
        ...task,
        dependsOn: task.dependsOn.filter((dependency) => dependency !== key),
        parentTaskKey: task.parentTaskKey === key ? '' : task.parentTaskKey,
      })));
  };

  const submitWorkflow = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const workflowTitle = String(formData.get('workflowTitle') ?? '').trim();
    const workflowDescription = String(formData.get('workflowDescription') ?? '').trim();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createWorkflow({
        mandateId: selectedMandateId,
        title: workflowTitle,
        description: workflowDescription,
        tasks: draftTasks.map((task) => ({
          key: task.key,
          type: task.type,
          title: task.title,
          description: task.description,
          assignedAgentId: task.assignedAgentId,
          dependsOn: task.dependsOn,
          ...(task.parentTaskKey ? { parentTaskKey: task.parentTaskKey } : {}),
          timeoutSeconds: 3600,
          maxAttempts: 2,
        })),
      });
      setSelectedWorkflowId(created.id);
      setNotice('Workflow created. Agents can claim ready tasks using scoped API credentials.');
      setDraftTasks([{
        key: 'step-1',
        type: 'research',
        title: '',
        description: '',
        assignedAgentId: authorizedAgent?.agentId ?? '',
        dependsOn: [],
        parentTaskKey: '',
      }]);
      await refresh();
      setSelectedWorkflowId(created.id);
      setDetails(await getWorkflow(created.id));
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Workflow could not be created.');
    } finally {
      setBusy(false);
    }
  };

  const taskProgress = details
    ? Math.round(details.tasks.filter((task) => ['completed', 'handed_off'].includes(task.status)).length
      / details.tasks.length * 100)
    : 0;

  return (
    <section className="mp-page mx-auto w-full max-w-7xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-mp-warm-grey pb-6">
        <div>
          <p className="mp-kicker">Phase 8 · Multi-agent orchestration</p>
          <h1 className="mp-page-title mt-2">Workflows</h1>
          <p className="mp-copy mt-3 max-w-2xl">
            Assign bounded tasks to mandate-approved agents. Agents claim work through scoped APIs;
            workflow state never authorizes or executes a financial operation.
          </p>
        </div>
        <Button type="button" variant="outline" disabled={loading || busy} onClick={() => void refresh()}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh
        </Button>
      </header>

      {error && <p className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="alert">{error}</p>}
      {notice && <p className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="status">{notice}</p>}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(20rem,0.9fr)]">
        <section className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold">Create a workflow</h2>
            <span className="text-xs text-mp-medium-grey">Up to 25 planned tasks; delegation capped by mandate</span>
          </div>
          {ownedActiveMandates.length === 0 ? (
            <p className="border border-mp-warm-grey bg-mp-surface p-5 text-sm text-mp-medium-grey">
              Activate a mandate you own before creating agent workflows.
            </p>
          ) : (
            <form onSubmit={submitWorkflow} className="space-y-5 border border-mp-warm-grey bg-mp-surface p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="mp-label">Workflow title</span>
                  <input name="workflowTitle" required maxLength={120} className="mp-input mt-1" />
                </label>
                <label>
                  <span className="mp-label">Mandate</span>
                  <select
                    value={selectedMandateId}
                    onChange={(event) => setSelectedMandateId(event.target.value)}
                    required
                    className="mp-input mt-1"
                  >
                    {ownedActiveMandates.map((mandate) => (
                      <option key={mandate.id} value={mandate.id}>{mandate.title}</option>
                    ))}
                  </select>
                </label>
                <label className="sm:col-span-2">
                  <span className="mp-label">Purpose and boundaries</span>
                  <textarea name="workflowDescription" required maxLength={1000} rows={2} className="mp-input mt-1" />
                </label>
              </div>
              <div className="space-y-4">
                <h3 className="font-semibold">Task graph</h3>
                {draftTasks.map((task, index) => {
                  const eligibleAgents = task.parentTaskKey ? delegatedAgents : agents.filter((agent) => agent.role === 'authorized');
                  return (
                    <fieldset key={task.key} className="space-y-3 border border-mp-warm-grey p-4">
                      <legend className="px-2 text-sm font-semibold">Step {index + 1} · {task.key}</legend>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label>
                          <span className="mp-label">Task type</span>
                          <select
                            value={task.type}
                            onChange={(event) => updateTask(task.key, { type: event.target.value as WorkflowTaskType })}
                            className="mp-input mt-1"
                          >
                            {taskTypes.map((type) => <option key={type} value={type}>{statusLabel(type)}</option>)}
                          </select>
                        </label>
                        <label>
                          <span className="mp-label">Assigned agent</span>
                          <select
                            value={task.assignedAgentId}
                            onChange={(event) => updateTask(task.key, { assignedAgentId: event.target.value })}
                            required
                            className="mp-input mt-1"
                          >
                            <option value="">Choose an agent</option>
                            {eligibleAgents.map((agent) => (
                              <option key={agent.agentId} value={agent.agentId}>
                                {agent.displayName} · {agent.role}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span className="mp-label">Task title</span>
                          <input
                            value={task.title}
                            onChange={(event) => updateTask(task.key, { title: event.target.value })}
                            required
                            maxLength={120}
                            className="mp-input mt-1"
                          />
                        </label>
                        <label>
                          <span className="mp-label">Delegated from (optional)</span>
                          <select
                            value={task.parentTaskKey}
                            onChange={(event) => updateTask(task.key, {
                              parentTaskKey: event.target.value,
                              assignedAgentId: event.target.value
                                ? delegatedAgents[0]?.agentId ?? ''
                                : authorizedAgent?.agentId ?? '',
                            })}
                            className="mp-input mt-1"
                          >
                            <option value="">No delegated parent</option>
                            {draftTasks.filter((candidate) => candidate.key !== task.key).map((candidate) => (
                              <option key={candidate.key} value={candidate.key}>{candidate.key} · {candidate.title || candidate.type}</option>
                            ))}
                          </select>
                        </label>
                        <label className="sm:col-span-2">
                          <span className="mp-label">Depends on</span>
                          <select
                            multiple
                            value={task.dependsOn}
                            onChange={(event) => updateTask(task.key, {
                              dependsOn: [...event.currentTarget.selectedOptions].map((option) => option.value),
                            })}
                            className="mp-input mt-1 min-h-20"
                          >
                            {draftTasks.filter((candidate) => candidate.key !== task.key).map((candidate) => (
                              <option key={candidate.key} value={candidate.key}>{candidate.key} · {candidate.title || candidate.type}</option>
                            ))}
                          </select>
                          <span className="mt-1 block text-xs text-mp-medium-grey">
                            Hold this task until all selected tasks are reported complete.
                          </span>
                        </label>
                        <label className="sm:col-span-2">
                          <span className="mp-label">Instructions</span>
                          <textarea
                            value={task.description}
                            onChange={(event) => updateTask(task.key, { description: event.target.value })}
                            required
                            maxLength={2000}
                            rows={2}
                            className="mp-input mt-1"
                          />
                        </label>
                      </div>
                      {draftTasks.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeTask(task.key)}
                          className="text-xs font-semibold text-mp-medium-grey underline"
                        >
                          Remove step
                        </button>
                      )}
                    </fieldset>
                  );
                })}
                <Button type="button" variant="outline" disabled={draftTasks.length >= 25 || agents.length === 0} onClick={addTask}>
                  <Plus size={16} aria-hidden="true" /> Add task
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-mp-warm-grey pt-4">
                <p className="flex max-w-xl items-start gap-2 text-xs text-mp-medium-grey">
                  <ShieldCheck size={16} className="shrink-0" aria-hidden="true" />
                  Tasks revalidate the mandate version. Payment work must use the separate payment authorization and provider workflow.
                </p>
                <Button type="submit" disabled={busy || agents.length === 0}>
                  {busy ? 'Creating…' : 'Create workflow'}
                </Button>
              </div>
            </form>
          )}
        </section>

        <aside className="space-y-5">
          <h2 className="text-xl font-semibold">Recent workflows</h2>
          {loading ? (
            <p className="py-6 text-sm text-mp-medium-grey" role="status">Loading workflows…</p>
          ) : workflows.length === 0 ? (
            <p className="border border-mp-warm-grey bg-mp-surface p-5 text-sm text-mp-medium-grey">
              No workflows yet. Create one after activating an owner-approved mandate.
            </p>
          ) : (
            <ul className="divide-y divide-mp-warm-grey border border-mp-warm-grey bg-mp-surface">
              {workflows.map((workflow) => (
                <li key={workflow.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedWorkflowId(workflow.id)}
                    aria-current={selectedWorkflowId === workflow.id ? 'true' : undefined}
                    className={`w-full px-4 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-mp-orange ${
                      selectedWorkflowId === workflow.id ? 'bg-mp-app-bg' : 'hover:bg-mp-app-bg'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="font-semibold">{workflow.title}</span>
                      <span className="text-xs uppercase text-mp-medium-grey">{statusLabel(workflow.status)}</span>
                    </span>
                    <span className="mt-1 block text-xs text-mp-medium-grey">
                      {workflow.taskCount} tasks · updated {formatDate(workflow.updatedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {details && (
        <section className="space-y-5 border-t border-mp-warm-grey pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="mp-kicker">Workflow monitor</p>
              <h2 className="mt-1 text-2xl font-semibold">{details.workflow.title}</h2>
              <p className="mp-copy mt-2">{details.workflow.description}</p>
              <p className="mt-2 text-xs text-mp-medium-grey">
                Mandate version {details.workflow.mandateVersion} · Origin agent {details.workflow.originatingAgentId}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {details.workflow.status === 'active' && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => void runAction(
                  () => performWorkflowAction(details.workflow.id, 'pause'),
                  'Workflow paused.',
                )}>Pause</Button>
              )}
              {details.workflow.status === 'paused' && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => void runAction(
                  () => performWorkflowAction(details.workflow.id, 'resume'),
                  'Workflow resumed.',
                )}>Resume</Button>
              )}
              {!['completed', 'failed', 'cancelled'].includes(details.workflow.status) && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => void runAction(
                  () => performWorkflowAction(details.workflow.id, 'cancel'),
                  'Workflow cancelled.',
                )}>Cancel workflow</Button>
              )}
              <Button type="button" variant="outline" disabled={busy} onClick={() => void loadSelected()}>
                <RefreshCw size={15} aria-hidden="true" /> Reload detail
              </Button>
            </div>
          </div>
          <div className="space-y-2 border border-mp-warm-grey bg-mp-surface p-4">
            <div className="flex justify-between gap-3 text-sm">
              <span>{details.tasks.filter((task) => ['completed', 'handed_off'].includes(task.status)).length} of {details.tasks.length} tasks reported complete</span>
              <span>{taskProgress}%</span>
            </div>
            <div className="h-2 bg-mp-app-bg">
              <div className="h-full bg-mp-orange transition-all" style={{ width: `${taskProgress}%` }} />
            </div>
          </div>

          <label className="block max-w-xl">
            <span className="mp-label">Owner decision reason</span>
            <input value={ownerReason} onChange={(event) => setOwnerReason(event.target.value)} maxLength={500} className="mp-input mt-1" />
          </label>
          <div className="grid gap-5 lg:grid-cols-[1.4fr_0.8fr]">
            <div className="space-y-3">
              <h3 className="flex items-center gap-2 font-semibold"><Activity size={17} aria-hidden="true" /> Execution tasks</h3>
              {details.tasks.map((task) => (
                <article key={task.id} className="space-y-3 border border-mp-warm-grey bg-mp-surface p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase text-mp-medium-grey">{statusLabel(task.type)} · {task.key}</p>
                      <h4 className="mt-1 font-semibold">{task.title}</h4>
                    </div>
                    <span className="border border-mp-warm-grey px-2 py-1 text-xs uppercase">{statusLabel(task.status)}</span>
                  </div>
                  <p className="text-sm text-mp-medium-grey">{task.description}</p>
                  <p className="text-xs text-mp-medium-grey">
                    Agent: {agentNames.get(task.assignedAgentId) ?? task.assignedAgentId}
                    {task.delegatedFromAgentId ? ` · delegated from ${task.delegatedFromAgentId}` : ''}
                    {' · '}attempt {task.attempts}/{task.maxAttempts}
                    {task.leaseExpiresAt ? ` · lease ends ${formatDate(task.leaseExpiresAt)}` : ''}
                  </p>
                  {task.resultSummary && <p className="border-l-2 border-mp-orange pl-3 text-sm">{task.resultSummary}</p>}
                  {task.lastFailureReason && <p className="text-sm text-mp-medium-grey">Last failure: {task.lastFailureReason}</p>}
                  {task.type === 'payment' && (
                    <p className="flex items-start gap-2 text-xs text-mp-medium-grey">
                      <CircleAlert size={15} className="shrink-0" aria-hidden="true" />
                      Agent completion is only a report. Verify payment separately in Payments; this workflow cannot authorize or capture funds.
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {task.status === 'awaiting_human' && (
                      <Button type="button" variant="outline" disabled={busy || ownerReason.trim().length === 0} onClick={() => void runAction(
                        () => decideWorkflowTask(details.workflow.id, task.id, 'resume', ownerReason),
                        'Task returned to the queue.',
                      )}>Review and resume</Button>
                    )}
                    {['failed', 'timed_out'].includes(task.status) && task.ownerRetries < 3 && (
                      <Button type="button" variant="outline" disabled={busy || ownerReason.trim().length === 0} onClick={() => void runAction(
                        () => decideWorkflowTask(details.workflow.id, task.id, 'retry', ownerReason),
                        'Task retry authorized.',
                      )}>Retry</Button>
                    )}
                    {!['completed', 'handed_off', 'cancelled'].includes(task.status) && (
                      <Button type="button" variant="outline" disabled={busy || ownerReason.trim().length === 0} onClick={() => void runAction(
                        () => decideWorkflowTask(details.workflow.id, task.id, 'cancel', ownerReason),
                        'Task and its blocked dependents were cancelled.',
                      )}>Cancel task</Button>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <div className="space-y-3">
              <h3 className="font-semibold">Execution history</h3>
              <ol className="space-y-2 border-l border-mp-warm-grey pl-4">
                {details.events.map((event) => (
                  <li key={event.id} className="relative border-b border-mp-warm-grey pb-3 last:border-0">
                    <span className="absolute -left-[1.32rem] top-1 h-2 w-2 rounded-full bg-mp-orange" aria-hidden="true" />
                    <p className="text-sm font-medium">{statusLabel(event.action)}</p>
                    <p className="mt-1 text-xs text-mp-medium-grey">
                      {event.actorType} · {event.actorId} · {formatDate(event.createdAt)}
                    </p>
                    {event.reason && <p className="mt-1 text-xs text-mp-medium-grey">{event.reason}</p>}
                    {event.taskId && <p className="mt-1 text-xs text-mp-medium-grey">Task {event.taskId}</p>}
                  </li>
                ))}
                {details.events.length === 0 && <li className="text-sm text-mp-medium-grey">No execution events yet.</li>}
              </ol>
            </div>
          </div>
        </section>
      )}
    </section>
  );
}
