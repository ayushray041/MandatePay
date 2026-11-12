'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Copy,
  KeyRound,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Shield,
  Trash2,
} from 'lucide-react';
import { AgentRegistrationForm } from '@/components/negotiations/AgentRegistrationForm';
import { Button } from '@/components/ui/Button';
import {
  createAgentApiKey,
  getMyAgentProfile,
  listAgentActivity,
  listAgentApiKeys,
  listAgentSessions,
  listAgentWebhooks,
  registerAgentWebhook,
  revokeAgentApiKey,
  revokeAgentSession,
  revokeAgentWebhook,
  rotateAgentApiKey,
  updateAgentSecuritySettings,
  updateAgentStatus,
} from '@/lib/agents/client';
import type { AgentProfile } from '@/models/agent';
import type {
  AgentActivity,
  AgentApiScope,
  AgentApiKeyRecord,
  AgentSession,
  AgentWebhook,
} from '@/models/agent-iam';

function localDateTimeInDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : 'Not available';
}

export function AgentManagement() {
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [keys, setKeys] = useState<AgentApiKeyRecord[]>([]);
  const [activity, setActivity] = useState<AgentActivity[]>([]);
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [webhooks, setWebhooks] = useState<AgentWebhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const currentProfile = await getMyAgentProfile();
      setProfile(currentProfile);
      if (!currentProfile) {
        setKeys([]);
        setActivity([]);
        setSessions([]);
        setWebhooks([]);
        return;
      }
      const [currentKeys, currentActivity, currentSessions, currentWebhooks] = await Promise.all([
        listAgentApiKeys(),
        listAgentActivity(),
        listAgentSessions(),
        listAgentWebhooks(),
      ]);
      setKeys(currentKeys);
      setActivity(currentActivity);
      setSessions(currentSessions);
      setWebhooks(currentWebhooks);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Agent details could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      getMyAgentProfile(),
    ])
      .then(async ([currentProfile]) => {
        if (!active) return;
        setProfile(currentProfile);
        if (!currentProfile) return;
        const [currentKeys, currentActivity, currentSessions, currentWebhooks] = await Promise.all([
          listAgentApiKeys(),
          listAgentActivity(),
          listAgentSessions(),
          listAgentWebhooks(),
        ]);
        if (!active) return;
        setKeys(currentKeys);
        setActivity(currentActivity);
        setSessions(currentSessions);
        setWebhooks(currentWebhooks);
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Agent details could not be loaded.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await load();
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Agent settings could not be updated.');
    } finally {
      setBusy(false);
    }
  };

  const createKey = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const scopes: AgentApiScope[] = [];
    if (formData.get('scope-profile') === 'on') scopes.push('agent:profile:read');
    if (formData.get('scope-read') === 'on') scopes.push('mandates:read');
    if (formData.get('scope-authorize') === 'on') scopes.push('mandates:authorize');
    if (formData.get('scope-workflow-read') === 'on') scopes.push('workflows:read');
    if (formData.get('scope-workflow-execute') === 'on') scopes.push('workflows:execute');
    if (formData.get('scope-workflow-delegate') === 'on') scopes.push('workflows:delegate');
    const expiresAtValue = String(formData.get('expiresAt') ?? '');
    if (scopes.length === 0 || !expiresAtValue) {
      setError('Choose at least one permission and an expiration date.');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const issued = await createAgentApiKey({
        name: String(formData.get('name') ?? ''),
        scopes,
        expiresAt: new Date(expiresAtValue).toISOString(),
      });
      setIssuedSecret(issued.secret);
      setNotice('Credential created. Copy it now; it will not be shown again.');
      form.reset();
      await load();
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Agent credential could not be created.');
    } finally {
      setBusy(false);
    }
  };

  const rotateKey = async (key: AgentApiKeyRecord) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const issued = await rotateAgentApiKey(key.keyId);
      setIssuedSecret(issued.secret);
      setNotice('Credential rotated. The previous key is revoked; copy the new key now.');
      await load();
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Agent credential could not be rotated.');
    } finally {
      setBusy(false);
    }
  };

  const saveLimits = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    await runAction(
      () => updateAgentSecuritySettings({
        rateLimitPerMinute: Number(formData.get('rateLimitPerMinute')),
        dailyQuota: Number(formData.get('dailyQuota')),
      }),
      'Agent usage limits updated.',
    );
  };

  const createWebhook = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const events: ('mandate.authorization.created' | 'agent.status.changed')[] = [];
    if (formData.get('event-authorizations') === 'on') events.push('mandate.authorization.created');
    if (formData.get('event-status') === 'on') events.push('agent.status.changed');
    if (events.length === 0) {
      setError('Choose at least one webhook event.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await registerAgentWebhook({
        url: String(formData.get('url') ?? ''),
        events,
      });
      form.reset();
      setNotice('Webhook endpoint registered. Delivery is not enabled yet.');
      await load();
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Webhook could not be registered.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p role="status" className="py-12 text-center text-sm text-mp-medium-grey">Loading agent management…</p>;
  }

  return (
    <section className="mp-page mx-auto w-full max-w-7xl space-y-8">
      <header className="flex flex-col justify-between gap-5 border-b border-mp-warm-grey pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="mp-kicker">Agent identity and access</p>
          <h1 className="mp-page-title mt-2">Agent Management</h1>
          <p className="mp-copy mt-3 max-w-2xl">
            Manage the identity, scoped credentials, runtime status, and access history for your agent.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()} disabled={busy}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh
        </Button>
      </header>

      {error && <p className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="alert">{error}</p>}
      {notice && <p className="border-l-2 border-emerald-700 bg-mp-surface px-4 py-3 text-sm" role="status">{notice}</p>}

      {!profile && error ? (
        <div className="mp-empty-state space-y-4 px-6 py-10" role="alert">
          <p className="font-semibold">Agent profile status could not be verified</p>
          <p className="mp-copy">{error}</p>
          <Button type="button" onClick={() => void load()}>Try again</Button>
        </div>
      ) : !profile ? (
        <AgentRegistrationForm onRegistered={(registeredProfile) => {
          setProfile(registeredProfile);
          void load();
        }} />
      ) : (
        <>
          <section className="grid gap-4 border border-mp-warm-grey bg-mp-surface p-5 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-4">
              <p className="mp-kicker">Immutable agent identity</p>
              <h2 className="mt-1 break-all font-mono text-lg">{profile.agentId}</h2>
              <p className="mp-copy mt-2">
                Owned by account <span className="font-mono">{profile.ownerId}</span>. Ownership cannot be changed through agent APIs.
              </p>
            </div>
            <div>
              <p className="mp-kicker">Status</p>
              <p className="mt-1 font-semibold capitalize">{profile.status}</p>
            </div>
            <div>
              <p className="mp-kicker">Health</p>
              <p className="mt-1 font-semibold capitalize">{profile.healthStatus}</p>
              <p className="mt-1 text-xs text-mp-medium-grey">Last seen {formatDate(profile.lastSeenAt)}</p>
            </div>
            <div>
              <p className="mp-kicker">Profile version</p>
              <p className="mt-1 font-semibold">{profile.version}</p>
            </div>
            <div>
              <p className="mp-kicker">Runtime version</p>
              <p className="mt-1 font-semibold">{profile.runtimeVersion ?? 'Not reported'}</p>
            </div>
            <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-4">
              <Button
                type="button"
                variant={profile.status === 'active' ? 'outline' : 'primary'}
                disabled={busy}
                onClick={() => void runAction(
                  () => updateAgentStatus(profile.status === 'active' ? 'suspended' : 'active'),
                  profile.status === 'active' ? 'Agent suspended; API credentials are disabled.' : 'Agent activated.',
                )}
              >
                {profile.status === 'active' ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                {profile.status === 'active' ? 'Suspend agent' : 'Activate agent'}
              </Button>
              <p className="self-center text-xs text-mp-medium-grey">
                Suspension disables API keys. Reactivation restores unrevoked, unexpired keys; revoke compromised keys.
              </p>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-5 border border-mp-warm-grey bg-mp-surface p-5">
              <div>
                <p className="mp-kicker">Agent API credentials</p>
                <h2 className="mt-1 text-xl font-semibold">Scoped keys</h2>
                <p className="mp-copy mt-2">Secrets are shown once and only their keyed hash is stored. Keys expire within one year.</p>
              </div>
              {issuedSecret && (
                <div className="space-y-3 border border-mp-orange bg-mp-app-bg p-4" role="alert">
                  <p className="text-sm font-semibold">Copy this secret now. It cannot be recovered.</p>
                  <code className="block break-all font-mono text-sm">{issuedSecret}</code>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => {
                      void navigator.clipboard.writeText(issuedSecret)
                        .then(() => setNotice('Credential copied. Store it in a secure secret manager.'))
                        .catch(() => setError('Clipboard access failed. Select and copy the credential manually.'));
                    }}>
                      <Copy size={16} aria-hidden="true" /> Copy secret
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setIssuedSecret(null)}>
                      I saved it
                    </Button>
                  </div>
                </div>
              )}
              <form onSubmit={createKey} className="space-y-3 border-t border-mp-warm-grey pt-4">
                <label className="block">
                  <span className="mp-label">Credential name</span>
                  <input name="name" required maxLength={80} className="mp-input mt-1" placeholder="Production agent" />
                </label>
                <label className="block">
                  <span className="mp-label">Expiration</span>
                  <input name="expiresAt" type="datetime-local" required defaultValue={localDateTimeInDays(90)} className="mp-input mt-1" />
                </label>
                <fieldset className="space-y-2">
                  <legend className="mp-label">Permissions</legend>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="scope-profile" /> Read this agent’s profile and health status
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="scope-read" defaultChecked /> Read assigned mandates and authorization history
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="scope-authorize" /> Request operations within mandate policy
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="scope-workflow-read" /> Read assigned workflow tasks
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="scope-workflow-execute" /> Claim tasks and report progress
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="scope-workflow-delegate" /> Hand off tasks to mandate-approved agents
                  </label>
                  <p className="text-xs text-mp-medium-grey">
                    Workflow permissions never authorize payments, contracts, or mandate operations.
                  </p>
                </fieldset>
                <Button type="submit" disabled={busy}>
                  <Plus size={16} aria-hidden="true" /> Create credential
                </Button>
              </form>
              <ul className="divide-y divide-mp-warm-grey">
                {keys.map((key) => (
                  <li key={key.keyId} className="space-y-2 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">{key.name}</p>
                        <p className="font-mono text-xs text-mp-medium-grey">{key.prefix}</p>
                      </div>
                      <span className="text-xs font-semibold uppercase">{key.status}</span>
                    </div>
                    <p className="text-xs text-mp-medium-grey">
                      Permissions: {key.scopes.join(', ')} · Expires {formatDate(key.expiresAt)} · Last used {formatDate(key.lastUsedAt)}
                    </p>
                    {key.status === 'active' && (
                      <div className="flex gap-2">
                        <Button type="button" variant="outline" disabled={busy} onClick={() => void rotateKey(key)}>
                          <RotateCw size={15} aria-hidden="true" /> Rotate
                        </Button>
                        <Button type="button" variant="outline" disabled={busy} onClick={() => void runAction(
                          () => revokeAgentApiKey(key.keyId),
                          'Credential revoked immediately.',
                        )}>
                          <Trash2 size={15} aria-hidden="true" /> Revoke
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
                {keys.length === 0 && <li className="py-4 text-sm text-mp-medium-grey">No API credentials have been created.</li>}
              </ul>
            </div>

            <div className="space-y-5 border border-mp-warm-grey bg-mp-surface p-5">
              <div>
                <p className="mp-kicker">Usage controls</p>
                <h2 className="mt-1 text-xl font-semibold">Rate limits and quotas</h2>
                <p className="mp-copy mt-2">Counters are enforced atomically across all keys belonging to this agent.</p>
              </div>
              <form onSubmit={saveLimits} className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="mp-label">Requests per minute</span>
                  <input
                    name="rateLimitPerMinute"
                    type="number"
                    min={1}
                    max={600}
                    required
                    defaultValue={profile.rateLimitPerMinute}
                    className="mp-input mt-1"
                  />
                </label>
                <label>
                  <span className="mp-label">Daily request quota</span>
                  <input
                    name="dailyQuota"
                    type="number"
                    min={1}
                    max={100000}
                    required
                    defaultValue={profile.dailyQuota}
                    className="mp-input mt-1"
                  />
                </label>
                <div className="sm:col-span-2"><Button type="submit" disabled={busy}>Save usage limits</Button></div>
              </form>
              <div className="border-t border-mp-warm-grey pt-4">
                <p className="mp-kicker">Active API sessions</p>
                <ul className="mt-2 divide-y divide-mp-warm-grey">
                  {sessions.map((session) => (
                    <li key={session.sessionId} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div>
                        <p className="font-mono text-xs">{session.keyId}</p>
                        <p className="text-xs text-mp-medium-grey">Last seen {formatDate(session.lastSeenAt)} · {session.status}</p>
                      </div>
                      {session.status === 'active' && <Button type="button" variant="outline" disabled={busy} onClick={() => void runAction(
                        () => revokeAgentSession(session.sessionId),
                        'Session and its credential were revoked.',
                      )}>Revoke session</Button>}
                    </li>
                  ))}
                  {sessions.length === 0 && <li className="py-3 text-sm text-mp-medium-grey">No API sessions yet.</li>}
                </ul>
              </div>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4 border border-mp-warm-grey bg-mp-surface p-5">
              <div>
                <p className="mp-kicker">Capabilities</p>
                <h2 className="mt-1 text-xl font-semibold">Declared agent profile</h2>
                <p className="mp-copy mt-2">{profile.headline}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {profile.categories.map((category) => (
                  <span key={category} className="border border-mp-warm-grey px-2 py-1 text-xs">{category}</span>
                ))}
              </div>
              <ul className="space-y-3">
                {profile.capabilities.map((capability) => (
                  <li key={capability.category}>
                    <p className="text-sm font-semibold">{capability.category}</p>
                    <p className="text-sm text-mp-medium-grey">{capability.description}</p>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-mp-medium-grey">
                Supported currencies: {profile.supportedCurrencies.join(', ')} · Availability: {profile.availability}
              </p>
            </div>

            <div className="space-y-4 border border-mp-warm-grey bg-mp-surface p-5">
              <div>
                <p className="mp-kicker">Webhook registration</p>
                <h2 className="mt-1 text-xl font-semibold">Event endpoints</h2>
                <p className="mp-copy mt-2">HTTPS URLs only. Registration is stored; event delivery is not enabled yet.</p>
              </div>
              <form onSubmit={createWebhook} className="space-y-3">
                <label className="block">
                  <span className="mp-label">HTTPS endpoint</span>
                  <input name="url" type="url" required className="mp-input mt-1" placeholder="https://example.com/agent-events" />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="event-authorizations" defaultChecked /> Mandate authorization created
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="event-status" /> Agent status changed
                </label>
                <Button type="submit" disabled={busy}>Register webhook</Button>
              </form>
              <ul className="divide-y divide-mp-warm-grey">
                {webhooks.map((webhook) => (
                  <li key={webhook.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{webhook.url}</p>
                      <p className="text-xs text-mp-medium-grey">{webhook.events.join(', ')} · {webhook.status}</p>
                    </div>
                    {webhook.status === 'active' && <Button type="button" variant="outline" disabled={busy} onClick={() => void runAction(
                      () => revokeAgentWebhook(webhook.id),
                      'Webhook endpoint revoked.',
                    )}><Trash2 size={15} aria-hidden="true" /> Revoke</Button>}
                  </li>
                ))}
                {webhooks.length === 0 && <li className="py-3 text-sm text-mp-medium-grey">No webhook endpoints registered.</li>}
              </ul>
            </div>
          </section>

          <section className="space-y-4 border border-mp-warm-grey bg-mp-surface p-5">
            <div className="flex items-center gap-2">
              <Activity size={18} aria-hidden="true" />
              <div>
                <p className="mp-kicker">Audit trail</p>
                <h2 className="text-xl font-semibold">Recent activity and security events</h2>
              </div>
            </div>
            <ul className="divide-y divide-mp-warm-grey">
              {activity.map((event) => (
                <li key={event.id} className="grid gap-1 py-3 sm:grid-cols-[1fr_auto]">
                  <div>
                    <p className="font-medium">{event.action}</p>
                    <p className="break-all font-mono text-xs text-mp-medium-grey">
                      {[event.method, event.path, event.scope].filter(Boolean).join(' · ') || JSON.stringify(event.details)}
                    </p>
                  </div>
                  <time className="text-xs text-mp-medium-grey">{formatDate(event.createdAt)}</time>
                </li>
              ))}
              {activity.length === 0 && <li className="py-3 text-sm text-mp-medium-grey">No agent activity has been recorded.</li>}
            </ul>
          </section>

          <p className="flex items-center gap-2 text-xs text-mp-medium-grey">
            <Shield size={14} aria-hidden="true" /> Agent API keys can call only the scopes shown; Firebase user APIs require a separate Firebase ID token.
            <KeyRound size={14} aria-hidden="true" />
          </p>
        </>
      )}
    </section>
  );
}
