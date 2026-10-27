import { Router } from 'express';
import { createPaymentRoutes } from './payment.routes.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export const createRoutes = (service, apiKeyId) => {
  const routes = Router();

  routes.use('/payments', createPaymentRoutes(service, apiKeyId));

  return routes;
};
