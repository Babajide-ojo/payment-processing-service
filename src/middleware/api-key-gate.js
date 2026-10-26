import { timingSafeEqual } from 'node:crypto';
import { HttpError } from '../common/http-error.js';

const matchesApiKeyId = (provided, expected) => {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }

  if (provided.length === 0 || expected.length === 0) {
    return false;
  }

  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);

  if (providedBytes.length !== expectedBytes.length) {
    return false;
  }

  return timingSafeEqual(providedBytes, expectedBytes);
};

export const createApiKeyGate = (expectedApiKeyId) => {
  return (request, _response, next) => {
    const provided = request.get('x-api-key-id');

    if (!matchesApiKeyId(provided, expectedApiKeyId)) {
      next(new HttpError(401, 'invalid_api_key', 'X-Api-Key-Id does not match'));
      return;
    }

    request.apiKeyId = provided;
    next();
  };
};
