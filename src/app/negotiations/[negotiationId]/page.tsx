import { NegotiationDetail } from '@/components/negotiations/NegotiationDetail';

export default async function NegotiationPage({
  params,
}: {
  params: Promise<{ negotiationId: string }>;
}) {
  const { negotiationId } = await params;
  return <NegotiationDetail negotiationId={negotiationId} />;
}
