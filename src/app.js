import express from 'express';
import { mountSwagger } from './docs/swagger.js';
import { errorHandler } from './middleware/error-handler.js';
import { requestLogger } from './middleware/request-logger.js';
import { createRoutes } from './routes/index.js';
import { createPayment, getPayment, updatePaymentStatus } from './services/payments/payment.service.js';

const defaultService = {
  createPayment,
  getPayment,
  updatePaymentStatus,
};

export const createApp = (service = defaultService, options = {}) => {
  const { apiKeyId = process.env.API_KEY_ID } = options;
  const app = express();

  app.disable('x-powered-by');
  app.use(requestLogger);
  app.use(express.json({ limit: '100kb' }));
  mountSwagger(app);
  app.use(createRoutes(service, apiKeyId));
  app.use(errorHandler);

  return app;
};
