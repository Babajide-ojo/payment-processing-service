import { HttpError } from '../../common/http-error.js';
import { createPayment, getPayment, updatePaymentStatus } from '../../services/payments/payment.service.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const referencePattern = /^pay_[0-9a-f]{16}$/;
const idempotencyPattern = /^idem_[0-9a-f]{32}$/;
const statuses = new Set(['pending', 'processing', 'succeeded', 'failed']);

const readBody = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_body', 'Request body must be a JSON object');
  }

  return body;
};

const readPaymentIdentifier = (value) => {
  if (typeof value !== 'string') {
    throw new HttpError(404, 'payment_not_found', 'Payment not found');
  }

  if (uuidPattern.test(value) || referencePattern.test(value) || idempotencyPattern.test(value)) {
    return value;
  }

  throw new HttpError(404, 'payment_not_found', 'Payment not found');
};

const readIdempotencyKey = (request) => {
  const key = request.get('idempotency-key');

  if (key === undefined) {
    return null;
  }

  if (!idempotencyPattern.test(key)) {
    throw new HttpError(400, 'invalid_idempotency_key', 'Idempotency-Key must be a key generated for a payment');
  }

  return key;
};

const readAmount = (value) => {
  if (!Number.isInteger(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new HttpError(400, 'invalid_amount', 'amountMinor must be a positive integer in minor units');
  }

  return value;
};

const readCurrency = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) {
    throw new HttpError(400, 'invalid_currency', 'currency must be a 3-letter ISO code');
  }

  return value.toUpperCase();
};

const readEmail = (value) => {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'invalid_email', 'customerEmail must be an email address');
  }

  const email = value.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'invalid_email', 'customerEmail must be an email address');
  }

  return email;
};

const readStatus = (value) => {
  if (typeof value !== 'string' || !statuses.has(value)) {
    throw new HttpError(400, 'invalid_status', 'status must be pending, processing, succeeded, or failed');
  }

  return value;
};

const toPayment = (payment) => {
  return {
    id: payment.id,
    reference: payment.reference,
    idempotencyKey: payment.idempotencyKey,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    customerEmail: payment.customerEmail,
    status: payment.status,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
};

export const createPaymentHandler = async (request, response) => {
  const body = readBody(request.body);
  const result = await createPayment({
    idempotencyKey: readIdempotencyKey(request),
    amountMinor: readAmount(body.amountMinor),
    currency: readCurrency(body.currency),
    customerEmail: readEmail(body.customerEmail),
  });

  let statusCode = 200;

  if (result.created) {
    statusCode = 201;
  }

  response.status(statusCode).json({ payment: toPayment(result.payment) });
};

export const getPaymentHandler = async (request, response) => {
  const payment = await getPayment(readPaymentIdentifier(request.params.id));
  response.status(200).json({ payment: toPayment(payment) });
};

export const updatePaymentHandler = async (request, response) => {
  const body = readBody(request.body);
  const payment = await updatePaymentStatus(readPaymentIdentifier(request.params.id), readStatus(body.status));
  response.status(200).json({ payment: toPayment(payment) });
};
