export const statuses = new Set(['pending', 'processing', 'succeeded', 'failed', 'cancelled']);
export const terminalStatuses = new Set(['succeeded', 'failed', 'cancelled']);
export const statusMessage = 'status must be pending, processing, succeeded, failed, or cancelled';
export const anonymousCallerId = 'anonymous';

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const referencePattern = /^pay_[0-9a-f]{16}$/;
export const idempotencyKeyPattern = /^[A-Za-z0-9_-]{16,64}$/;
 