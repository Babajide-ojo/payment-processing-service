import '../config/load-env.js';
import pg from 'pg';

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

export const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: true,
  },
});

pool.on('error', (error) => {
  console.error('Unexpected database error', error.message);
});

export const checkConnection = async () => {
  const client = await pool.connect();

  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
};
