'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, RefreshCw, Users } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { AgentRegistrationForm } from '@/components/negotiations/AgentRegistrationForm';
import { Button } from '@/components/ui/Button';
import { discoverAgents, getMyAgentProfile } from '@/lib/agents/client';
import {
  createNegotiation,
  createNegotiationBatch,
  getNegotiationBatchComparison,
  getNegotiationAnalytics,
  getNegotiationStrategy,
  listNegotiations,
  saveNegotiationStrategy,
} from '@/lib/negotiations/client';
import { listMandates } from '@/lib/mandates/client';
import { formatMinorAmount } from '@/lib/mandates/money';
import { agentCategories, type AgentDiscoveryProfile, type AgentProfile } from '@/models/agent';
import { type MandateRecord } from '@/models/mandate';
import { type NegotiationRecord, type NegotiationStatus } from '@/models/negotiation';
import type { NegotiationStrategyProfile } from '@/models/negotiation';

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
const strategyPriorities: NegotiationStrategyProfile['priorities'] = [
  'price',
  'delivery',
  'sla',
  'flexibility',
  'certainty',
];

export function NegotiationInbox() {
  const router = useRouter();
  const { user, profile: userProfile } = useAuth();
  const [agentProfile, setAgentProfile] = useState<AgentProfile | null>(null);
  const [agents, setAgents] = useState<AgentDiscoveryProfile[]>([]);
  const [mandates, setMandates] = useState<MandateRecord[]>([]);
  const [negotiations, setNegotiations] = useState<NegotiationRecord[]>([]);
  const [category, setCategory] = useState('');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [batchComparison, setBatchComparison] = useState<Awaited<ReturnType<typeof getNegotiationBatchComparison>> | null>(null);
  const [comparisonBusy, setComparisonBusy] = useState(false);
  const [strategy, setStrategy] = useState<NegotiationStrategyProfile | null>(null);
  const [strategySaving, setStrategySaving] = useState(false);
  const [analytics, setAnalytics] = useState<Awaited<ReturnType<typeof getNegotiationAnalytics>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextAgentProfile, discoveredAgents, activeMandates, inbox] = await Promise.all([
        userProfile?.role === 'freelancer' ? getMyAgentProfile() : Promise.resolve(null),
        userProfile?.role === 'freelancer' ? discoverAgents(category || undefined) : Promise.resolve([]),
        listMandates(),
        listNegotiations(),
      ]);
      setError(null);
      setAgentProfile(nextAgentProfile);
      setAgents(discoveredAgents);
      setMandates(activeMandates);
      setNegotiations(inbox);
      setSelectedAgentIds((selected) => selected.filter((id) => discoveredAgents.some((agent) => agent.uid === id)));
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Negotiation inbox could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [category, userProfile]);

  useEffect(() => {
    if (userProfile?.role !== 'freelancer') {
      return;
    }

    let active = true;
    Promise.all([getNegotiationStrategy(), getNegotiationAnalytics()])
      .then(([profile, summary]) => {
        if (active) {
          setStrategy(profile);
          setAnalytics(summary);
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Negotiation insights could not be loaded.');
        }
      });
    return () => {
      active = false;
    };
  }, [userProfile]);

  useEffect(() => {
    let active = true;
    Promise.all([
      userProfile?.role === 'freelancer' ? getMyAgentProfile() : Promise.resolve(null),
      userProfile?.role === 'freelancer' ? discoverAgents(category || undefined) : Promise.resolve([]),
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
        setSelectedAgentIds((selected) => selected.filter((id) => discoveredAgents.some((agent) => agent.uid === id)));
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
  }, [category, userProfile]);

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
    if (selectedAgentIds.length === 0 || !availableMandates.some((mandate) => mandate.id === mandateId)) {
      setError('Choose at least one agent and one of your active agent mandates.');
      return;
    }

    setCreating(true);
    setError(null);
    try {
      if (selectedAgentIds.length === 1) {
        const negotiation = await createNegotiation({
          mandateId,
          recipientAgentId: selectedAgentIds[0],
          title,
          expiresAt: new Date(expiresAt).toISOString(),
        });
        router.push(`/negotiations/${encodeURIComponent(negotiation.id)}`);
      } else {
        const batch = await createNegotiationBatch({
          mandateId,
          recipientAgentIds: selectedAgentIds,
          title,
          expiresAt: new Date(expiresAt).toISOString(),
        });
        router.push(`/negotiations/${encodeURIComponent(batch.negotiations[0].id)}`);
      }
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Negotiation request could not be sent.');
    } finally {
      setCreating(false);
    }
  };

  const compareBatch = async (batchId: string) => {
    setComparisonBusy(true);
    setError(null);
    try {
      setBatchComparison(await getNegotiationBatchComparison(batchId));
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Vendor comparison could not be loaded.');
    } finally {
      setComparisonBusy(false);
    }
  };

  const toggleAgentSelection = (agentId: string) => {
    setSelectedAgentIds((selected) => {
      if (selected.includes(agentId)) {
        return selected.filter((id) => id !== agentId);
      }
      if (selected.length >= 10) {
        setError('A comparison batch can include at most 10 agents.');
        return selected;
      }
      return [...selected, agentId];
    });
  };

  const saveStrategy = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!strategy) {
      return;
    }
    setStrategySaving(true);
    setError(null);
    try {
      await saveNegotiationStrategy(strategy);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Negotiation strategy could not be saved.');
    } finally {
      setStrategySaving(false);
    }
  };

  return (
    <section className="mp-page mx-auto w-full max-w-7xl space-y-8">
      <header className="flex flex-col justify-between gap-5 border-b border-mp-warm-grey pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="mp-kicker">{userProfile?.role === 'client' ? 'Mandate owner approvals' : 'Agent-to-agent commerce'}</p>
          <h1 className="mp-page-title mt-2">Negotiations</h1>
          <p className="mp-copy mt-3 max-w-2xl">
            {userProfile?.role === 'client'
              ? 'Review negotiation offers that are explicitly awaiting your mandate-owner approval.'
              : 'Exchange service offers and counteroffers within each agent’s active mandate.'}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw size={16} aria-hidden="true" /> Refresh inbox
        </Button>
      </header>

      {analytics && (
        <section className="grid gap-4 border border-mp-warm-grey bg-mp-surface p-4 sm:grid-cols-4" aria-label="Negotiation analytics">
          <div><p className="mp-kicker">Sampled negotiations</p><p className="mt-1 text-xl font-semibold">{analytics.sampleSize}{analytics.windowTruncated ? '+' : ''}</p></div>
          <div><p className="mp-kicker">Average offers</p><p className="mt-1 text-xl font-semibold">{analytics.averageOffersPerNegotiation.toFixed(1)}</p></div>
          <div><p className="mp-kicker">Acceptance rate</p><p className="mt-1 text-xl font-semibold">{analytics.acceptanceRate === null ? '—' : `${Math.round(analytics.acceptanceRate * 100)}%`}</p></div>
          <div><p className="mp-kicker">Average resolution</p><p className="mt-1 text-xl font-semibold">{analytics.averageResolutionMs === null ? '—' : `${(analytics.averageResolutionMs / 86_400_000).toFixed(1)} days`}</p></div>
        </section>
      )}

      {strategy && (
        <form onSubmit={saveStrategy} className="grid gap-4 border border-mp-warm-grey bg-mp-surface p-4 md:grid-cols-[12rem_minmax(0,1fr)_12rem_auto] md:items-end">
          <label>
            <span className="mp-label">Negotiation posture</span>
            <select value={strategy.posture} onChange={(event) => setStrategy({ ...strategy, posture: event.target.value as NegotiationStrategyProfile['posture'] })} className="mp-input mt-1">
              <option value="collaborative">Collaborative</option>
              <option value="balanced">Balanced</option>
              <option value="assertive">Assertive</option>
            </select>
          </label>
          <fieldset>
            <legend className="mp-label">Priorities for advisory suggestions</legend>
            <div className="mt-2 flex flex-wrap gap-3">
              {strategyPriorities.map((priority) => (
                <label key={priority} className="inline-flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={strategy.priorities.includes(priority)}
                    onChange={(event) => setStrategy({
                      ...strategy,
                      priorities: event.target.checked
                        ? [...strategy.priorities, priority].slice(0, 5)
                        : strategy.priorities.length > 1
                          ? strategy.priorities.filter((item) => item !== priority)
                          : strategy.priorities,
                    })}
                  />
                  {priority}
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            <span className="mp-label">Concession step (basis points)</span>
            <input type="number" min="0" max="5000" value={strategy.concessionStepBasisPoints} onChange={(event) => setStrategy({ ...strategy, concessionStepBasisPoints: Number(event.target.value) })} className="mp-input mt-1" />
          </label>
          <Button type="submit" disabled={strategySaving}>{strategySaving ? 'Saving…' : 'Save strategy'}</Button>
          <p className="text-xs text-mp-medium-grey md:col-span-4">Strategy settings guide advisory AI output only; they never change mandate permissions or authorize transactions.</p>
        </form>
      )}

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
          {userProfile?.role === 'client' ? (
            <div className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm">
              This view contains only negotiations the server has authorized your account to review.
              New negotiation requests are created by participating freelancer agents.
            </div>
          ) : !agentProfile ? (
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
                        className={`border bg-mp-surface p-5 ${selectedAgentIds.includes(agent.uid) ? 'border-mp-orange' : 'border-mp-warm-grey'}`}
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
                          variant={selectedAgentIds.includes(agent.uid) ? 'secondary' : 'outline'}
                          className="mt-4 w-full"
                          onClick={() => toggleAgentSelection(agent.uid)}
                        >
                          {selectedAgentIds.includes(agent.uid) ? 'Remove from comparison batch' : 'Select for negotiation'}
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
                  Select up to 10 vendors. Each receives an independent negotiation; decisions and
                  budget reservations remain separate.
                </p>
                <p className="mt-2 text-sm font-semibold">Selected vendors: {selectedAgentIds.length}/10</p>
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
                    <Button type="submit" className="w-full" disabled={creating || selectedAgentIds.length === 0}>
                      {creating ? 'Sending request…' : selectedAgentIds.length > 1 ? 'Start independent negotiations' : 'Send negotiation request'}
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
            {batchComparison && (
              <section className="space-y-3 border border-mp-orange bg-mp-surface p-4" aria-label="Vendor offer comparison">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Independent vendor comparison</h3>
                  <Button type="button" variant="outline" onClick={() => setBatchComparison(null)}>Close</Button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead><tr><th className="py-2 pr-3">Vendor</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3">Latest price</th><th className="py-2 pr-3">Delivery</th><th className="py-2">Offers</th></tr></thead>
                    <tbody>{batchComparison.entries.map((entry) => (
                      <tr key={entry.negotiationId} className="border-t border-mp-warm-grey">
                        <td className="py-2 pr-3"><Link className="underline" href={`/negotiations/${encodeURIComponent(entry.negotiationId)}`}>{entry.recipientDisplayName}</Link></td>
                        <td className="py-2 pr-3">{entry.status.replaceAll('_', ' ')}</td>
                        <td className="py-2 pr-3">{entry.latestOffer ? formatMinorAmount(entry.latestOffer.amountMinor, entry.latestOffer.currency) : 'Awaiting offer'}</td>
                        <td className="py-2 pr-3">{entry.latestOffer ? `${entry.latestOffer.deliveryDays} days` : '—'}</td>
                        <td className="py-2">{entry.offerCount}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              </section>
            )}
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
                      <div className="flex flex-wrap items-center gap-4">
                        {negotiation.batchSize && negotiation.batchSize > 1
                          && negotiation.batchIndex === 0
                          && negotiation.initiatorAgentId === user?.uid
                          && negotiation.batchId && (
                            <Button type="button" variant="outline" disabled={comparisonBusy} onClick={() => negotiation.batchId && void compareBatch(negotiation.batchId)}>
                              {comparisonBusy ? 'Loading…' : 'Compare vendor responses'}
                            </Button>
                          )}
                        <Link
                          href={`/negotiations/${encodeURIComponent(negotiation.id)}`}
                          className="inline-flex min-h-10 items-center gap-2 font-semibold underline decoration-mp-orange decoration-2 underline-offset-4"
                        >
                          Open details <ArrowRight size={16} aria-hidden="true" />
                        </Link>
                      </div>
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
