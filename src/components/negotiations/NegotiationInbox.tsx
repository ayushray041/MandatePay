'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, RefreshCw, Users } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { AgentRegistrationForm } from '@/components/negotiations/AgentRegistrationForm';
import { Button } from '@/components/ui/Button';
import { discoverAgents, getMyAgentProfile } from '@/lib/agents/client';
import { createNegotiation, listNegotiations } from '@/lib/negotiations/client';
import { listMandates } from '@/lib/mandates/client';
import { formatMinorAmount } from '@/lib/mandates/money';
import { agentCategories, type AgentProfile } from '@/models/agent';
import { type MandateRecord } from '@/models/mandate';
import { type NegotiationRecord, type NegotiationStatus } from '@/models/negotiation';

const statusStyles: Record<NegotiationStatus, string> = {
  initiated: 'border-blue-700 bg-blue-50 text-blue-800',
  offer_submitted: 'border-amber-700 bg-amber-50 text-amber-900',
  counter_offered: 'border-violet-700 bg-violet-50 text-violet-800',
  pending_owner_approval: 'border-orange-700 bg-orange-50 text-orange-900',
  accepted: 'border-emerald-700 bg-emerald-50 text-emerald-800',
  rejected: 'border-red-700 bg-red-50 text-red-800',
  expired: 'border-mp-warm-grey bg-mp-app-bg text-mp-medium-grey',
  cancelled: 'border-mp-warm-grey bg-mp-app-bg text-mp-medium-grey',
};

export function NegotiationInbox() {
  const router = useRouter();
  const { user } = useAuth();
  const [agentProfile, setAgentProfile] = useState<AgentProfile | null>(null);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [mandates, setMandates] = useState<MandateRecord[]>([]);
  const [negotiations, setNegotiations] = useState<NegotiationRecord[]>([]);
  const [category, setCategory] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [profile, discoveredAgents, activeMandates, inbox] = await Promise.all([
        getMyAgentProfile(),
        discoverAgents(category || undefined),
        listMandates(),
        listNegotiations(),
      ]);
      setError(null);
      setAgentProfile(profile);
      setAgents(discoveredAgents);
      setMandates(activeMandates);
      setNegotiations(inbox);
      setSelectedAgentId((selected) => (
        discoveredAgents.some((agent) => agent.uid === selected) ? selected : ''
      ));
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Negotiation inbox could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    let active = true;
    Promise.all([
      getMyAgentProfile(),
      discoverAgents(category || undefined),
      listMandates(),
      listNegotiations(),
    ])
      .then(([profile, discoveredAgents, activeMandates, inbox]) => {
        if (!active) {
          return;
        }
        setError(null);
        setAgentProfile(profile);
        setAgents(discoveredAgents);
        setMandates(activeMandates);
        setNegotiations(inbox);
        setSelectedAgentId((selected) => (
          discoveredAgents.some((agent) => agent.uid === selected) ? selected : ''
        ));
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Negotiation inbox could not be loaded.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [category]);

  const availableMandates = mandates.filter((mandate) => (
    mandate.authorizedAgentId === user?.uid
    && mandate.status === 'active'
  ));
  const hasOwnerApprovalTasks = negotiations.some((negotiation) => (
    negotiation.status === 'pending_owner_approval'
    && negotiation.ownerApprovalRequiredForViewer
  ));

  const refresh = () => {
    setLoading(true);
    void load();
  };

  const startNegotiation = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const mandateId = String(formData.get('mandateId') ?? '');
    const title = String(formData.get('title') ?? '');
    const expiresAt = String(formData.get('expiresAt') ?? '');
    if (!selectedAgentId || !availableMandates.some((mandate) => mandate.id === mandateId)) {
      setError('Choose an agent and one of your active agent mandates.');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const negotiation = await createNegotiation({
        mandateId,
        recipientAgentId: selectedAgentId,
        title,
        expiresAt: new Date(expiresAt).toISOString(),
      });
      router.push(`/negotiations/${encodeURIComponent(negotiation.id)}`);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Negotiation request could not be sent.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="mp-page mx-auto w-full max-w-7xl space-y-8">
      <header className="flex flex-col justify-between gap-5 border-b border-mp-warm-grey pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="mp-kicker">Agent-to-agent commerce</p>
          <h1 className="mp-page-title mt-2">Negotiations</h1>
          <p className="mp-copy mt-3 max-w-2xl">
            Exchange service offers and counteroffers within each agent’s active mandate.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh inbox
        </Button>
      </header>

      {error && (
        <p className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-mp-medium-grey" role="status" aria-live="polite">
          Loading your negotiation workspace…
        </p>
      ) : (
        <>
          {!agentProfile ? (
            <div className="space-y-5">
              {hasOwnerApprovalTasks && (
                <p className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm">
                  You can review the owner-approval requests below without registering as an agent.
                </p>
              )}
              <AgentRegistrationForm onRegistered={(profile) => setAgentProfile(profile)} />
            </div>
          ) : (
            <section className="grid gap-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(19rem,0.65fr)]">
              <div className="space-y-5">
                <div className="flex flex-wrap items-end justify-between gap-4">
                  <div>
                    <p className="mp-kicker">Agent directory</p>
                    <h2 className="mt-1 text-xl font-semibold">Discover a counterpart</h2>
                  </div>
                  <label>
                    <span className="sr-only">Filter agents by category</span>
                    <select
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                      className="mp-input min-w-44"
                    >
                      <option value="">All categories</option>
                      {agentCategories.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                  </label>
                </div>

                {agents.length === 0 ? (
                  <div className="mp-empty-state px-6 py-10 text-center">
                    <Users size={24} className="mx-auto text-mp-orange" aria-hidden="true" />
                    <h3 className="mt-3 font-semibold">No other agents found</h3>
                    <p className="mp-copy mt-1">Try another category or return when more agents register.</p>
                  </div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {agents.map((agent) => (
                      <article
                        key={agent.uid}
                        className={`border bg-mp-surface p-5 ${selectedAgentId === agent.uid ? 'border-mp-orange' : 'border-mp-warm-grey'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-semibold">{agent.displayName}</h3>
                            <p className="mt-1 text-sm text-mp-medium-grey">{agent.headline}</p>
                          </div>
                          <span className={`border px-2 py-1 text-xs ${agent.availability === 'available' ? 'border-emerald-700 text-emerald-800' : 'border-mp-warm-grey text-mp-medium-grey'}`}>
                            {agent.availability}
                          </span>
                        </div>
                        <p className="mp-copy mt-3 line-clamp-3 text-sm">{agent.bio}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {agent.categories.map((item) => (
                            <span key={item} className="bg-mp-app-bg px-2 py-1 text-xs">{item}</span>
                          ))}
                          {agent.supportedCurrencies.map((currencyCode) => (
                            <span key={currencyCode} className="border border-mp-warm-grey px-2 py-1 text-xs">
                              {currencyCode}
                            </span>
                          ))}
                        </div>
                        <Button
                          type="button"
                          variant={selectedAgentId === agent.uid ? 'secondary' : 'outline'}
                          className="mt-4 w-full"
                          onClick={() => setSelectedAgentId(agent.uid)}
                        >
                          {selectedAgentId === agent.uid ? 'Selected counterpart' : 'Start negotiation'}
                        </Button>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <aside className="h-fit border-l-2 border-mp-orange pl-5">
                <p className="mp-kicker">New request</p>
                <h2 className="mt-2 text-xl font-semibold">Open a negotiation</h2>
                <p className="mp-copy mt-2 text-sm">
                  Choose one of your active mandates. The invited agent selects their own private
                  mandate when they respond.
                </p>
                {availableMandates.length === 0 ? (
                  <p className="mt-4 border border-mp-warm-grey bg-mp-surface p-3 text-sm">
                    No active agent mandates available. Activate a mandate assigned to your account first.
                  </p>
                ) : (
                  <form onSubmit={startNegotiation} className="mt-4 space-y-4">
                    <label className="block">
                      <span className="mp-label">Your active mandate</span>
                      <select name="mandateId" required className="mp-input mt-1">
                        {availableMandates.map((mandate) => (
                          <option key={mandate.id} value={mandate.id}>
                            {mandate.title} · {mandate.currency}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="mp-label">Negotiation title</span>
                      <input name="title" required minLength={3} maxLength={120} className="mp-input mt-1" />
                    </label>
                    <label className="block">
                      <span className="mp-label">Request expires</span>
                      <input
                        name="expiresAt"
                        type="datetime-local"
                        required
                        className="mp-input mt-1"
                      />
                      <span className="mt-1 block text-xs text-mp-medium-grey">Expiry must be within 30 days.</span>
                    </label>
                    <Button type="submit" className="w-full" disabled={creating || !selectedAgentId}>
                      {creating ? 'Sending request…' : 'Send negotiation request'}
                    </Button>
                  </form>
                )}
              </aside>
            </section>
          )}

          <section aria-labelledby="negotiation-inbox-heading" className="space-y-4">
            <div className="flex items-end justify-between gap-4 border-b border-mp-warm-grey pb-3">
              <div>
                <p className="mp-kicker">Your activity</p>
                <h2 id="negotiation-inbox-heading" className="mt-1 text-xl font-semibold">Negotiation inbox</h2>
              </div>
              <span className="text-sm text-mp-medium-grey">{negotiations.length} total</span>
            </div>
            {negotiations.length === 0 ? (
              <div className="mp-empty-state px-6 py-10 text-center">
                <h3 className="font-semibold">No negotiations yet</h3>
                <p className="mp-copy mt-1">Requests and offers will appear here. No sample activity is shown.</p>
              </div>
            ) : (
              <div className="grid gap-3">
                {negotiations.map((negotiation) => {
                  const counterpartId = negotiation.initiatorAgentId === user?.uid
                    ? negotiation.recipientAgentId
                    : negotiation.initiatorAgentId;
                  const counterpart = agents.find((agent) => agent.uid === counterpartId);
                  const needsOwnerReview = negotiation.status === 'pending_owner_approval'
                    && negotiation.ownerApprovalRequiredForViewer
                    && !negotiation.ownerApprovalRecordedForViewer;
                  return (
                    <article key={negotiation.id} className="flex flex-wrap items-center justify-between gap-4 border border-mp-warm-grey bg-mp-surface p-4 sm:p-5">
                      <div>
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="font-semibold">{negotiation.title}</h3>
                          <span className={`border px-2 py-1 text-xs font-semibold uppercase ${statusStyles[negotiation.status]}`}>
                            {negotiation.status.replaceAll('_', ' ')}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-mp-medium-grey">
                          With {counterpart?.displayName ?? `agent ${counterpartId}`}
                          {' · '}Expires {new Date(negotiation.expiresAt).toLocaleString()}
                        </p>
                        {needsOwnerReview && (
                          <p className="mt-1 text-sm font-semibold text-orange-900">
                            Your approval is needed before either mandate reserves budget.
                          </p>
                        )}
                        {negotiation.currentOffer && (
                          <p className="mt-1 text-sm text-mp-medium-grey">
                            Latest offer: {formatMinorAmount(
                              negotiation.currentOffer.terms.amountMinor,
                              negotiation.currentOffer.terms.currency,
                            )}
                          </p>
                        )}
                      </div>
                      <Link
                        href={`/negotiations/${encodeURIComponent(negotiation.id)}`}
                        className="inline-flex min-h-10 items-center gap-2 font-semibold underline decoration-mp-orange decoration-2 underline-offset-4"
                      >
                        Open details <ArrowRight size={16} aria-hidden="true" />
                      </Link>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
