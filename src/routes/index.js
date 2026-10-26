import { Router } from 'express';
import { createPaymentRoutes } from './payment.routes.js';

export const createRoutes = (service) => {
  const routes = Router();

  routes.use('/payments', createPaymentRoutes(service));

  return routes;
};
