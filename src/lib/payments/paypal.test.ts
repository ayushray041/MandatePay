import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createOrder: vi.fn(),
  authorizeOrder: vi.fn(),
  captureAuthorizedPayment: vi.fn(),
  voidPayment: vi.fn(),
  refundCapturedPayment: vi.fn(),
  fetchToken: vi.fn(),
  clientConfig: vi.fn(),
}));

vi.mock('@paypal/paypal-server-sdk', () => ({
  CheckoutPaymentIntent: { Authorize: 'AUTHORIZE' },
  Client: vi.fn(function (configuration: unknown) {
    mocks.clientConfig(configuration);
    return { clientCredentialsAuthManager: { fetchToken: mocks.fetchToken } };
  }),
  Environment: { Sandbox: 'Sandbox' },
  OrdersController: vi.fn(function () {
    return {
      createOrder: mocks.createOrder,
      authorizeOrder: mocks.authorizeOrder,
    };
  }),
  PaymentsController: vi.fn(function () {
    return {
      captureAuthorizedPayment: mocks.captureAuthorizedPayment,
      voidPayment: mocks.voidPayment,
      refundCapturedPayment: mocks.refundCapturedPayment,
    };
  }),
}));

import {
  authorizePayPalOrder,
  capturePayPalAuthorization,
  createPayPalOrder,
  isPayPalConfigured,
  refundPayPalCapture,
  verifyPayPalWebhookSignature,
  voidPayPalAuthorization,
} from '@/lib/payments/paypal';

const paymentInput = {
  paymentId: 'payment-abc123',
  amountMinor: 125_000,
  currency: 'USD',
  description: 'Contract payment',
};

const webhookEvent = {
  id: 'WH-EVENT-1',
  event_type: 'PAYMENT.AUTHORIZATION.CREATED',
  resource: { id: 'AUTH-1' },
};

const webhookHeaders = new Headers({
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api-m.sandbox.paypal.com/cert',
  'paypal-transmission-id': 'TRANSMISSION-1',
  'paypal-transmission-sig': 'signature',
  'paypal-transmission-time': '2026-11-12T00:00:00Z',
});

describe('PayPal sandbox provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PAYPAL_CLIENT_ID', 'sandbox-client-id');
    vi.stubEnv('PAYPAL_CLIENT_SECRET', 'sandbox-client-secret');
    vi.stubEnv('PAYPAL_WEBHOOK_ID', 'sandbox-webhook-id');
    vi.stubEnv('APP_BASE_URL', 'https://mandatepay.example.test');
    mocks.createOrder.mockResolvedValue({
      result: {
        id: 'ORDER123',
        status: 'CREATED',
        links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER123' }],
        purchaseUnits: [{
          amount: { currencyCode: 'USD', value: '1250.00' },
        }],
      },
    });
    mocks.authorizeOrder.mockResolvedValue({
      result: {
        id: 'ORDER123',
        purchaseUnits: [{
          payments: {
            authorizations: [{
              id: 'AUTH123',
              status: 'CREATED',
              amount: { currencyCode: 'USD', value: '1250.00' },
            }],
          },
        }],
      },
    });
    mocks.captureAuthorizedPayment.mockResolvedValue({
      result: {
        id: 'CAPTURE123',
        status: 'COMPLETED',
        amount: { currencyCode: 'USD', value: '1250.00' },
      },
    });
    mocks.voidPayment.mockResolvedValue({ statusCode: 204 });
    mocks.refundCapturedPayment.mockResolvedValue({
      result: { id: 'REFUND123', status: 'COMPLETED' },
    });
    mocks.fetchToken.mockResolvedValue({ accessToken: 'sandbox-access-token' });
  });

  it('pins server SDK requests to sandbox and builds the order amount from minor units', async () => {
    const order = await createPayPalOrder(paymentInput);

    expect(order).toEqual({
      orderId: 'ORDER123',
      approvalUrl: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER123',
    });
    expect(mocks.clientConfig).toHaveBeenCalledWith(expect.objectContaining({
      environment: 'Sandbox',
      clientCredentialsAuthCredentials: {
        oAuthClientId: 'sandbox-client-id',
        oAuthClientSecret: 'sandbox-client-secret',
      },
    }));
    expect(mocks.createOrder).toHaveBeenCalledWith(expect.objectContaining({
      paypalRequestId: 'mandatepay-payment-abc123-create',
      body: expect.objectContaining({
        intent: 'AUTHORIZE',
        purchaseUnits: [expect.objectContaining({
          amount: { currencyCode: 'USD', value: '1250.00' },
        })],
      }),
    }));
  });

  it('rejects provider orders with an amount mismatch or a non-sandbox approval link', async () => {
    mocks.createOrder.mockResolvedValueOnce({
      result: {
        id: 'ORDER123',
        status: 'CREATED',
        links: [{ rel: 'approve', href: 'https://www.sandbox.paypal.com/checkoutnow' }],
        purchaseUnits: [{ amount: { currencyCode: 'USD', value: '1.00' } }],
      },
    });
    await expect(createPayPalOrder(paymentInput)).rejects.toThrow('invalid order response');

    mocks.createOrder.mockResolvedValueOnce({
      result: {
        id: 'ORDER123',
        status: 'CREATED',
        links: [{ rel: 'approve', href: 'https://www.paypal.com/checkoutnow' }],
        purchaseUnits: [{ amount: { currencyCode: 'USD', value: '1250.00' } }],
      },
    });
    await expect(createPayPalOrder(paymentInput)).rejects.toThrow('unsafe approval link');
  });

  it('validates provider authorization and capture amounts and returns provider state', async () => {
    await expect(authorizePayPalOrder({
      ...paymentInput,
      orderId: 'ORDER123',
    })).resolves.toEqual({ authorizationId: 'AUTH123', status: 'CREATED' });
    await expect(capturePayPalAuthorization({
      ...paymentInput,
      authorizationId: 'AUTH123',
    })).resolves.toEqual({ captureId: 'CAPTURE123', status: 'COMPLETED' });

    mocks.captureAuthorizedPayment.mockResolvedValueOnce({
      result: {
        id: 'CAPTURE123',
        status: 'COMPLETED',
        amount: { currencyCode: 'USD', value: '1.00' },
      },
    });
    await expect(capturePayPalAuthorization({
      ...paymentInput,
      authorizationId: 'AUTH123',
    })).rejects.toThrow('invalid capture response');
  });

  it('uses idempotent sandbox operations for voids and refunds', async () => {
    await expect(voidPayPalAuthorization({
      paymentId: paymentInput.paymentId,
      authorizationId: 'AUTH123',
    })).resolves.toBeUndefined();
    await expect(refundPayPalCapture({
      paymentId: paymentInput.paymentId,
      captureId: 'CAPTURE123',
      reason: 'Duplicate payment',
    })).resolves.toEqual({ refundId: 'REFUND123', status: 'COMPLETED' });

    expect(mocks.voidPayment).toHaveBeenCalledWith(expect.objectContaining({
      paypalRequestId: 'mandatepay-payment-abc123-void',
    }));
    expect(mocks.refundCapturedPayment).toHaveBeenCalledWith(expect.objectContaining({
      paypalRequestId: 'mandatepay-payment-abc123-refund',
    }));
  });

  it('verifies webhook signatures with the sandbox verification endpoint and fails closed', async () => {
    const fetcher = vi.fn(async () => new Response(
      JSON.stringify({ verification_status: 'SUCCESS' }),
      { status: 200 },
    ));
    await expect(verifyPayPalWebhookSignature(webhookHeaders, webhookEvent, fetcher))
      .resolves.toBe(true);

    expect(fetcher).toHaveBeenCalledWith(
      'https://api-m.sandbox.paypal.com/v1/notifications/verify-webhook-signature',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sandbox-access-token',
        }),
      }),
    );

    await expect(verifyPayPalWebhookSignature(
      new Headers(),
      webhookEvent,
      fetcher,
    )).resolves.toBe(false);
    fetcher.mockResolvedValueOnce(new Response(
      JSON.stringify({ verification_status: 'FAILURE' }),
      { status: 200 },
    ));
    await expect(verifyPayPalWebhookSignature(webhookHeaders, webhookEvent, fetcher))
      .resolves.toBe(false);
  });

  it('requires server credentials and an HTTPS checkout callback URL', async () => {
    vi.stubEnv('PAYPAL_CLIENT_SECRET', '');
    expect(isPayPalConfigured()).toBe(false);
    await expect(createPayPalOrder(paymentInput)).rejects.toThrow('credentials are not configured');

    vi.stubEnv('PAYPAL_CLIENT_SECRET', 'sandbox-client-secret');
    vi.stubEnv('APP_BASE_URL', 'http://attacker.example.test');
    expect(isPayPalConfigured()).toBe(false);
    await expect(createPayPalOrder(paymentInput)).rejects.toThrow('must use HTTPS');
    expect(mocks.createOrder).not.toHaveBeenCalled();
  });
});
