import { statuses } from '../common/constants.js';

const paymentStatusEnum = [...statuses];

const errorSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: {
          type: 'string',
          example: 'invalid_amount',
        },
        message: {
          type: 'string',
          example: 'amountMinor must be a positive integer in minor units',
        },
      },
    },
  },
};

const paymentSchema = {
  type: 'object',
  required: [
    'id',
    'reference',
    'amountMinor',
    'currency',
    'customerEmail',
    'status',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    id: {
      type: 'string',
      format: 'uuid',
    },
    reference: {
      type: 'string',
      example: 'pay_0123456789abcdef',
    },
    amountMinor: {
      type: 'integer',
      minimum: 1,
      example: 5000,
    },
    currency: {
      type: 'string',
      example: 'NGN',
    },
    customerEmail: {
      type: 'string',
      example: 'ada@example.com',
    },
    status: {
      type: 'string',
      enum: paymentStatusEnum,
    },
    createdAt: {
      type: 'string',
      format: 'date-time',
    },
    updatedAt: {
      type: 'string',
      format: 'date-time',
    },
  },
};

const paymentResponse = {
  description: 'The payment. The idempotency key is returned in the Idempotency-Key header, not in this body.',
  headers: {
    'Idempotency-Key': {
      description: 'The key stored for this create. A generated UUID means the request had no retry protection.',
      schema: {
        type: 'string',
      },
    },
  },
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['payment'],
        properties: {
          payment: {
            $ref: '#/components/schemas/Payment',
          },
        },
      },
    },
  },
};

const errorResponse = (description) => {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          $ref: '#/components/schemas/Error',
        },
      },
    },
  };
};

const idempotencyKeyParameter = {
  name: 'Idempotency-Key',
  in: 'header',
  required: false,
  description: '16 to 64 characters: letters, digits, hyphens, and underscores. The same caller, key, and normalized body returns the original payment. A different body with the same key returns 409. Omit the header and the server generates a UUID that cannot be retried if this response is lost.',
  schema: {
    type: 'string',
    minLength: 16,
    maxLength: 64,
    pattern: '^[A-Za-z0-9_-]{16,64}$',
    example: 'client-key-000001',
  },
};

const apiKeyIdParameter = {
  name: 'X-Api-Key-Id',
  in: 'header',
  required: false,
  description: 'Caller id that scopes the idempotency key. Two callers can use the same key without sharing a payment. Defaults to anonymous.',
  schema: {
    type: 'string',
    example: 'client-a',
  },
};

const paymentIdParameter = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Payment id (UUID) or reference (pay_ followed by 16 hex characters). An idempotency key is not a lookup id.',
  schema: {
    type: 'string',
  },
  example: 'pay_0123456789abcdef',
};

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'Payment processing',
    version: '1.0.0',
    description: 'Create a payment, look it up by id or reference, and set its status. Amounts are integers in minor units. 5000 NGN is ₦50.00.',
  },
  servers: [
    {
      url: '/',
    },
  ],
  tags: [
    {
      name: 'Payments',
    },
  ],
  paths: {
    '/payments': {
      post: {
        tags: ['Payments'],
        operationId: 'createPayment',
        summary: 'Create a payment',
        description: 'The first use of a caller and idempotency key returns 201 and starts background processing. The same key and the same amount, currency, and email return 200 and do not start processing again. Currency is uppercased. Email is trimmed and lowercased.',
        parameters: [
          idempotencyKeyParameter,
          apiKeyIdParameter,
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/CreatePayment',
              },
              example: {
                amountMinor: 5000,
                currency: 'NGN',
                customerEmail: 'ada@example.com',
              },
            },
          },
        },
        responses: {
          '201': {
            ...paymentResponse,
            description: 'The payment was created and background processing has started.',
          },
          '200': {
            ...paymentResponse,
            description: 'This caller already created a payment with this key and the same amount, currency, and email.',
          },
          '400': errorResponse('The body, amount, currency, email, or idempotency key is invalid.'),
          '409': errorResponse('The idempotency key was already used for a different request. The error code is IDEMPOTENCY_KEY_REUSED.'),
          '413': errorResponse('The JSON body is larger than 100 KB.'),
          '500': errorResponse('The payment file cannot be read, or another unexpected error occurred.'),
        },
      },
    },
    '/payments/{id}': {
      get: {
        tags: ['Payments'],
        operationId: 'getPayment',
        summary: 'Retrieve a payment',
        parameters: [paymentIdParameter],
        responses: {
          '200': {
            description: 'The payment.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['payment'],
                  properties: {
                    payment: {
                      $ref: '#/components/schemas/Payment',
                    },
                  },
                },
              },
            },
          },
          '404': errorResponse('The payment does not exist, or the id is not a UUID or reference.'),
        },
      },
      patch: {
        tags: ['Payments'],
        operationId: 'updatePaymentStatus',
        summary: 'Update a payment status',
        description: 'Succeeded, failed, and cancelled are terminal. A payment in one of those statuses cannot be updated and returns 409.',
        parameters: [paymentIdParameter],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/UpdatePaymentStatus',
              },
              example: {
                status: 'failed',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'The updated payment.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['payment'],
                  properties: {
                    payment: {
                      $ref: '#/components/schemas/Payment',
                    },
                  },
                },
              },
            },
          },
          '400': errorResponse('The status is missing or not one of pending, processing, succeeded, failed, or cancelled.'),
          '404': errorResponse('The payment does not exist, or the id is not a UUID or reference.'),
          '409': errorResponse('The payment is already succeeded, failed, or cancelled. The error code is terminal_status.'),
        },
      },
      put: {
        tags: ['Payments'],
        operationId: 'replacePaymentStatus',
        summary: 'Replace a payment status',
        description: 'Same behavior as PATCH /payments/{id}. Succeeded, failed, and cancelled payments cannot be updated.',
        parameters: [paymentIdParameter],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/UpdatePaymentStatus',
              },
              example: {
                status: 'succeeded',
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'The updated payment.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['payment'],
                  properties: {
                    payment: {
                      $ref: '#/components/schemas/Payment',
                    },
                  },
                },
              },
            },
          },
          '400': errorResponse('The status is missing or not one of pending, processing, succeeded, failed, or cancelled.'),
          '404': errorResponse('The payment does not exist, or the id is not a UUID or reference.'),
          '409': errorResponse('The payment is already succeeded, failed, or cancelled. The error code is terminal_status.'),
        },
      },
    },
  },
  components: {
    schemas: {
      CreatePayment: {
        type: 'object',
        required: ['amountMinor', 'currency', 'customerEmail'],
        properties: {
          amountMinor: {
            type: 'integer',
            minimum: 1,
            description: 'Amount in minor units.',
            example: 5000,
          },
          currency: {
            type: 'string',
            pattern: '^[A-Za-z]{3}$',
            description: '3-letter ISO currency code. Stored in uppercase.',
            example: 'NGN',
          },
          customerEmail: {
            type: 'string',
            description: 'Email address. Stored trimmed and lowercased.',
            example: 'ada@example.com',
          },
        },
      },
      UpdatePaymentStatus: {
        type: 'object',
        required: ['status'],
        properties: {
          status: {
            type: 'string',
            enum: paymentStatusEnum,
          },
        },
      },
      Payment: paymentSchema,
      Error: errorSchema,
    },
  },
};
