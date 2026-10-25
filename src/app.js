import express from 'express';
import { errorHandler } from './middleware/error-handler.js';
import { routes } from './routes/index.js';

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json());
  app.use(routes);
  app.use(errorHandler);

  return app;
};
