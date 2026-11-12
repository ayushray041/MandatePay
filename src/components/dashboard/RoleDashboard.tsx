'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowRight,
  BriefcaseBusiness,
  FileCheck2,
  FileText,
  Inbox,
  Search,
  Settings,
  ShieldCheck,
  Store,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/components/providers/AuthProvider';
import { listContracts } from '@/lib/contracts/client';
import { listMandates } from '@/lib/mandates/client';
import { listNegotiations } from '@/lib/negotiations/client';
import { formatMinorAmount } from '@/lib/mandates/money';
import { listPayments } from '@/lib/payments/client';
import type { ContractRecord } from '@/models/contract';
import type { MandateRecord } from '@/models/mandate';
import type { NegotiationRecord } from '@/models/negotiation';
import type { PaymentRecord } from '@/models/payment';
import type { UserProfile } from '@/models/user';

type DashboardData = {
  mandates: MandateRecord[];
  negotiations: NegotiationRecord[];
  contracts: ContractRecord[];
  payments: PaymentRecord[];
};

const terminalNegotiationStatuses = new Set([
  'accepted',
  'rejected',
  'expired',
  'cancelled',
]);

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: ReactNode;
  detail: string;
}) {
  return (
    <article className="border border-mp-warm-grey bg-mp-surface p-5">
      <p className="mp-kicker">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-mp-medium-grey">{detail}</p>
    </article>
  );
}

function DashboardLink({
  href,
  title,
  description,
  icon: Icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: typeof BriefcaseBusiness;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-20 items-center gap-4 border border-mp-warm-grey bg-mp-surface p-4 transition-colors hover:bg-mp-app-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-mp-orange sm:p-5"
    >
      <Icon className="shrink-0 text-mp-orange" size={20} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="mt-1 block text-sm text-mp-medium-grey">{description}</span>
      </span>
      <ArrowRight
        className="shrink-0 text-mp-medium-grey transition-transform group-hover:translate-x-1"
        size={18}
        aria-hidden="true"
      />
    </Link>
  );
}

function UnavailableFeature({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: typeof Inbox;
}) {
  return (
    <article className="border border-dashed border-mp-warm-grey bg-mp-app-bg p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <Icon className="shrink-0 text-mp-medium-grey" size={20} aria-hidden="true" />
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="mt-2 text-sm text-mp-medium-grey">{description}</p>
      <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-mp-medium-grey">
        Not available yet
      </p>
    </article>
  );
}

function ClientDashboard({ profile, data }: { profile: UserProfile; data: DashboardData }) {
  const ownedMandates = data.mandates.filter((mandate) => mandate.ownerId === profile.uid);
  const activeMandates = ownedMandates.filter((mandate) => mandate.status === 'active');
  const openNegotiations = data.negotiations.filter(
    (negotiation) => !terminalNegotiationStatuses.has(negotiation.status),
  );
  const pendingProposals = data.negotiations.filter(
    (negotiation) => negotiation.currentOffer !== null
      && negotiation.status === 'pending_owner_approval'
      && negotiation.ownerApprovalRequiredForViewer === true,
  );
  const contractApprovals = data.contracts.filter(
    (contract) => contract.status === 'pending_review'
      && contract.requiredApproverIds.includes(profile.uid)
      && !contract.approvals.includes(profile.uid),
  );
  const activeContracts = data.contracts.filter((contract) => contract.status === 'active');

  return (
    <>
      <DashboardHeader
        eyebrow="Client workspace"
        title={`Welcome${profile.displayName ? `, ${profile.displayName}` : ''}`}
        description="Create mandates, review service offers, and track your agreements and payments."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Active mandates" value={activeMandates.length} detail="Owned by your account" />
        <Metric label="Active negotiations" value={openNegotiations.length} detail="Negotiations visible to you" />
        <Metric label="Pending freelancer proposals" value={pendingProposals.length} detail="Offers awaiting your approval" />
        <Metric label="Active contracts" value={activeContracts.length} detail="Current contract records" />
      </div>

      <section aria-labelledby="client-actions-heading" className="space-y-4">
        <div>
          <p className="mp-kicker">Client actions</p>
          <h2 id="client-actions-heading" className="mt-1 text-xl font-semibold">Your workspace</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <DashboardLink href="/mandates/new" title="Create new mandate" description="Define authority, limits, and approval rules." icon={ShieldCheck} />
          <DashboardLink href="/marketplace" title="Find freelancers and service providers" description="Browse the existing service directory." icon={Search} />
          <DashboardLink href="/mandates" title="My mandates" description={`${ownedMandates.length} mandate records owned by you.`} icon={BriefcaseBusiness} />
          <DashboardLink href="/negotiations" title="Active negotiations" description={`${openNegotiations.length} negotiation records visible to your account.`} icon={FileCheck2} />
          <DashboardLink href="/contracts" title="Approval requests" description={`${contractApprovals.length} contract records awaiting your review.`} icon={FileText} />
          <DashboardLink href="/contracts" title="Active contracts" description={`${activeContracts.length} active contract records.`} icon={FileText} />
          <DashboardLink href="/payments" title="Payment history" description={`${data.payments.length} payment records available to your account.`} icon={Wallet} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <UnavailableFeature
            title="Messages / Inbox"
            description="The application has no conversation or message store yet, so there are no messages to display."
            icon={Inbox}
          />
          <UnavailableFeature
            title="Profile and settings"
            description="Self-service profile settings are not implemented. Your account role remains managed by the trusted profile API."
            icon={Settings}
          />
        </div>
      </section>
    </>
  );
}

function FreelancerDashboard({ profile, data }: { profile: UserProfile; data: DashboardData }) {
  const incomingRequests = data.negotiations.filter(
    (negotiation) => negotiation.recipientAgentId === profile.uid
      && !terminalNegotiationStatuses.has(negotiation.status),
  );
  const myProposals = data.negotiations.filter(
    (negotiation) => negotiation.currentOffer?.submittedByAgentId === profile.uid
      && !terminalNegotiationStatuses.has(negotiation.status),
  );
  const activeContracts = data.contracts.filter((contract) => contract.status === 'active');
  const receivedPayments = data.payments.filter(
    (payment) => payment.payeeId === profile.uid
      && ['completed', 'partially_refunded'].includes(payment.status),
  );
  const earningsByCurrency = new Map<string, number>();
  for (const payment of receivedPayments) {
    const netAmount = payment.amountMinor - payment.refundedAmountMinor;
    if (netAmount > 0) {
      earningsByCurrency.set(
        payment.currency,
        (earningsByCurrency.get(payment.currency) ?? 0) + netAmount,
      );
    }
  }
  const earnings = [...earningsByCurrency.entries()]
    .map(([currency, amount]) => formatMinorAmount(amount, currency))
    .join(' · ') || '—';
  const assignedMandates = data.mandates.filter(
    (mandate) => mandate.authorizedAgentId === profile.uid,
  );

  return (
    <>
      <DashboardHeader
        eyebrow="Freelancer workspace"
        title={`Welcome${profile.displayName ? `, ${profile.displayName}` : ''}`}
        description="Review work requests and offers, manage contracts, and follow received payments."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Incoming work requests" value={incomingRequests.length} detail="Open negotiations addressed to you" />
        <Metric label="My proposals" value={myProposals.length} detail="Open offers submitted by you" />
        <Metric label="Active contracts" value={activeContracts.length} detail="Current contract records" />
        <Metric label="Received earnings" value={earnings} detail={`${receivedPayments.length} completed payment records`} />
      </div>

      <section aria-labelledby="freelancer-actions-heading" className="space-y-4">
        <div>
          <p className="mp-kicker">Freelancer actions</p>
          <h2 id="freelancer-actions-heading" className="mt-1 text-xl font-semibold">Your workspace</h2>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <DashboardLink href="/negotiations" title="Incoming work requests" description={`${incomingRequests.length} open requests addressed to you.`} icon={Inbox} />
          <DashboardLink href="/negotiations" title="My proposals" description={`${myProposals.length} open offers submitted by you.`} icon={FileCheck2} />
          <DashboardLink href="/contracts" title="Active contracts" description={`${activeContracts.length} active contract records.`} icon={FileText} />
          <DashboardLink href="/payments" title="Earnings and payment history" description={`${data.payments.length} payment records available; received totals are grouped by currency.`} icon={Wallet} />
          <DashboardLink href="/mandates" title="My mandates" description={`${assignedMandates.length} mandate records authorize your account.`} icon={ShieldCheck} />
          <DashboardLink href="/agents" title="Profile and service settings" description="Manage your freelancer agent profile." icon={Settings} />
          <DashboardLink href="/marketplace" title="Service directory" description="Manage or browse real published service listings." icon={Store} />
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <UnavailableFeature
            title="Available opportunities / client mandates"
            description="Mandates are private and visible only to their owners, authorized agents, and approvers. There is no public opportunity feed."
            icon={Search}
          />
          <UnavailableFeature
            title="Active and completed projects"
            description="The app stores contracts, but it has no separate project records or completed-project lifecycle."
            icon={BriefcaseBusiness}
          />
          <UnavailableFeature
            title="Messages / Inbox"
            description="The application has no conversation or message store yet, so there are no messages to display."
            icon={Inbox}
          />
          <UnavailableFeature
            title="Personal profile settings"
            description="Self-service personal profile settings are not implemented."
            icon={Settings}
          />
        </div>
      </section>
    </>
  );
}

function DashboardHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="border-b border-mp-warm-grey pb-6">
      <p className="mp-kicker">{eyebrow}</p>
      <h1 className="mp-page-title mt-2">{title}</h1>
      <p className="mp-copy mt-3 max-w-2xl">{description}</p>
    </header>
  );
}

function DashboardContent({ profile }: { profile: UserProfile }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      listMandates(),
      listNegotiations(),
      listContracts(),
      listPayments(),
    ])
      .then(([mandates, negotiations, contracts, payments]) => {
        if (active) {
          setData({ mandates, negotiations, contracts, payments });
        }
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Dashboard data could not be loaded.');
        }
      });

    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <div className="mp-empty-state mx-auto max-w-2xl px-6 py-10" role="alert">
        <h1 className="text-lg font-semibold">Dashboard data could not be loaded</h1>
        <p className="mp-copy mt-2">{error}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 min-h-10 border border-mp-warm-grey bg-mp-surface px-4 text-sm font-semibold hover:border-mp-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-mp-orange"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <p className="py-12 text-center text-sm text-mp-medium-grey" role="status" aria-live="polite">
        Loading your {profile.role} workspace…
      </p>
    );
  }

  if (profile.role === 'client') {
    return (
      <section className="mp-page mx-auto w-full max-w-7xl space-y-8">
        <ClientDashboard profile={profile} data={data} />
      </section>
    );
  }

  if (profile.role === 'freelancer') {
    return (
      <section className="mp-page mx-auto w-full max-w-7xl space-y-8">
        <FreelancerDashboard profile={profile} data={data} />
      </section>
    );
  }

  return (
    <section className="mp-page mx-auto w-full max-w-7xl space-y-8">
      <DashboardHeader
        eyebrow="Administrator workspace"
        title="Overview"
        description="Use the available operational workspaces to review records."
      />
      <div className="grid gap-3 md:grid-cols-2">
        <DashboardLink href="/contracts" title="Contracts" description={`${data.contracts.length} contract records available to this account.`} icon={FileText} />
        <DashboardLink href="/payments" title="Payments" description={`${data.payments.length} payment records available to this account.`} icon={Wallet} />
      </div>
    </section>
  );
}

export function RoleDashboard() {
  const { profile } = useAuth();

  if (!profile) {
    return null;
  }

  return <DashboardContent key={`${profile.uid}:${profile.role}`} profile={profile} />;
}
