import { idempotencyKeyPattern, referencePattern, statusMessage, statuses, uuidPattern } from '../../common/constants.js';
import { HttpError } from '../../common/http-error.js';

export const readBody = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_body', 'Request body must be a JSON object');
  }

  return body;
};

export const readPaymentIdentifier = (value) => {
  if (typeof value !== 'string') {
    throw new HttpError(404, 'payment_not_found', 'Payment not found');
  }

  if (uuidPattern.test(value) || referencePattern.test(value)) {
    return value;
  }

  throw new HttpError(404, 'payment_not_found', 'Payment not found');
};

export const readIdempotencyKey = (request) => {
  const key = request.get('idempotency-key');

  if (key === undefined) {
    return null;
  }

  if (typeof key !== 'string' || !idempotencyKeyPattern.test(key)) {
    throw new HttpError(400, 'invalid_idempotency_key', 'Idempotency-Key must be 16 to 64 characters and use only letters, digits, hyphens, and underscores');
  }

  return key;
};

export const readApiKeyId = (request) => {
  if (typeof request.apiKeyId === 'string' && request.apiKeyId.length > 0) {
    return request.apiKeyId;
  }

  const header = request.get('x-api-key-id');

  if (typeof header !== 'string' || header.length === 0) {
    return null;
  }

  return header;
};

export const readAmount = (value) => {
  if (!Number.isInteger(value) || value <= 0 || value > Number.MAX_SAFE_INTEGER) {
    throw new HttpError(400, 'invalid_amount', 'amountMinor must be a positive integer in minor units');
  }

  return value;
};

export const readCurrency = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) {
    throw new HttpError(400, 'invalid_currency', 'currency must be a 3-letter ISO code');
  }

  return value.toUpperCase();
};

export const readEmail = (value) => {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'invalid_email', 'customerEmail must be an email address');
  }

  const email = value.trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'invalid_email', 'customerEmail must be an email address');
  }

  return email;
};

export const readStatus = (value) => {
  if (typeof value !== 'string' || !statuses.has(value)) {
    throw new HttpError(400, 'invalid_status', statusMessage);
  }

  return value;
};

export const toPayment = (payment) => {
  return {
    id: payment.id,
    reference: payment.reference,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    customerEmail: payment.customerEmail,
    status: payment.status,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
};
