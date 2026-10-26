import {
  readAmount,
  readApiKeyId,
  readBody,
  readCurrency,
  readEmail,
  readIdempotencyKey,
  readPaymentIdentifier,
  readStatus,
  toPayment,
} from './payment.helper.js';

export const createPaymentHandlers = (service) => {
  const createPaymentHandler = async (request, response) => {
    const body = readBody(request.body);
    const result = await service.createPayment({
      apiKeyId: readApiKeyId(request),
      idempotencyKey: readIdempotencyKey(request),
      amountMinor: readAmount(body.amountMinor),
      currency: readCurrency(body.currency),
      customerEmail: readEmail(body.customerEmail),
    });

    let statusCode = 200;

    if (result.created) {
      statusCode = 201;
    }

    response.set('Idempotency-Key', result.payment.idempotencyKey);
    response.status(statusCode).json({ payment: toPayment(result.payment) });
  };

  const getPaymentHandler = async (request, response) => {
    const payment = await service.getPayment(readPaymentIdentifier(request.params.id));
    response.status(200).json({ payment: toPayment(payment) });
  };

  const updatePaymentHandler = async (request, response) => {
    const body = readBody(request.body);
    const payment = await service.updatePaymentStatus(readPaymentIdentifier(request.params.id), readStatus(body.status));
    response.status(200).json({ payment: toPayment(payment) });
  };

  return {
    createPaymentHandler,
    getPaymentHandler,
    updatePaymentHandler,
  };
};
