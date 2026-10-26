import swaggerUi from 'swagger-ui-express';
import { openApiDocument } from './openapi.js';

const redirectDocsIndex = (request, response, next) => {
  if (request.originalUrl === '/docs') {
    response.redirect(308, '/docs/');
    return;
  }

  next();
};

export const mountSwagger = (app) => {
  app.get('/openapi.json', (_request, response) => {
    response.json(openApiDocument);
  });

  app.use(
    '/docs',
    redirectDocsIndex,
    ...swaggerUi.serve,
    swaggerUi.setup(null, {
      customSiteTitle: 'Payment processing API',
      swaggerUrl: '/openapi.json',
      swaggerOptions: {
        docExpansion: 'list',
        displayRequestDuration: true,
        tryItOutEnabled: true,
      },
    }),
  );
};
