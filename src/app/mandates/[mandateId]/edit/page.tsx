import { MandateEdit } from '@/components/mandates/MandateEdit';

export default async function EditMandatePage({
  params,
}: {
  params: Promise<{ mandateId: string }>;
}) {
  const { mandateId } = await params;
  return <MandateEdit mandateId={mandateId} />;
}
