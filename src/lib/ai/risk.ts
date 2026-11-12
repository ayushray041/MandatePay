import { aiRiskAssessmentSchema, type AiRiskAssessment } from '@/models/ai';
import type { PaymentRecord, PaymentStatus } from '@/models/payment';

type RiskPayment = Pick<
  PaymentRecord,
  'id' | 'payerId' | 'payeeId' | 'amountMinor' | 'currency' | 'status' | 'createdAt' | 'completedAt'
  | 'serviceTitle'
> & Partial<Pick<PaymentRecord, 'refundedAmountMinor'>>;

type AgentActivityEvidence = {
  action: string;
  createdAt: string | null;
};

const observationWindowDays = 30;
const forecastHorizonDays = 30;
const terminalPaymentStatuses = new Set<PaymentStatus>([
  'completed',
  'partially_refunded',
  'failed',
  'refunded',
]);

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(sorted[middle - 1] / 2 + sorted[middle] / 2)
    : sorted[middle];
}

function confidence(sampleSize: number): number {
  return Math.min(0.9, Math.round(sampleSize / 10 * 100) / 100);
}

function riskLevel(score: number): 'low' | 'medium' | 'high' {
  if (score >= 70) {
    return 'high';
  }
  if (score >= 40) {
    return 'medium';
  }
  return 'low';
}

function priceEstimate(payments: RiskPayment[]): AiRiskAssessment['priceEstimate'] {
  const serviceTitle = payments[0]?.serviceTitle;
  const completed = payments.filter((payment) => (
    payment.status === 'completed'
    && payment.serviceTitle === serviceTitle
    && Number.isSafeInteger(payment.amountMinor)
    && payment.amountMinor > 0
  ));
  if (completed.length < 3) {
    return null;
  }
  const amounts = completed.map((payment) => payment.amountMinor);
  return {
    medianMinor: median(amounts),
    lowMinor: Math.min(...amounts),
    highMinor: Math.max(...amounts),
    currency: completed[0].currency,
    sampleSize: completed.length,
    basis: 'observed_completed_payments_only',
  };
}

function baseAssessment(
  action: AiRiskAssessment['action'],
  sampleSize: number,
  fields: Partial<Pick<
    AiRiskAssessment,
    'riskScore' | 'riskLevel' | 'requiresHumanReview' | 'summary' | 'signals' | 'priceEstimate' | 'spendingForecast'
  >>,
): AiRiskAssessment {
  return aiRiskAssessmentSchema.parse({
    action,
    source: 'deterministic',
    riskScore: null,
    riskLevel: 'insufficient_data',
    confidence: { score: confidence(sampleSize), method: 'sample_size_heuristic' },
    requiresHumanReview: true,
    summary: 'There is not enough validated history to assess this activity reliably.',
    signals: [],
    evidence: { sampleSize, observationWindowDays },
    priceEstimate: null,
    spendingForecast: null,
    ...fields,
  });
}

export function assessPaymentAnomaly(
  payments: RiskPayment[],
  paymentId: string,
  now: Date,
): AiRiskAssessment {
  const payment = payments.find(({ id }) => id === paymentId);
  if (!payment) {
    throw new Error('The requested payment is missing from the authorized history.');
  }
  const peers = payments.filter((candidate) => (
    candidate.id !== payment.id
    && candidate.status === 'completed'
    && candidate.payeeId === payment.payeeId
    && candidate.serviceTitle === payment.serviceTitle
    && candidate.currency === payment.currency
  ));
  const estimates = priceEstimate(peers);
  const signals: AiRiskAssessment['signals'] = [];
  let score = 0;

  if (estimates && payment.amountMinor >= estimates.medianMinor * 3) {
    score += 70;
    signals.push({
      code: 'PRICE_OUTLIER',
      severity: 'high',
      explanation: 'Payment amount is at least three times the observed median for this payee and currency.',
      evidence: [
        `payment_minor=${payment.amountMinor}`,
        `observed_median_minor=${estimates.medianMinor}`,
        `completed_peer_count=${estimates.sampleSize}`,
      ],
    });
  }

  const paymentTime = Date.parse(payment.createdAt ?? '');
  const duplicateCandidates = payments.filter((candidate) => {
    const candidateTime = Date.parse(candidate.createdAt ?? '');
    return candidate.id !== payment.id
      && candidate.payerId === payment.payerId
      && candidate.payeeId === payment.payeeId
      && candidate.serviceTitle === payment.serviceTitle
      && candidate.amountMinor === payment.amountMinor
      && candidate.currency === payment.currency
      && !['cancelled', 'refunded'].includes(candidate.status)
      && Number.isFinite(paymentTime)
      && Number.isFinite(candidateTime)
      && Math.abs(paymentTime - candidateTime) <= 24 * 60 * 60 * 1000
      && candidateTime <= now.getTime();
  });
  if (duplicateCandidates.length > 0) {
    score += 75;
    signals.push({
      code: 'POSSIBLE_DUPLICATE',
      severity: 'high',
      explanation: 'A similar payment to the same payee appears within 24 hours; this is a review signal, not proof of duplication.',
      evidence: [
        `candidate_count=${duplicateCandidates.length}`,
        `amount_minor=${payment.amountMinor}`,
        `currency=${payment.currency}`,
      ],
    });
  }

  const boundedScore = Math.min(100, score);
  const enoughEvidence = Boolean(estimates) || duplicateCandidates.length > 0;
  return baseAssessment('payment_anomaly', peers.length, {
    riskScore: enoughEvidence ? boundedScore : null,
    riskLevel: enoughEvidence ? riskLevel(boundedScore) : 'insufficient_data',
    requiresHumanReview: !enoughEvidence || boundedScore >= 40,
    summary: !enoughEvidence
      ? 'Insufficient comparable payment history; no conclusion is available.'
      : signals.length > 0
        ? 'One or more review signals were found. They do not block or authorize the payment.'
        : 'No configured anomaly threshold was crossed in the available history.',
    signals,
    priceEstimate: estimates,
  });
}

export function forecastSpending(
  payments: RiskPayment[],
  now: Date,
  currency: RiskPayment['currency'],
): AiRiskAssessment {
  const from = now.getTime() - observationWindowDays * 24 * 60 * 60 * 1000;
  const completed = payments.filter((payment) => {
    const completedTime = Date.parse(payment.completedAt ?? '');
      return (payment.status === 'completed' || payment.status === 'partially_refunded')
    && payment.currency === currency
      && Number.isSafeInteger(payment.amountMinor)
      && payment.amountMinor >= 0
      && netAmount(payment) > 0
      && Number.isFinite(completedTime)
      && completedTime >= from
      && completedTime <= now.getTime();
  });
  const total = completed.reduce((sum, payment) => sum + netAmount(payment), 0);
  if (!Number.isSafeInteger(total) || completed.length === 0) {
    return baseAssessment('spending_forecast', completed.length, {
      summary: 'No completed payments in the observation window; a spending forecast is unavailable.',
    });
  }

  const projected = Math.round(total / observationWindowDays * forecastHorizonDays);
  if (!Number.isSafeInteger(projected)) {
    throw new Error('The spending forecast exceeds the supported amount range.');
  }
  return baseAssessment('spending_forecast', completed.length, {
    riskLevel: completed.length < 3 ? 'insufficient_data' : 'low',
    requiresHumanReview: completed.length < 3,
    summary: 'Projection uses a simple historical daily average; it is not a trained forecast.',
    spendingForecast: {
      projectedSpendMinor: projected,
      currency,
      horizonDays: forecastHorizonDays,
      sampleSize: completed.length,
      basis: 'historical_daily_average',
    },
  });
}

function netAmount(payment: RiskPayment): number {
  const refunded = Number.isSafeInteger(payment.refundedAmountMinor)
    ? Number(payment.refundedAmountMinor)
    : payment.status === 'refunded' ? payment.amountMinor : 0;
  return Math.max(0, payment.amountMinor - refunded);
}

export function assessVendorRisk(
  payments: RiskPayment[],
  vendorId: string,
  currency: RiskPayment['currency'],
): AiRiskAssessment {
  const vendorPayments = payments.filter((payment) => (
    payment.payeeId === vendorId && payment.currency === currency
  ));
  const terminal = vendorPayments.filter(({ status }) => terminalPaymentStatuses.has(status));
  const failures = terminal.filter(({ status }) => (
    status === 'failed' || status === 'partially_refunded' || status === 'refunded'
  )).length;
  const estimate = priceEstimate(vendorPayments);
  if (terminal.length < 3) {
    return baseAssessment('vendor_risk', terminal.length, {
      summary: 'Insufficient completed, failed, or refunded transactions for a vendor risk estimate.',
      priceEstimate: estimate,
    });
  }

  const score = Math.round(failures / terminal.length * 100);
  const signals: AiRiskAssessment['signals'] = failures > 0
    ? [{
        code: 'OBSERVED_PAYMENT_FAILURES',
        severity: score >= 40 ? 'high' : 'medium',
        explanation: 'Observed failed or fully/partially refunded payments are a limited, user-specific vendor signal.',
        evidence: [
          `failed_or_refunded=${failures}`,
          `terminal_transactions=${terminal.length}`,
        ],
      }]
    : [];
  return baseAssessment('vendor_risk', terminal.length, {
    riskScore: score,
    riskLevel: riskLevel(score),
    requiresHumanReview: signals.length > 0,
    summary: 'Vendor signal is based only on this account’s payment history, not a platform-wide guarantee.',
    signals,
    priceEstimate: estimate,
  });
}

export function assessAgentBehavior(
  events: AgentActivityEvidence[],
  now: Date,
): AiRiskAssessment {
  const hourAgo = now.getTime() - 60 * 60 * 1000;
  const recent = events.filter(({ createdAt }) => {
    const timestamp = Date.parse(createdAt ?? '');
    return Number.isFinite(timestamp) && timestamp >= hourAgo && timestamp <= now.getTime();
  });
  if (events.length < 10) {
    return baseAssessment('agent_behavior', events.length, {
      summary: 'Insufficient agent activity history for behavior monitoring.',
    });
  }

  const signals: AiRiskAssessment['signals'] = [];
  if (recent.length >= 30) {
    signals.push({
      code: 'HIGH_ACTIVITY_BURST',
      severity: 'medium',
      explanation: 'At least 30 recorded agent management events occurred within the last hour.',
      evidence: [`events_last_hour=${recent.length}`],
    });
  }
  const score = signals.length > 0 ? 50 : 0;
  return baseAssessment('agent_behavior', events.length, {
    riskScore: score,
    riskLevel: riskLevel(score),
    requiresHumanReview: signals.length > 0,
    summary: 'Activity checks use event-rate thresholds only; they do not infer intent or agent quality.',
    signals,
  });
}
