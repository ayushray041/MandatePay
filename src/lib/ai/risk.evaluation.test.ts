import { describe, expect, it } from 'vitest';
import { assessPaymentAnomaly } from '@/lib/ai/risk';

type RiskPayment = Parameters<typeof assessPaymentAnomaly>[0][number];

const now = new Date('2026-11-12T12:00:00.000Z');

function payment(
  id: string,
  amountMinor: number,
  createdAt: string,
  status: RiskPayment['status'] = 'completed',
): RiskPayment {
  return {
    id,
    payerId: 'owner-eval',
    payeeId: 'vendor-eval',
    serviceTitle: 'Reporting',
    amountMinor,
    currency: 'USD',
    status,
    createdAt,
    completedAt: status === 'completed' ? createdAt : null,
  };
}

const baseline = [
  payment('baseline-1', 10_000, '2026-11-08T10:00:00.000Z'),
  payment('baseline-2', 11_000, '2026-11-09T10:00:00.000Z'),
  payment('baseline-3', 12_000, '2026-11-10T10:00:00.000Z'),
];

const cases: Array<{
  name: string;
  payments: RiskPayment[];
  targetId: string;
  expectedSignal: string | null;
}> = [
  {
    name: 'large observed price outlier',
    payments: [...baseline, payment('target-outlier', 40_000, '2026-11-12T10:00:00.000Z', 'pending')],
    targetId: 'target-outlier',
    expectedSignal: 'PRICE_OUTLIER',
  },
  {
    name: 'same-value payment within one day',
    payments: [
      payment('same-value-prior', 11_000, '2026-11-12T10:30:00.000Z'),
      payment('target-duplicate', 11_000, '2026-11-12T11:00:00.000Z', 'pending'),
    ],
    targetId: 'target-duplicate',
    expectedSignal: 'POSSIBLE_DUPLICATE',
  },
  {
    name: 'ordinary price with comparable history',
    payments: [...baseline, payment('target-normal', 12_000, '2026-11-12T10:00:00.000Z', 'pending')],
    targetId: 'target-normal',
    expectedSignal: null,
  },
];

describe('synthetic financial risk evaluation dataset', () => {
  it('detects all labeled risk cases without flagging the ordinary-price control', () => {
    const evaluated = cases.map((entry) => ({
      ...entry,
      result: assessPaymentAnomaly(entry.payments, entry.targetId, now),
    }));
    const positiveCases = evaluated.filter(({ expectedSignal }) => expectedSignal !== null);
    const detected = positiveCases.filter(({ expectedSignal, result }) => (
      result.signals.some(({ code }) => code === expectedSignal)
    ));
    const controls = evaluated.filter(({ expectedSignal }) => expectedSignal === null);

    expect(detected).toHaveLength(positiveCases.length);
    expect(controls.every(({ result }) => result.signals.length === 0)).toBe(true);
    expect(evaluated.every(({ result }) => result.source === 'deterministic')).toBe(true);
  });
});
