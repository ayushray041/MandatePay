import { PaymentDetail } from '@/components/payments/PaymentDetail';

export default async function PaymentPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = await params;
  return <PaymentDetail paymentId={paymentId} />;
}
