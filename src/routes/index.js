import { Router } from 'express';
import { createPaymentRoutes } from './payment.routes.js';

export const createRoutes = (service, apiKeyId) => {
  const routes = Router();

  routes.use('/payments', createPaymentRoutes(service, apiKeyId));

  return routes;
};
