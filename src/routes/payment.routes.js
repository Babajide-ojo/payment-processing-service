import { Router } from 'express';
import { createPaymentHandlers } from '../controllers/payments/payment.controller.js';

export const createPaymentRoutes = (service) => {
  const {
    createPaymentHandler,
    getPaymentHandler,
    updatePaymentHandler,
  } = createPaymentHandlers(service);
  const paymentRoutes = Router();

  paymentRoutes.post('/', createPaymentHandler);
  paymentRoutes.get('/:id', getPaymentHandler);
  paymentRoutes.patch('/:id', updatePaymentHandler);
  paymentRoutes.put('/:id', updatePaymentHandler);

  return paymentRoutes;
};
