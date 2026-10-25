import { HttpError } from '../../common/http-error.js';
import { createPayment, getPayment, updatePaymentStatus } from '../../services/payments/payment.service.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = new Set(['pending', 'processing', 'succeeded', 'failed']);

const readBody = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_body', 'Request body must be a JSON object');
  }

  return body;
};

const readPaymentId = (value) => {
  if (typeof value !== 'string' || !uuidPattern.test(value)) {
    throw new HttpError(404, 'payment_not_found', 'Payment not found');
  }

  return value;
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
  const payment = await createPayment({
    amountMinor: readAmount(body.amountMinor),
    currency: readCurrency(body.currency),
    customerEmail: readEmail(body.customerEmail),
  });

  response.status(201).json({ payment: toPayment(payment) });
};

export const getPaymentHandler = async (request, response) => {
  const payment = await getPayment(readPaymentId(request.params.id));
  response.status(200).json({ payment: toPayment(payment) });
};

export const updatePaymentHandler = async (request, response) => {
  const body = readBody(request.body);
  const payment = await updatePaymentStatus(readPaymentId(request.params.id), readStatus(body.status));
  response.status(200).json({ payment: toPayment(payment) });
};
