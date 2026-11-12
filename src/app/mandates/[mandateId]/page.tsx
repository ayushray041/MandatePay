import { MandateDetail } from '@/components/mandates/MandateDetail';

export default async function MandatePage({
  params,
}: {
  params: Promise<{ mandateId: string }>;
}) {
  const { mandateId } = await params;
  return <MandateDetail mandateId={mandateId} />;
}
