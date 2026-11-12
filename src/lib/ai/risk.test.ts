import { describe, expect, it } from 'vitest';
import {
  assessAgentBehavior,
  assessPaymentAnomaly,
  assessVendorRisk,
  forecastSpending,
} from '@/lib/ai/risk';

type RiskPayment = Parameters<typeof assessPaymentAnomaly>[0][number];

const now = new Date('2026-11-12T10:00:00.000Z');

function payment(
  id: string,
  amountMinor: number,
  status: RiskPayment['status'] = 'completed',
  payeeId = 'vendor-a',
  createdAt = '2026-11-12T09:00:00.000Z',
  completedAt: string | null = '2026-11-12T09:05:00.000Z',
): RiskPayment {
  return {
    id,
    payerId: 'owner-a',
    payeeId,
    serviceTitle: 'Consulting',
    amountMinor,
    currency: 'USD',
    status,
    createdAt,
    completedAt,
  };
}

describe('deterministic financial risk intelligence', () => {
  it('flags a large observed-price outlier without authorizing or blocking it', () => {
    const records = [
      payment('p1', 10_000),
      payment('p2', 12_000, 'completed', 'vendor-a', '2026-11-10T09:00:00.000Z'),
      payment('p3', 11_000, 'completed', 'vendor-a', '2026-11-09T09:00:00.000Z'),
      payment('target', 40_000, 'pending', 'vendor-a', '2026-11-12T09:00:00.000Z', null),
    ];
    const result = assessPaymentAnomaly(records, 'target', now);

    expect(result.riskLevel).toBe('high');
    expect(result.signals.map(({ code }) => code)).toContain('PRICE_OUTLIER');
    expect(result.priceEstimate).toMatchObject({
      medianMinor: 11_000,
      sampleSize: 3,
      basis: 'observed_completed_payments_only',
    });
    expect(result.requiresHumanReview).toBe(true);
  });

  it('raises a duplicate signal for an equal recent payment and marks limited data for review', () => {
    const result = assessPaymentAnomaly([
      payment('existing', 10_000, 'completed'),
      payment('current', 10_000, 'pending'),
    ], 'current', now);

    expect(result.signals[0].code).toBe('POSSIBLE_DUPLICATE');
    expect(result.riskLevel).toBe('high');
    expect(result.requiresHumanReview).toBe(true);
  });

  it('does not fabricate a forecast without completed transactions', () => {
    const result = forecastSpending(
      [payment('pending', 50_000, 'pending', 'vendor-a', '2026-11-12T09:00:00.000Z', null)],
      now,
      'USD',
    );

    expect(result.spendingForecast).toBeNull();
    expect(result.riskLevel).toBe('insufficient_data');
    expect(result.requiresHumanReview).toBe(true);
  });

  it('projects from completed payments in a bounded window and flags vendor evidence limits', () => {
    const otherCurrencyPayment = {
      ...payment('other-currency', 80_000, 'completed', 'vendor-b'),
      currency: 'EUR' as const,
    };
    const records = [
      payment('c1', 10_000),
      payment('c2', 12_000, 'completed', 'vendor-a', '2026-11-10T09:00:00.000Z'),
      payment('f1', 9_000, 'failed', 'vendor-a', '2026-11-09T09:00:00.000Z', null),
      otherCurrencyPayment,
    ];
    const forecast = forecastSpending(records, now, 'USD');
    const vendor = assessVendorRisk(records, 'vendor-a', 'USD');

    expect(forecast.spendingForecast).toMatchObject({
      projectedSpendMinor: 22_000,
      sampleSize: 2,
      basis: 'historical_daily_average',
    });
    expect(vendor.riskScore).toBe(33);
    expect(vendor.priceEstimate).toBeNull();
  });

  it('uses net captured value for spending forecasts after a partial refund', () => {
    const partial = {
      ...payment('partial', 10_000, 'partially_refunded'),
      refundedAmountMinor: 4_000,
    };
    const forecast = forecastSpending([
      payment('completed', 10_000),
      partial,
    ], now, 'USD');

    expect(forecast.spendingForecast).toMatchObject({
      projectedSpendMinor: 16_000,
      sampleSize: 2,
    });
  });

  it('flags high management-event bursts without inferring malicious intent', () => {
    const events = Array.from({ length: 30 }, (_, index) => ({
      action: `agent.action.${index}`,
      createdAt: new Date(now.getTime() - index * 60_000).toISOString(),
    }));
    const result = assessAgentBehavior(events, now);

    expect(result.signals[0].code).toBe('HIGH_ACTIVITY_BURST');
    expect(result.summary).toContain('do not infer intent');
    expect(result.requiresHumanReview).toBe(true);
  });
});
