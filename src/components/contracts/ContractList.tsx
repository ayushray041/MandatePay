'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, FileText } from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { Button } from '@/components/ui/Button';
import { formatMinorAmount } from '@/lib/mandates/money';
import { generateContract, listContracts } from '@/lib/contracts/client';
import { listNegotiations } from '@/lib/negotiations/client';
import type { ContractRecord } from '@/models/contract';
import type { NegotiationRecord } from '@/models/negotiation';

const statusClassNames: Record<ContractRecord['status'], string> = {
  pending_review: 'border-amber-700 bg-amber-50 text-amber-900',
  active: 'border-emerald-700 bg-emerald-50 text-emerald-800',
  rejected: 'border-red-700 bg-red-50 text-red-800',
  expired: 'border-mp-warm-grey bg-mp-app-bg text-mp-medium-grey',
};

export function ContractList() {
  const router = useRouter();
  const { user } = useAuth();
  const [contracts, setContracts] = useState<ContractRecord[]>([]);
  const [negotiations, setNegotiations] = useState<NegotiationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([listContracts(), listNegotiations()])
      .then(([nextContracts, nextNegotiations]) => {
        if (active) {
          setContracts(nextContracts);
          setNegotiations(nextNegotiations);
          setError(null);
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Contract workspace could not be loaded.');
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
  }, []);

  const existingNegotiations = new Set(contracts.map((contract) => contract.negotiationId));
  const acceptedNegotiations = negotiations.filter((negotiation) => (
    negotiation.status === 'accepted'
    && !existingNegotiations.has(negotiation.id)
    && (negotiation.initiatorAgentId === user?.uid || negotiation.recipientAgentId === user?.uid)
  ));

  const generate = async (negotiationId: string) => {
    setGeneratingId(negotiationId);
    setError(null);
    try {
      const contract = await generateContract(negotiationId);
      router.push(`/contracts/${encodeURIComponent(contract.id)}`);
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : 'Contract could not be generated.');
      setGeneratingId(null);
    }
  };

  return (
    <section className="mp-page mx-auto w-full max-w-7xl space-y-8">
      <header className="border-b border-mp-warm-grey pb-6">
        <p className="mp-kicker">Contract lifecycle</p>
        <h1 className="mp-page-title mt-2">Contracts</h1>
        <p className="mp-copy mt-3 max-w-2xl">
          Review a versioned record of accepted negotiation terms. Contract records do not provide
          legal advice or digital signatures.
        </p>
      </header>

      {error && (
        <p className="border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="alert">
          {error}
          <Button type="button" variant="outline" className="ml-4" onClick={() => location.reload()}>
            Retry
          </Button>
        </p>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-mp-medium-grey" role="status">Loading contracts…</p>
      ) : (
        <>
          {acceptedNegotiations.length > 0 && (
            <section className="border-l-2 border-mp-orange pl-5">
              <h2 className="text-lg font-semibold">Accepted negotiations</h2>
              <p className="mp-copy mt-1 text-sm">Generate a reviewable contract record from an accepted negotiation.</p>
              <ul className="mt-4 grid gap-3 md:grid-cols-2">
                {acceptedNegotiations.map((negotiation) => (
                  <li key={negotiation.id} className="flex items-center justify-between gap-4 border border-mp-warm-grey bg-mp-surface p-4">
                    <div>
                      <p className="font-semibold">{negotiation.title}</p>
                      {negotiation.currentOffer && (
                        <p className="mt-1 text-sm text-mp-medium-grey">
                          {formatMinorAmount(
                            negotiation.currentOffer.terms.amountMinor,
                            negotiation.currentOffer.terms.currency,
                          )}
                        </p>
                      )}
                    </div>
                    <Button type="button" onClick={() => void generate(negotiation.id)} disabled={generatingId !== null}>
                      {generatingId === negotiation.id ? 'Generating…' : 'Generate'}
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="contract-register-heading" className="space-y-4">
            <div className="flex items-end justify-between border-b border-mp-warm-grey pb-3">
              <div>
                <p className="mp-kicker">Contract register</p>
                <h2 id="contract-register-heading" className="mt-1 text-xl font-semibold">Your records</h2>
              </div>
              <span className="text-sm text-mp-medium-grey">{contracts.length} total</span>
            </div>
            {contracts.length === 0 ? (
              <div className="mp-empty-state px-6 py-10 text-center">
                <FileText size={25} className="mx-auto text-mp-medium-grey" aria-hidden="true" />
                <h3 className="mt-3 font-semibold">No contract records yet</h3>
                <p className="mp-copy mt-1">Contracts appear here after generation from an accepted negotiation.</p>
              </div>
            ) : (
              <ul className="grid gap-3">
                {contracts.map((contract) => (
                  <li key={contract.id} className="flex flex-wrap items-center justify-between gap-4 border border-mp-warm-grey bg-mp-surface p-4 sm:p-5">
                    <div>
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="font-semibold">Negotiation {contract.negotiationId}</h3>
                        <span className={`border px-2 py-1 text-xs font-semibold uppercase ${statusClassNames[contract.status]}`}>
                          {contract.status.replaceAll('_', ' ')}
                        </span>
                      </div>
                      <p className="mt-2 text-sm text-mp-medium-grey">
                        Version {contract.currentVersion} · {contract.approvals.length}/{contract.requiredApproverIds.length} approvals
                      </p>
                    </div>
                    <Link
                      href={`/contracts/${encodeURIComponent(contract.id)}`}
                      className="inline-flex min-h-10 items-center gap-2 font-semibold underline decoration-mp-orange decoration-2 underline-offset-4"
                    >
                      Open document <ArrowRight size={16} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}
