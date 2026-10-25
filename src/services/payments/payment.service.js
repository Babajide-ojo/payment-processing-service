import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from '../../common/http-error.js';

const filePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/payments.json');
const processingDelayMs = 400;
const statuses = new Set(['pending', 'processing', 'succeeded', 'failed']);

let writeQueue = Promise.resolve();

const delay = (milliseconds) => {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

const readPayments = async () => {
  try {
    const contents = await readFile(filePath, 'utf8');
    const parsed = JSON.parse(contents);

    if (!Array.isArray(parsed)) {
      throw new HttpError(500, 'storage_error', 'Payment store is invalid');
    }

    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }

    throw error;
  }
};

const writePayments = async (payments) => {
  const temporaryPath = `${filePath}.tmp`;

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(payments, null, 2)}\n`);
  await rename(temporaryPath, filePath);
};

const updatePayments = (mutate) => {
  const run = async () => {
    const payments = await readPayments();
    const result = mutate(payments);
    await writePayments(payments);
    return result;
  };

  const next = writeQueue.then(run, run);
  writeQueue = next.then(() => undefined, () => undefined);
  return next;
};

const findPayment = (payments, identifier) => {
  return payments.find((payment) => {
    return payment.id === identifier || payment.reference === identifier || payment.idempotencyKey === identifier;
  });
};

const matchesRequest = (payment, input) => {
  if (payment.amountMinor !== input.amountMinor) {
    return false;
  }

  if (payment.currency !== input.currency) {
    return false;
  }

  if (payment.customerEmail !== input.customerEmail) {
    return false;
  }

  return true;
};

const createUniqueValue = (payments, field, prefix, size) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const value = `${prefix}${randomBytes(size).toString('hex')}`;
    const taken = payments.some((payment) => payment[field] === value);

    if (!taken) {
      return value;
    }
  }

  throw new HttpError(500, 'identifier_error', 'Could not generate a unique payment identifier');
};

const setStatusWhen = async (id, fromStatus, toStatus) => {
  return updatePayments((payments) => {
    const payment = findPayment(payments, id);

    if (!payment || payment.status !== fromStatus) {
      return null;
    }

    payment.status = toStatus;
    payment.updatedAt = new Date().toISOString();
    return { ...payment };
  });
};

const processPayment = async (id) => {
  await delay(processingDelayMs);
  const processing = await setStatusWhen(id, 'pending', 'processing');

  if (!processing) {
    return;
  }

  await delay(processingDelayMs);
  await setStatusWhen(id, 'processing', 'succeeded');
};

const simulatePayment = (id) => {
  processPayment(id).catch((error) => {
    console.error('Payment processing failed', error.message);
  });
};

export const createPayment = async (input) => {
  const result = await updatePayments((payments) => {
    if (input.idempotencyKey) {
      const existing = payments.find((payment) => payment.idempotencyKey === input.idempotencyKey);

      if (!existing) {
        throw new HttpError(404, 'idempotency_key_not_found', 'Idempotency key was not found');
      }

      if (!matchesRequest(existing, input)) {
        throw new HttpError(409, 'idempotency_conflict', 'Idempotency key was already used with a different request');
      }

      return { payment: { ...existing }, created: false };
    }

    const now = new Date().toISOString();
    const payment = {
      id: randomUUID(),
      reference: createUniqueValue(payments, 'reference', 'pay_', 8),
      idempotencyKey: createUniqueValue(payments, 'idempotencyKey', 'idem_', 16),
      amountMinor: input.amountMinor,
      currency: input.currency,
      customerEmail: input.customerEmail,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    };

    payments.push(payment);
    return { payment: { ...payment }, created: true };
  });

  if (result.created) {
    simulatePayment(result.payment.id);
  }

  return result;
};

export const getPayment = async (id) => {
  const payments = await readPayments();
  const payment = findPayment(payments, id);

  if (!payment) {
    throw new HttpError(404, 'payment_not_found', 'Payment not found');
  }

  return payment;
};

export const updatePaymentStatus = async (id, status) => {
  if (!statuses.has(status)) {
    throw new HttpError(400, 'invalid_status', 'status must be pending, processing, succeeded, or failed');
  }

  return updatePayments((payments) => {
    const payment = findPayment(payments, id);

    if (!payment) {
      throw new HttpError(404, 'payment_not_found', 'Payment not found');
    }

    payment.status = status;
    payment.updatedAt = new Date().toISOString();
    return { ...payment };
  });
};
