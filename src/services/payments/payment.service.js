import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { anonymousCallerId, statusMessage, statuses, terminalStatuses } from '../../common/constants.js';
import { HttpError } from '../../common/http-error.js';

const defaultFilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/payments.json');

const delay = (milliseconds) => {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
};

const fingerprintFor = ({ amountMinor, currency, customerEmail }) => {
  return createHash('sha256').update(`${amountMinor}|${currency}|${customerEmail}`).digest('hex');
};

const resolveApiKeyId = (value) => {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  return anonymousCallerId;
};

const resolveIdempotencyKey = (value) => {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  return randomUUID();
};

export const createPaymentService = ({
  filePath = defaultFilePath,
  processingDelayMs = 400,
  runProcessing,
} = {}) => {
  let writeQueue = Promise.resolve();
  let ready = false;
  let records = [];
  const byId = new Map();
  const byReference = new Map();
  const byCallerKey = new Map();

  const enqueue = (task) => {
    const run = () => {
      return task();
    };
    const next = writeQueue.then(run, run);
    writeQueue = next.then(() => undefined, () => undefined);
    return next;
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

      if (error instanceof HttpError) {
        throw error;
      }

      if (error instanceof SyntaxError) {
        throw new HttpError(500, 'storage_error', 'Payment store is invalid');
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

  const remember = (payment) => {
    byId.set(payment.id, payment);
    byReference.set(payment.reference, payment);

    let callerKeys = byCallerKey.get(payment.apiKeyId);

    if (!callerKeys) {
      callerKeys = new Map();
      byCallerKey.set(payment.apiKeyId, callerKeys);
    }

    if (typeof payment.idempotencyKey === 'string' && payment.idempotencyKey.length > 0) {
      callerKeys.set(payment.idempotencyKey, payment);
    }
  };

  const rebuildIndex = () => {
    byId.clear();
    byReference.clear();
    byCallerKey.clear();

    for (const payment of records) {
      remember(payment);
    }
  };

  const ensureLoaded = async () => {
    if (ready) {
      return;
    }

    const stored = await readPayments();
    const loaded = [];

    for (const payment of stored) {
      loaded.push({
        ...payment,
        apiKeyId: resolveApiKeyId(payment.apiKeyId),
      });
    }

    records = loaded;
    rebuildIndex();
    ready = true;
  };

  const commit = async (nextRecords) => {
    await writePayments(nextRecords);
    records = nextRecords;
    rebuildIndex();
  };

  const savePayment = async (updated) => {
    const nextRecords = records.map((current) => {
      if (current.id === updated.id) {
        return updated;
      }

      return current;
    });

    await commit(nextRecords);
  };

  const findPayment = (identifier) => {
    const byIdentifier = byId.get(identifier);

    if (byIdentifier) {
      return byIdentifier;
    }

    const byRef = byReference.get(identifier);

    if (byRef) {
      return byRef;
    }

    return null;
  };

  const findByIdempotency = (apiKeyId, idempotencyKey) => {
    const callerKeys = byCallerKey.get(apiKeyId);

    if (!callerKeys) {
      return null;
    }

    return callerKeys.get(idempotencyKey) || null;
  };

  const createUniqueValue = (field, prefix, size) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const value = `${prefix}${randomBytes(size).toString('hex')}`;
      const taken = records.some((payment) => payment[field] === value);

      if (!taken) {
        return value;
      }
    }

    throw new HttpError(500, 'identifier_error', 'Could not generate a unique payment identifier');
  };

  const setStatusWhen = async (id, fromStatus, toStatus) => {
    return enqueue(async () => {
      await ensureLoaded();
      const payment = findPayment(id);

      if (!payment || terminalStatuses.has(payment.status) || payment.status !== fromStatus) {
        return null;
      }

      const updated = {
        ...payment,
        status: toStatus,
        updatedAt: new Date().toISOString(),
      };

      await savePayment(updated);
      return { ...updated };
    });
  };

  const markFailed = async (id) => {
    return enqueue(async () => {
      await ensureLoaded();
      const payment = findPayment(id);

      if (!payment || terminalStatuses.has(payment.status)) {
        return null;
      }

      if (payment.status !== 'pending' && payment.status !== 'processing') {
        return null;
      }

      const updated = {
        ...payment,
        status: 'failed',
        updatedAt: new Date().toISOString(),
      };

      await savePayment(updated);
      return { ...updated };
    });
  };

  const builtInProcessPayment = async (id) => {
    await delay(processingDelayMs);
    const processing = await setStatusWhen(id, 'pending', 'processing');

    if (!processing) {
      return;
    }

    await delay(processingDelayMs);
    await setStatusWhen(id, 'processing', 'succeeded');
  };

  const processPayment = runProcessing || builtInProcessPayment;

  const simulatePayment = (id) => {
    processPayment(id).catch(async (error) => {
      console.error(JSON.stringify({
        event: 'payment_processing_failed',
        paymentId: id,
        message: error.message,
      }));

      try {
        await markFailed(id);
      } catch (updateError) {
        console.error(JSON.stringify({
          event: 'payment_failure_not_recorded',
          paymentId: id,
          message: updateError.message,
        }));
      }
    });
  };

  const createPayment = async (input) => {
    const result = await enqueue(async () => {
      await ensureLoaded();

      const apiKeyId = resolveApiKeyId(input.apiKeyId);
      const idempotencyKey = resolveIdempotencyKey(input.idempotencyKey);
      const currency = input.currency.toUpperCase();
      const customerEmail = input.customerEmail.trim().toLowerCase();
      const { amountMinor } = input;
      const fingerprint = fingerprintFor({
        amountMinor,
        currency,
        customerEmail,
      });
      const existing = findByIdempotency(apiKeyId, idempotencyKey);

      if (existing && existing.fingerprint !== fingerprint) {
        throw new HttpError(409, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency key was already used with a different request');
      }

      if (existing) {
        return {
          payment: { ...existing },
          created: false,
        };
      }

      const now = new Date().toISOString();
      const payment = {
        id: randomUUID(),
        reference: createUniqueValue('reference', 'pay_', 8),
        apiKeyId,
        idempotencyKey,
        fingerprint,
        amountMinor,
        currency,
        customerEmail,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };

      await commit([...records, payment]);

      return {
        payment: { ...payment },
        created: true,
      };
    });

    if (result.created) {
      simulatePayment(result.payment.id);
    }

    return result;
  };

  const getPayment = async (id) => {
    return enqueue(async () => {
      await ensureLoaded();
      const payment = findPayment(id);

      if (!payment) {
        throw new HttpError(404, 'payment_not_found', 'Payment not found');
      }

      return { ...payment };
    });
  };

  const updatePaymentStatus = async (id, status) => {
    if (!statuses.has(status)) {
      throw new HttpError(400, 'invalid_status', statusMessage);
    }

    return enqueue(async () => {
      await ensureLoaded();
      const payment = findPayment(id);

      if (!payment) {
        throw new HttpError(404, 'payment_not_found', 'Payment not found');
      }

      if (terminalStatuses.has(payment.status)) {
        throw new HttpError(409, 'terminal_status', 'A succeeded, failed, or cancelled payment cannot be updated');
      }

      const updated = {
        ...payment,
        status,
        updatedAt: new Date().toISOString(),
      };

      await savePayment(updated);
      return { ...updated };
    });
  };

  enqueue(() => ensureLoaded()).catch((error) => {
    console.error(JSON.stringify({
      event: 'payment_store_load_failed',
      message: error.message,
    }));
  });

  return {
    createPayment,
    getPayment,
    updatePaymentStatus,
  };
};

const paymentService = createPaymentService();

export const createPayment = paymentService.createPayment;
export const getPayment = paymentService.getPayment;
export const updatePaymentStatus = paymentService.updatePaymentStatus;
