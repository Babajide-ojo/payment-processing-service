# Payment processing

A small Node.js service that accepts a payment, stores it in a JSON file, and simulates processing in the background.

## Setup

Node.js 22 or newer is required.

```bash
npm install
npm start
```

The server listens on port 3000. Set `PORT` to use another port.

```bash
PORT=3010 npm start
```

## Swagger

Swagger UI is served by the same process. Open `http://localhost:3000/docs` and use Try it out to call the endpoints. Change `3000` if you set `PORT`.

The OpenAPI document is at `http://localhost:3000/openapi.json`. `POST /payments` includes the optional `Idempotency-Key` and `X-Api-Key-Id` headers.

Payments are written to `data/payments.json`. That directory is created on the first successful create.

## API

Amounts are integers in minor units. `5000` with currency `NGN` is ₦50.00.

### Create a payment

`POST /payments`

Send a client-generated `Idempotency-Key` when a retry must return the original payment. The key must be 16 to 64 characters and may contain only letters, digits, `-`, and `_`. Any other value returns `400`.

If you omit `Idempotency-Key`, the server generates a UUID and returns it in the `Idempotency-Key` response header. That request has no retry protection. The client did not choose the key, so a lost response cannot be retried safely, and a later create without that same key starts a new payment.

`X-Api-Key-Id` scopes the key to one caller. Two callers can send the same `Idempotency-Key` and each gets their own payment. They cannot replay or see the other caller's payment through that key. If you omit `X-Api-Key-Id`, the caller id is `anonymous` and those requests share one scope.

```json
{
  "amountMinor": 5000,
  "currency": "NGN",
  "customerEmail": "ada@example.com"
}
```

The first create for a caller and key is `201`. The payment starts as `pending`. The JSON body does not include the idempotency key. The `Idempotency-Key` response header is the key that was stored. The server generates `reference`.

The stored record includes a SHA-256 fingerprint of the normalized body, in this fixed order: `amountMinor|currency|customerEmail`. Currency is uppercased. Email is trimmed and lowercased. Different letter case or surrounding spaces on the email are the same request.

- The same caller, the same key, and the same fingerprint returns the original payment with `200` and the `Idempotency-Key` response header. Processing does not start again.
- The same caller, the same key, and a different fingerprint returns `409` with code `IDEMPOTENCY_KEY_REUSED`.
- A key that has not been used by that caller creates a payment. It does not return `404`.

Background processing then moves the payment to `processing`, then to `succeeded`. It starts only after the payment has been saved, and only for a payment created by that request. It does not block the create response. If processing throws, and the payment is still `pending` or `processing`, the status is set to `failed`. A status you set yourself is not overwritten. Background processing does not change a payment that is already `succeeded`, `failed`, or `cancelled`.

Creates and status changes share one in-process write queue. The key lookup, fingerprint check, insert, and file write for a create run in the same turn of that queue. An in-memory index by id, reference, and `(apiKeyId, idempotencyKey)` is rebuilt from the file when the process starts and changes only after a write succeeds.

### Retrieve a payment

`GET /payments/:id`

`:id` is the payment id or the `reference`. An idempotency key is not a lookup id.

### Update a status

`PATCH /payments/:id` or `PUT /payments/:id`

```json
{ "status": "failed" }
```

`:id` is the payment id or the `reference`. Allowed statuses are `pending`, `processing`, `succeeded`, `failed`, and `cancelled`.

`succeeded`, `failed`, and `cancelled` are terminal. Once a payment has one of those statuses, `PATCH` and `PUT` return `409` with code `terminal_status` and leave the payment unchanged.

## Errors

Failed requests use this shape:

```json
{
  "error": {
    "code": "invalid_amount",
    "message": "amountMinor must be a positive integer in minor units"
  }
}
```

| Status | When |
| --- | --- |
| `400` | The body, amount, currency, email, status, or idempotency key is invalid |
| `404` | The payment does not exist |
| `409` | The idempotency key was already used for a different request (`IDEMPOTENCY_KEY_REUSED`), or the payment is already `succeeded`, `failed`, or `cancelled` (`terminal_status`) |
| `413` | The JSON body is larger than 100 KB |
| `500` | The payment file cannot be read, or another unexpected error occurs |

Request logs are one JSON line per response. They include the method, path, status, and duration. When the request includes an `Idempotency-Key` longer than 8 characters, the log includes those first 8 characters and nothing more of the key. Logs do not include the body.

## Tests

```bash
npm test
```

The tests start the app on a random local port and use a temporary JSON file. They cover create, background completion, background failure, idempotent replay, a reused key, caller-scoped keys, lookup by reference, status updates, error responses, and the Swagger UI.
