import { Suspense } from 'react';
import { PaymentWorkspace } from '@/components/payments/PaymentWorkspace';

export default function PaymentsPage() {
  return (
    <Suspense fallback={(
      <p className="py-12 text-center text-sm text-mp-medium-grey" role="status">
        Loading payment workspace…
      </p>
    )}>
      <PaymentWorkspace />
    </Suspense>
  );
}
