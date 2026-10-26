import { createApp } from './app.js';

const apiKeyId = process.env.API_KEY_ID;

if (typeof apiKeyId !== 'string' || apiKeyId.length === 0) {
  console.error('API_KEY_ID is required');
  process.exit(1);
}

const port = Number(process.env.PORT) || 3000;
const app = createApp(undefined, { apiKeyId });

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`Swagger UI at http://localhost:${port}/docs`);
});
