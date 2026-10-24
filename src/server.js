import { createApp } from './app.js';
import { checkConnection } from './db/connection.js';

const port = Number(process.env.PORT) || 3000;

const start = async () => {
  await checkConnection();
  console.log('Database connected');

  const app = createApp();
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
};

start().catch((error) => {
  console.error('Failed to start server', error.message);
  process.exit(1);
});
