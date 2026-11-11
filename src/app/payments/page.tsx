import Link from 'next/link';
import { ArrowRight, CircleDollarSign, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Table } from '@/components/ui/Table';

const paymentStages = [
  { name: 'Agreement approved', description: 'Both parties approve the amendment.' },
  { name: 'Payment authorized', description: 'The payer authorizes the agreed amount.' },
  { name: 'Capture or void', description: 'Capture follows fulfillment; unused authorizations may be voided.' },
];

export default function PaymentsPage() {
  return (
    <section className="mp-page mx-auto w-full max-w-7xl space-y-8">
      <header className="flex flex-col justify-between gap-5 border-b border-mp-warm-grey pb-6 sm:flex-row sm:items-end">
        <div>
          <p className="mp-kicker">Financial operations</p>
          <h1 className="mp-page-title mt-2">Payments</h1>
          <p className="mp-copy mt-3 max-w-2xl">
            Review authorization and settlement records associated with approved agreements.
          </p>
        </div>
        <Badge variant="info">No live payment records</Badge>
      </header>

      <section aria-labelledby="payment-register-heading">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mp-kicker">Transaction register</p>
            <h2 id="payment-register-heading" className="mt-1 text-xl font-semibold">
              Payment activity
            </h2>
          </div>
          <span className="text-sm text-mp-medium-grey">No transactions loaded</span>
        </div>
        <Table
          caption="Payment transaction records"
          headers={['Payment', 'Agreement', 'Amount', 'Authorization', 'Settlement']}
          rows={[]}
          emptyMessage="Payment records will appear here when the payment integration is connected."
        />
      </section>

      <section className="grid gap-8 border-t border-mp-warm-grey pt-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(16rem,0.8fr)]">
        <div>
          <div className="flex items-center gap-3">
            <CircleDollarSign size={22} className="text-mp-orange" aria-hidden="true" />
            <h2 className="text-xl font-semibold">Payment lifecycle</h2>
          </div>
          <ol className="mt-5 border-y border-mp-warm-grey bg-mp-surface sm:grid sm:grid-cols-3">
            {paymentStages.map((stage, index) => (
              <li
                key={stage.name}
                className="border-b border-mp-warm-grey p-4 last:border-0 sm:border-b-0 sm:border-r sm:last:border-r-0"
              >
                <span className="font-mono text-sm text-mp-medium-grey">0{index + 1}</span>
                <h3 className="mt-3 font-semibold">{stage.name}</h3>
                <p className="mp-copy mt-1 text-sm">{stage.description}</p>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-sm text-mp-medium-grey">
            Lifecycle description only. PayPal payment execution is not implemented yet.
          </p>
        </div>

        <aside className="border-l-2 border-mp-orange pl-5">
          <div className="flex items-center gap-3">
            <ShieldCheck size={21} className="text-mp-orange" aria-hidden="true" />
            <h2 className="text-lg font-semibold">Payment integrity</h2>
          </div>
          <p className="mp-copy mt-3">
            The product brief calls for integer-cent amounts and server-calculated payment values.
            No payment endpoints or payment records are currently available.
          </p>
          <Link
            href="/amendments"
            className="mt-5 inline-flex min-h-10 items-center gap-2 font-semibold text-mp-ink underline decoration-mp-orange decoration-2 underline-offset-4 hover:text-mp-medium-grey focus-visible:outline focus-visible:outline-2 focus-visible:outline-mp-orange"
          >
            View amendments <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </aside>
      </section>
    </section>
  );
}
