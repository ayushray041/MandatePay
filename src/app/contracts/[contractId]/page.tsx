import { ContractDetail } from '@/components/contracts/ContractDetail';

export default async function ContractPage({
  params,
}: {
  params: Promise<{ contractId: string }>;
}) {
  const { contractId } = await params;
  return <ContractDetail contractId={contractId} />;
}
