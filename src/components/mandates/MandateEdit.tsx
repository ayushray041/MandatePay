'use client';

import { useEffect, useState } from 'react';
import { MandateForm } from '@/components/mandates/MandateForm';
import { useAuth } from '@/components/providers/AuthProvider';
import { getMandate } from '@/lib/mandates/client';
import type { MandateRecord } from '@/models/mandate';

export function MandateEdit({ mandateId }: { mandateId: string }) {
  const { user } = useAuth();
  const uid = user?.uid;
  const [mandate, setMandate] = useState<MandateRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getMandate(mandateId)
      .then((current) => {
        if (!active) {
          return;
        }
        if (current.ownerId !== uid || current.status !== 'draft') {
          setError('Only the owner can edit a draft mandate.');
          return;
        }
        setMandate(current);
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setError(caughtError instanceof Error ? caughtError.message : 'Mandate could not be loaded.');
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
  }, [mandateId, uid]);

  if (loading) {
    return <p className="py-12 text-center text-sm text-mp-medium-grey" role="status">Loading draft mandate…</p>;
  }

  if (error || !mandate) {
    return (
      <p className="mx-auto max-w-3xl border-l-2 border-mp-orange bg-mp-surface px-4 py-3 text-sm" role="alert">
        {error ?? 'Mandate could not be loaded.'}
      </p>
    );
  }

  return <MandateForm initialMandate={mandate} />;
}
