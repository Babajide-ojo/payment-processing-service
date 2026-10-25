import { Router } from 'express';
import { paymentRoutes } from './payment.routes.js';

export const routes = Router();

routes.use('/payments', paymentRoutes);
