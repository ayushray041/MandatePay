import { adminFirestore } from '@/lib/firebase/admin';
import { authenticateRequest } from '@/lib/api/auth';
import { apiError, apiSuccess } from '@/lib/api/responses';
import { PaymentError, paymentErrorResponse } from '@/lib/payments/errors';
import { formatPayment, formatPaymentEvent } from '@/lib/payments/format';

type RouteContext = { params: Promise<{ paymentId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const authentication = await authenticateRequest(request);
  if (!authentication.authenticated) {
    return authentication.response;
  }
  if (!adminFirestore) {
    return apiError(503, 'SERVICE_UNAVAILABLE', 'Payment storage is unavailable.');
  }

  const { paymentId } = await context.params;
  const paymentRef = adminFirestore.collection('payments').doc(paymentId);
  try {
    const snapshot = await paymentRef.get();
    if (!snapshot.exists) {
      return apiError(404, 'PAYMENT_NOT_FOUND', 'Payment was not found.');
    }
    const payment = snapshot.data();
    if (
      !payment
      || !Array.isArray(payment.participantIds)
      || !payment.participantIds.includes(authentication.user.uid)
    ) {
      throw new PaymentError(404, 'PAYMENT_NOT_FOUND', 'Payment was not found.');
    }
    const events = await paymentRef.collection('events').orderBy('sequence', 'asc').get();
    return apiSuccess({
      payment: formatPayment(snapshot.id, payment),
      events: events.docs.map((event) => formatPaymentEvent(event.id, event.data())),
    });
  } catch (error: unknown) {
    return paymentErrorResponse(error);
  }
}
