import { Router } from 'express';
import {
  createPaymentHandler,
  getPaymentHandler,
  updatePaymentHandler,
} from '../controllers/payments/payment.controller.js';

export const paymentRoutes = Router();

paymentRoutes.post('/', createPaymentHandler);
paymentRoutes.get('/:id', getPaymentHandler);
paymentRoutes.patch('/:id', updatePaymentHandler);
paymentRoutes.put('/:id', updatePaymentHandler);
