import { createHash } from 'node:crypto';
import {
  CheckoutPaymentIntent,
  Client,
  Environment,
  OrdersController,
  PaymentsController,
} from '@paypal/paypal-server-sdk';
import { z } from 'zod';
import { currencyFractionDigits, parseMajorAmount } from '@/lib/mandates/money';
import type { PayPalWebhookEvent } from '@/models/payment';

const sandboxApiBaseUrl = 'https://api-m.sandbox.paypal.com';

export class PaymentProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export type PayPalOrderDetails = {
  orderId: string;
  approvalUrl: string;
};

export type PayPalAuthorizationDetails = {
  authorizationId: string;
  status: 'CREATED' | 'PENDING' | 'DENIED';
};

export type PayPalCaptureDetails = {
  captureId: string;
  status: 'COMPLETED' | 'PENDING' | 'FAILED' | 'DECLINED';
};

export type PayPalRefundDetails = {
  refundId: string;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
};

function getCredentials() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new PaymentProviderError(
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Sandbox payment provider credentials are not configured.',
    );
  }
  return { clientId, clientSecret };
}

function createSandboxClient(): Client {
  const credentials = getCredentials();
  return new Client({
    clientCredentialsAuthCredentials: {
      oAuthClientId: credentials.clientId,
      oAuthClientSecret: credentials.clientSecret,
    },
    environment: Environment.Sandbox,
    timeout: 15_000,
  });
}

export function isPayPalConfigured(): boolean {
  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    return false;
  }
  try {
    getApplicationBaseUrl();
    return true;
  } catch {
    return false;
  }
}

function getApplicationBaseUrl(): URL {
  const configuredUrl = process.env.APP_BASE_URL;
  if (!configuredUrl) {
    throw new PaymentProviderError(
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Application base URL is not configured for sandbox checkout.',
    );
  }

  let baseUrl: URL;
  try {
    baseUrl = new URL(configuredUrl);
  } catch {
    throw new PaymentProviderError(
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Application base URL is invalid.',
    );
  }
  if (
    baseUrl.protocol !== 'https:'
    && !(baseUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(baseUrl.hostname))
  ) {
    throw new PaymentProviderError(
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Application base URL must use HTTPS.',
    );
  }
  return baseUrl;
}

function requestIdentifier(
  paymentId: string,
  operation: string,
  attempt = 1,
  paymentCycle = '',
): string {
  if (!Number.isSafeInteger(attempt) || attempt < 1) {
    throw new PaymentProviderError('INVALID_PROVIDER_ATTEMPT', 'Provider operation attempt is invalid.');
  }
  const paymentKey = createHash('sha256').update(`${paymentId}:${paymentCycle}`).digest('hex').slice(0, 32);
  return `mp-${paymentKey}-${operation}-${attempt}`;
}

const moneyResponseSchema = z.object({
  currencyCode: z.string(),
  value: z.string(),
}).passthrough();

export async function createPayPalOrder(input: {
  paymentId: string;
  amountMinor: number;
  currency: string;
  description: string;
  attempt?: number;
  paymentCycle?: string;
}): Promise<PayPalOrderDetails> {
  const client = createSandboxClient();
  const baseUrl = getApplicationBaseUrl();
  const fractionDigits = currencyFractionDigits(input.currency);
  const returnUrl = new URL('/payments', baseUrl);
  returnUrl.searchParams.set('paymentId', input.paymentId);
  returnUrl.searchParams.set('action', 'authorize');
  const cancelUrl = new URL('/payments', baseUrl);
  cancelUrl.searchParams.set('paymentId', input.paymentId);
  cancelUrl.searchParams.set('action', 'cancelled');

  try {
    const response = await new OrdersController(client).createOrder({
      body: {
        intent: CheckoutPaymentIntent.Authorize,
        purchaseUnits: [{
          referenceId: 'default',
          customId: input.paymentId,
          invoiceId: input.paymentId,
          description: input.description.slice(0, 120),
          amount: {
            currencyCode: input.currency,
            value: (input.amountMinor / 10 ** fractionDigits).toFixed(fractionDigits),
          },
        }],
        applicationContext: {
          returnUrl: returnUrl.toString(),
          cancelUrl: cancelUrl.toString(),
        },
      },
      paypalRequestId: requestIdentifier(input.paymentId, 'create', input.attempt, input.paymentCycle),
      prefer: 'return=representation',
    });
    const order = response.result;
    const orderId = order.id;
    const approveLink = order.links?.find((link) => link.rel === 'approve')?.href;
    const amount = moneyResponseSchema.safeParse(order.purchaseUnits?.[0]?.amount);
    const amountMinor = amount.success
      ? parseMajorAmount(amount.data.value, amount.data.currencyCode)
      : null;
    if (
      typeof orderId !== 'string'
      || !orderId
      || order.status !== 'CREATED'
      || !approveLink
      || amountMinor !== input.amountMinor
      || amount.data?.currencyCode !== input.currency
    ) {
      throw new PaymentProviderError(
        'PAYMENT_PROVIDER_INVALID_RESPONSE',
        'Sandbox provider returned an invalid order response.',
      );
    }
    const approvalUrl = new URL(approveLink);
    if (approvalUrl.protocol !== 'https:' || !approvalUrl.hostname.endsWith('.sandbox.paypal.com')) {
      throw new PaymentProviderError(
        'PAYMENT_PROVIDER_INVALID_RESPONSE',
        'Sandbox provider returned an unsafe approval link.',
      );
    }
    return { orderId, approvalUrl: approvalUrl.toString() };
  } catch (error: unknown) {
    if (error instanceof PaymentProviderError) {
      throw error;
    }
    throw new PaymentProviderError(
      'PAYMENT_PROVIDER_ERROR',
      'Sandbox provider could not create the payment order.',
    );
  }
}

const authorizationResponseSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['CREATED', 'PENDING', 'DENIED']),
  amount: moneyResponseSchema,
}).passthrough();

export async function authorizePayPalOrder(input: {
  paymentId: string;
  orderId: string;
  amountMinor: number;
  currency: string;
  attempt?: number;
  paymentCycle?: string;
}): Promise<PayPalAuthorizationDetails> {
  try {
    const response = await new OrdersController(createSandboxClient()).authorizeOrder({
      id: input.orderId,
      paypalRequestId: requestIdentifier(input.paymentId, 'authorize', input.attempt, input.paymentCycle),
      prefer: 'return=representation',
    });
    const authorization = response.result.purchaseUnits?.[0]?.payments?.authorizations?.[0];
    const parsed = authorizationResponseSchema.safeParse(authorization);
    const amountMinor = parsed.success
      ? parseMajorAmount(parsed.data.amount.value, parsed.data.amount.currencyCode)
      : null;
    if (
      !parsed.success
      || amountMinor !== input.amountMinor
      || parsed.data.amount.currencyCode !== input.currency
    ) {
      throw new PaymentProviderError(
        'PAYMENT_PROVIDER_INVALID_RESPONSE',
        'Sandbox provider returned an invalid authorization response.',
      );
    }
    return { authorizationId: parsed.data.id, status: parsed.data.status };
  } catch (error: unknown) {
    if (error instanceof PaymentProviderError) {
      throw error;
    }
    throw new PaymentProviderError(
      'PAYMENT_PROVIDER_ERROR',
      'Sandbox provider could not authorize the payment.',
    );
  }
}

const captureResponseSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['COMPLETED', 'PENDING', 'FAILED', 'DECLINED']),
  amount: moneyResponseSchema,
}).passthrough();

export async function capturePayPalAuthorization(input: {
  paymentId: string;
  authorizationId: string;
  amountMinor: number;
  currency: string;
  attempt?: number;
  paymentCycle?: string;
}): Promise<PayPalCaptureDetails> {
  try {
    const response = await new PaymentsController(createSandboxClient()).captureAuthorizedPayment({
      authorizationId: input.authorizationId,
      paypalRequestId: requestIdentifier(input.paymentId, 'capture', input.attempt, input.paymentCycle),
      prefer: 'return=representation',
      body: { finalCapture: true },
    });
    const parsed = captureResponseSchema.safeParse(response.result);
    const amountMinor = parsed.success
      ? parseMajorAmount(parsed.data.amount.value, parsed.data.amount.currencyCode)
      : null;
    if (
      !parsed.success
      || amountMinor !== input.amountMinor
      || parsed.data.amount.currencyCode !== input.currency
    ) {
      throw new PaymentProviderError(
        'PAYMENT_PROVIDER_INVALID_RESPONSE',
        'Sandbox provider returned an invalid capture response.',
      );
    }
    return { captureId: parsed.data.id, status: parsed.data.status };
  } catch (error: unknown) {
    if (error instanceof PaymentProviderError) {
      throw error;
    }
    throw new PaymentProviderError(
      'PAYMENT_PROVIDER_ERROR',
      'Sandbox provider could not capture the authorization.',
    );
  }
}

const refundResponseSchema = z.object({
  id: z.string().min(1),
  status: z.enum(['COMPLETED', 'PENDING', 'FAILED']),
}).passthrough();

export async function refundPayPalCapture(input: {
  paymentId: string;
  captureId: string;
  reason: string;
  attempt?: number;
  paymentCycle?: string;
}): Promise<PayPalRefundDetails> {
  try {
    const response = await new PaymentsController(createSandboxClient()).refundCapturedPayment({
      captureId: input.captureId,
      paypalRequestId: requestIdentifier(input.paymentId, 'refund', input.attempt, input.paymentCycle),
      prefer: 'return=representation',
      body: { noteToPayer: input.reason.slice(0, 200) },
    });
    const parsed = refundResponseSchema.safeParse(response.result);
    if (!parsed.success) {
      throw new PaymentProviderError(
        'PAYMENT_PROVIDER_INVALID_RESPONSE',
        'Sandbox provider returned an invalid refund response.',
      );
    }
    return { refundId: parsed.data.id, status: parsed.data.status };
  } catch (error: unknown) {
    if (error instanceof PaymentProviderError) {
      throw error;
    }
    throw new PaymentProviderError(
      'PAYMENT_PROVIDER_ERROR',
      'Sandbox provider could not refund the capture.',
    );
  }
}

export async function voidPayPalAuthorization(input: {
  paymentId: string;
  authorizationId: string;
  attempt?: number;
  paymentCycle?: string;
}): Promise<void> {
  try {
    const response = await new PaymentsController(createSandboxClient()).voidPayment({
      authorizationId: input.authorizationId,
      paypalRequestId: requestIdentifier(input.paymentId, 'void', input.attempt, input.paymentCycle),
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new PaymentProviderError(
        'PAYMENT_PROVIDER_INVALID_RESPONSE',
        'Sandbox provider did not confirm the authorization void.',
      );
    }
  } catch (error: unknown) {
    if (error instanceof PaymentProviderError) {
      throw error;
    }
    throw new PaymentProviderError(
      'PAYMENT_PROVIDER_ERROR',
      'Sandbox provider could not void the authorization.',
    );
  }
}

const signatureResponseSchema = z.object({
  verification_status: z.string(),
}).passthrough();

export async function verifyPayPalWebhookSignature(
  headers: Headers,
  event: PayPalWebhookEvent,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) {
    throw new PaymentProviderError(
      'PAYMENT_PROVIDER_UNAVAILABLE',
      'Sandbox webhook identifier is not configured.',
    );
  }

  const transmission = {
    authAlgo: headers.get('paypal-auth-algo'),
    certUrl: headers.get('paypal-cert-url'),
    transmissionId: headers.get('paypal-transmission-id'),
    transmissionSig: headers.get('paypal-transmission-sig'),
    transmissionTime: headers.get('paypal-transmission-time'),
  };
  if (Object.values(transmission).some((value) => !value)) {
    return false;
  }

  const client = createSandboxClient();
  try {
    const token = await client.clientCredentialsAuthManager.fetchToken();
    const response = await fetcher(`${sandboxApiBaseUrl}/v1/notifications/verify-webhook-signature`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        auth_algo: transmission.authAlgo,
        cert_url: transmission.certUrl,
        transmission_id: transmission.transmissionId,
        transmission_sig: transmission.transmissionSig,
        transmission_time: transmission.transmissionTime,
        webhook_id: webhookId,
        webhook_event: event,
      }),
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new PaymentProviderError(
        'PAYMENT_WEBHOOK_VERIFICATION_UNAVAILABLE',
        'Sandbox provider could not verify the webhook.',
      );
    }
    const result = signatureResponseSchema.safeParse(await response.json());
    if (!result.success) {
      throw new PaymentProviderError(
        'PAYMENT_WEBHOOK_VERIFICATION_UNAVAILABLE',
        'Sandbox provider returned an invalid webhook verification response.',
      );
    }
    return result.data.verification_status === 'SUCCESS';
  } catch (error: unknown) {
    if (error instanceof PaymentProviderError) {
      throw error;
    }
    throw new PaymentProviderError(
      'PAYMENT_WEBHOOK_VERIFICATION_UNAVAILABLE',
      'Sandbox provider could not verify the webhook.',
    );
  }
}
