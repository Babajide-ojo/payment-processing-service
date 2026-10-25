import { randomUUID } from 'node:crypto';
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

const findPayment = (payments, id) => {
  return payments.find((payment) => payment.id === id);
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
  const now = new Date().toISOString();
  const payment = {
    id: randomUUID(),
    amountMinor: input.amountMinor,
    currency: input.currency,
    customerEmail: input.customerEmail,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };

  await updatePayments((payments) => {
    payments.push(payment);
    return payment;
  });

  simulatePayment(payment.id);
  return { ...payment };
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
