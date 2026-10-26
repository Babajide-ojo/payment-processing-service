import { Router } from 'express';
import { createPaymentHandlers } from '../controllers/payments/payment.controller.js';
import { createApiKeyGate } from '../middleware/api-key-gate.js';

export const createPaymentRoutes = (service, apiKeyId) => {
  const {
    createPaymentHandler,
    getPaymentHandler,
    updatePaymentHandler,
  } = createPaymentHandlers(service);
  const paymentRoutes = Router();

  paymentRoutes.use(createApiKeyGate(apiKeyId));
  paymentRoutes.post('/', createPaymentHandler);
  paymentRoutes.get('/:id', getPaymentHandler);
  paymentRoutes.patch('/:id', updatePaymentHandler);
  paymentRoutes.put('/:id', updatePaymentHandler);

  return paymentRoutes;
};
