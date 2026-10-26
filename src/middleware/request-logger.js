export const idempotencyKeyPrefix = (value) => {
  if (typeof value !== 'string' || value.length <= 8) {
    return null;
  }

  return value.slice(0, 8);
};

const isDocsRequest = (request) => {
  const pathName = request.originalUrl.split('?')[0];

  if (pathName === '/openapi.json' || pathName === '/docs' || pathName.startsWith('/docs/')) {
    return true;
  }

  return false;
};

export const requestLogger = (request, response, next) => {
  if (isDocsRequest(request)) {
    next();
    return;
  }

  const startedAt = Date.now();
  const keyPrefix = idempotencyKeyPrefix(request.get('idempotency-key'));

  response.on('finish', () => {
    const entry = {
      event: 'request',
      method: request.method,
      path: request.originalUrl,
      status: response.statusCode,
      durationMs: Date.now() - startedAt,
    };

    if (keyPrefix) {
      entry.idempotencyKeyPrefix = keyPrefix;
    }

    console.log(JSON.stringify(entry));
  });

  next();
};
