import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { anonymousCallerId } from '../src/common/constants.js';
import { createApp } from '../src/app.js';
import { idempotencyKeyPrefix } from '../src/middleware/request-logger.js';
import { createPaymentService } from '../src/services/payments/payment.service.js';

const paymentBody = {
  amountMinor: 5000,
  currency: 'ngn',
  customerEmail: 'Ada@Example.com',
};

const publicFields = [
  'amountMinor',
  'createdAt',
  'currency',
  'customerEmail',
  'id',
  'reference',
  'status',
  'updatedAt',
];

const listen = (app) => {
  return new Promise((resolve) => {
    const server = createServer(app);

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        server,
        base: `http://127.0.0.1:${address.port}`,
      });
    });
  });
};

const close = (server) => {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

const request = async (base, pathName, options = {}) => {
  const response = await fetch(`${base}${pathName}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    body: options.body,
  });
  const text = await response.text();
  let json = null;

  if (text) {
    json = JSON.parse(text);
  }

  return {
    status: response.status,
    json,
    headers: response.headers,
  };
};

const waitForStatus = async (base, id, status) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await request(base, `/payments/${id}`);

    if (result.json.payment.status === status) {
      return result;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 15);
    });
  }

  throw new Error(`Payment did not reach status ${status}`);
};

const start = async (serviceOptions = {}) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'payments-'));
  const filePath = path.join(directory, 'payments.json');
  const service = createPaymentService({
    filePath,
    processingDelayMs: 0,
    ...serviceOptions,
  });
  const started = await listen(createApp(service));

  return {
    ...started,
    directory,
    filePath,
  };
};

const fingerprint = (amountMinor, currency, customerEmail) => {
  return createHash('sha256').update(`${amountMinor}|${currency}|${customerEmail}`).digest('hex');
};

test('creates a payment and completes it in the background', async () => {
  const { server, base, directory } = await start();

  try {
    const created = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
    });

    assert.equal(created.status, 201);
    assert.equal(created.json.payment.status, 'pending');
    assert.equal(created.json.payment.currency, 'NGN');
    assert.equal(created.json.payment.customerEmail, 'ada@example.com');
    assert.match(created.json.payment.reference, /^pay_[0-9a-f]{16}$/);
    assert.deepEqual(Object.keys(created.json.payment).sort(), publicFields);
    assert.match(created.headers.get('idempotency-key'), /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(created.headers.get('x-powered-by'), null);

    const completed = await waitForStatus(base, created.json.payment.id, 'succeeded');
    assert.equal(completed.json.payment.status, 'succeeded');
    assert.equal('idempotencyKey' in completed.json.payment, false);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('replays the same key and rejects a different body', async () => {
  const { server, base, directory, filePath } = await start({
    runProcessing: async () => undefined,
  });
  const key = 'client-key-000001';

  try {
    const created = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
      headers: { 'idempotency-key': key },
    });
    const replay = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify({
        amountMinor: 5000,
        currency: 'NGN',
        customerEmail: ' ada@example.com ',
      }),
      headers: { 'idempotency-key': key },
    });
    const conflict = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify({ ...paymentBody, amountMinor: 1000 }),
      headers: { 'idempotency-key': key },
    });
    const again = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
      headers: { 'idempotency-key': key },
    });
    const stored = JSON.parse(await readFile(filePath, 'utf8'));

    assert.equal(created.status, 201);
    assert.equal(created.headers.get('idempotency-key'), key);
    assert.equal('idempotencyKey' in created.json.payment, false);
    assert.equal(replay.status, 200);
    assert.equal(replay.json.payment.id, created.json.payment.id);
    assert.equal(replay.headers.get('idempotency-key'), key);
    assert.equal(replay.json.payment.status, 'pending');
    assert.equal(conflict.status, 409);
    assert.equal(conflict.json.error.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(conflict.json.payment, undefined);
    assert.equal(again.status, 200);
    assert.equal(again.json.payment.id, created.json.payment.id);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].idempotencyKey, key);
    assert.equal(stored[0].apiKeyId, anonymousCallerId);
    assert.equal(stored[0].fingerprint, fingerprint(5000, 'NGN', 'ada@example.com'));
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('creates a payment for an unknown key and rejects a malformed key', async () => {
  const { server, base, directory } = await start({
    runProcessing: async () => undefined,
  });

  try {
    const created = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
      headers: { 'idempotency-key': 'idem_' + 'a'.repeat(32) },
    });
    const missingHeader = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
    });
    const missingHeaderAgain = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
    });
    const tooShort = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
      headers: { 'idempotency-key': 'order-1001' },
    });
    const badCharacter = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
      headers: { 'idempotency-key': 'client key-000001' },
    });
    const tooLong = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
      headers: { 'idempotency-key': 'a'.repeat(65) },
    });
    const maxLength = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
      headers: { 'idempotency-key': 'b'.repeat(64) },
    });

    assert.equal(created.status, 201);
    assert.equal(missingHeader.status, 201);
    assert.equal(missingHeaderAgain.status, 201);
    assert.notEqual(missingHeader.json.payment.id, created.json.payment.id);
    assert.notEqual(missingHeaderAgain.json.payment.id, missingHeader.json.payment.id);
    assert.equal(tooShort.status, 400);
    assert.equal(tooShort.json.error.code, 'invalid_idempotency_key');
    assert.equal(badCharacter.status, 400);
    assert.equal(tooLong.status, 400);
    assert.equal(maxLength.status, 201);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('scopes the same idempotency key to each caller', async () => {
  const { server, base, directory } = await start({
    runProcessing: async () => undefined,
  });
  const key = 'shared-key-000001';

  try {
    const first = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
      headers: {
        'idempotency-key': key,
        'x-api-key-id': 'client-a',
      },
    });
    const second = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
      headers: {
        'idempotency-key': key,
        'x-api-key-id': 'client-b',
      },
    });
    const replay = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
      headers: {
        'idempotency-key': key,
        'x-api-key-id': 'client-a',
      },
    });

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.notEqual(first.json.payment.id, second.json.payment.id);
    assert.equal(replay.status, 200);
    assert.equal(replay.json.payment.id, first.json.payment.id);
    assert.equal('idempotencyKey' in replay.json.payment, false);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not start processing again for a replay', async () => {
  let runs = 0;
  const { server, base, directory } = await start({
    runProcessing: async () => {
      runs += 1;
    },
  });
  const key = 'client-key-000002';

  try {
    const created = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
      headers: { 'idempotency-key': key },
    });

    for (let attempt = 0; attempt < 30 && runs < 1; attempt += 1) {
      await new Promise((resolve) => {
        setTimeout(resolve, 15);
      });
    }

    const replay = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
      headers: { 'idempotency-key': key },
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 30);
    });

    assert.equal(created.status, 201);
    assert.equal(replay.status, 200);
    assert.equal(replay.json.payment.id, created.json.payment.id);
    assert.equal(runs, 1);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('serializes two creates that share an idempotency key', async () => {
  const { server, base, directory, filePath } = await start({
    runProcessing: async () => undefined,
  });
  const key = 'client-key-racing1';

  try {
    const [first, second] = await Promise.all([
      request(base, '/payments', {
        method: 'POST',
        body: JSON.stringify(paymentBody),
        headers: { 'idempotency-key': key },
      }),
      request(base, '/payments', {
        method: 'POST',
        body: JSON.stringify(paymentBody),
        headers: { 'idempotency-key': key },
      }),
    ]);
    const stored = JSON.parse(await readFile(filePath, 'utf8'));
    const statuses = [first.status, second.status].sort();

    assert.deepEqual(statuses, [200, 201]);
    assert.equal(first.json.payment.id, second.json.payment.id);
    assert.equal(stored.length, 1);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('fetches and updates a payment by reference but not by idempotency key', async () => {
  const { server, base, directory } = await start({
    runProcessing: async () => undefined,
  });
  const key = randomUUID();

  try {
    const created = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
      headers: { 'idempotency-key': key },
    });
    const reference = created.json.payment.reference;
    const fetched = await request(base, `/payments/${reference}`);
    const updated = await request(base, `/payments/${reference}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'processing' }),
    });
    const replaced = await request(base, `/payments/${created.json.payment.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'succeeded' }),
    });
    const byKey = await request(base, `/payments/${key}`);
    const patchedByKey = await request(base, `/payments/${key}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'failed' }),
    });

    assert.equal(fetched.status, 200);
    assert.equal(fetched.json.payment.id, created.json.payment.id);
    assert.equal('idempotencyKey' in fetched.json.payment, false);
    assert.equal(updated.json.payment.status, 'processing');
    assert.equal(replaced.json.payment.status, 'succeeded');
    assert.equal(byKey.status, 404);
    assert.equal(byKey.json.error.code, 'payment_not_found');
    assert.equal(patchedByKey.status, 404);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not overwrite a cancelled payment when processing fails', async () => {
  const { server, base, directory } = await start({
    runProcessing: async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 40);
      });
      throw new Error('processor unavailable');
    },
  });

  try {
    const created = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
    });
    const cancelled = await request(base, `/payments/${created.json.payment.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled' }),
    });

    await new Promise((resolve) => {
      setTimeout(resolve, 80);
    });

    const fetched = await request(base, `/payments/${created.json.payment.id}`);

    assert.equal(cancelled.status, 200);
    assert.equal(fetched.json.payment.status, 'cancelled');
    assert.equal(fetched.json.payment.updatedAt, cancelled.json.payment.updatedAt);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects further updates to a succeeded, failed, or cancelled payment', async () => {
  const { server, base, directory } = await start({
    runProcessing: async () => undefined,
  });

  const create = () => {
    return request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
    });
  };

  const setStatus = (id, status, method) => {
    return request(base, `/payments/${id}`, {
      method,
      body: JSON.stringify({ status }),
    });
  };

  try {
    const succeeded = await create();
    const markedSucceeded = await setStatus(succeeded.json.payment.reference, 'succeeded', 'PATCH');
    const blockedSucceeded = await setStatus(succeeded.json.payment.id, 'failed', 'PUT');
    const stillSucceeded = await request(base, `/payments/${succeeded.json.payment.id}`);

    const failed = await create();
    const markedFailed = await setStatus(failed.json.payment.id, 'failed', 'PUT');
    const blockedFailed = await setStatus(failed.json.payment.reference, 'cancelled', 'PATCH');
    const stillFailed = await request(base, `/payments/${failed.json.payment.id}`);

    const cancelled = await create();
    const markedCancelled = await setStatus(cancelled.json.payment.reference, 'cancelled', 'PATCH');
    const blockedCancelled = await setStatus(cancelled.json.payment.id, 'pending', 'PUT');
    const stillCancelled = await request(base, `/payments/${cancelled.json.payment.reference}`);

    assert.equal(markedSucceeded.status, 200);
    assert.equal(blockedSucceeded.status, 409);
    assert.equal(blockedSucceeded.json.error.code, 'terminal_status');
    assert.equal(stillSucceeded.json.payment.status, 'succeeded');
    assert.equal(stillSucceeded.json.payment.updatedAt, markedSucceeded.json.payment.updatedAt);

    assert.equal(markedFailed.status, 200);
    assert.equal(blockedFailed.status, 409);
    assert.equal(blockedFailed.json.error.code, 'terminal_status');
    assert.equal(stillFailed.json.payment.status, 'failed');
    assert.equal(stillFailed.json.payment.updatedAt, markedFailed.json.payment.updatedAt);

    assert.equal(markedCancelled.status, 200);
    assert.equal(markedCancelled.json.payment.status, 'cancelled');
    assert.equal(blockedCancelled.status, 409);
    assert.equal(blockedCancelled.json.error.code, 'terminal_status');
    assert.equal(stillCancelled.json.payment.status, 'cancelled');
    assert.equal(stillCancelled.json.payment.updatedAt, markedCancelled.json.payment.updatedAt);
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('returns errors for invalid input and an unknown payment', async () => {
  const { server, base, directory } = await start();

  try {
    const invalidAmount = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify({ ...paymentBody, amountMinor: 0 }),
    });
    const missing = await request(base, '/payments/00000000-0000-4000-8000-000000000000');
    const invalidStatus = await request(base, '/payments/00000000-0000-4000-8000-000000000000', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'paid' }),
    });
    const invalidJson = await request(base, '/payments', {
      method: 'POST',
      body: '{',
    });

    assert.equal(invalidAmount.status, 400);
    assert.equal(invalidAmount.json.error.code, 'invalid_amount');
    assert.equal(missing.status, 404);
    assert.equal(missing.json.error.code, 'payment_not_found');
    assert.equal(invalidStatus.status, 400);
    assert.equal(invalidStatus.json.error.code, 'invalid_status');
    assert.equal(invalidJson.status, 400);
    assert.equal(invalidJson.json.error.code, 'invalid_json');
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('returns a storage error when the payment file is unreadable', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'payments-'));
  const filePath = path.join(directory, 'payments.json');
  await writeFile(filePath, '{');
  const service = createPaymentService({ filePath, processingDelayMs: 0 });
  const { server, base } = await listen(createApp(service));

  try {
    const brokenStore = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
    });

    assert.equal(brokenStore.status, 500);
    assert.equal(brokenStore.json.error.code, 'storage_error');
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('marks a payment failed when background processing throws', async () => {
  const { server, base, directory } = await start({
    runProcessing: async () => {
      throw new Error('processor unavailable');
    },
  });

  try {
    const created = await request(base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
    });
    const failed = await waitForStatus(base, created.json.payment.id, 'failed');

    assert.equal(failed.json.payment.status, 'failed');
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('reloads caller idempotency keys from the payment file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'payments-'));
  const filePath = path.join(directory, 'payments.json');
  const key = 'client-key-reload1';
  const serviceOptions = {
    filePath,
    processingDelayMs: 0,
    runProcessing: async () => undefined,
  };
  const firstService = createPaymentService(serviceOptions);
  const first = await listen(createApp(firstService));
  let secondServer = null;

  try {
    const created = await request(first.base, '/payments', {
      method: 'POST',
      body: JSON.stringify(paymentBody),
      headers: {
        'idempotency-key': key,
        'x-api-key-id': 'client-a',
      },
    });

    assert.equal(created.status, 201);
    await close(first.server);

    const secondService = createPaymentService(serviceOptions);
    const second = await listen(createApp(secondService));
    secondServer = second.server;

    try {
      const replay = await request(second.base, '/payments', {
        method: 'POST',
        body: JSON.stringify(paymentBody),
        headers: {
          'idempotency-key': key,
          'x-api-key-id': 'client-a',
        },
      });
      const otherCaller = await request(second.base, '/payments', {
        method: 'POST',
        body: JSON.stringify(paymentBody),
        headers: {
          'idempotency-key': key,
          'x-api-key-id': 'client-b',
        },
      });
      const fetched = await request(second.base, `/payments/${created.json.payment.reference}`);

      assert.equal(replay.status, 200);
      assert.equal(replay.json.payment.id, created.json.payment.id);
      assert.equal(replay.headers.get('idempotency-key'), key);
      assert.equal(otherCaller.status, 201);
      assert.notEqual(otherCaller.json.payment.id, created.json.payment.id);
      assert.equal(fetched.status, 200);
      assert.equal(fetched.json.payment.id, created.json.payment.id);
    } finally {
      await close(secondServer);
    }
  } finally {
    if (first.server.listening) {
      await close(first.server);
    }

    await rm(directory, { recursive: true, force: true });
  }
});

test('serves Swagger UI and the OpenAPI document', async () => {
  const { server, base, directory } = await start({
    runProcessing: async () => undefined,
  });

  try {
    const redirect = await fetch(`${base}/docs`, { redirect: 'manual' });
    const docs = await fetch(`${base}/docs/`);
    const html = await docs.text();
    const stylesheet = await fetch(`${base}/docs/swagger-ui.css`);
    const initScript = await fetch(`${base}/docs/swagger-ui-init.js`);
    const initSource = await initScript.text();
    const specResponse = await fetch(`${base}/openapi.json`);
    const spec = await specResponse.json();

    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get('location'), '/docs/');
    assert.equal(docs.status, 200);
    assert.match(docs.headers.get('content-type'), /html/);
    assert.match(html, /swagger-ui/);
    assert.match(html, /Payment processing API/);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get('content-type'), /css/);
    assert.match(initSource, /\/openapi\.json/);
    assert.equal(specResponse.status, 200);
    assert.equal(spec.openapi, '3.0.3');
    assert.equal(typeof spec.paths['/payments'].post, 'object');
    assert.equal(typeof spec.paths['/payments/{id}'].get, 'object');
    assert.equal(typeof spec.paths['/payments/{id}'].patch, 'object');
    assert.equal(typeof spec.paths['/payments/{id}'].put, 'object');
  } finally {
    await close(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test('keeps an idempotency key prefix to at most 8 characters', () => {
  assert.equal(idempotencyKeyPrefix('client-key-000001'), 'client-k');
  assert.equal(idempotencyKeyPrefix('a'.repeat(8)), null);
  assert.equal(idempotencyKeyPrefix('short'), null);
  assert.equal(idempotencyKeyPrefix(undefined), null);
});
