
const { Pool } = require('pg');
const env = require('./env');
const { logInfo, logError } = require('./logger');

let pool;

const buildPool = () => {
  if (!env.databaseUrl) {
    throw new Error('DATABASE_URL is missing. Set it in .env file.');
  }

  const newPool = new Pool({
    connectionString: env.databaseUrl,
    ssl: env.dbSslEnabled ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  newPool.on('connect', (client) => {
    setImmediate(() => {
      client.query('SET search_path TO public, "$user";').catch((err) => {
        console.error('Error setting search_path on client connection:', err);
      });
    });
  });

  return newPool;
};

const getDbPool = () => {
  if (!pool) {
    pool = buildPool();
  }

  return pool;
};

const connectDb = async () => {
  pool = getDbPool();

  try {
    await pool.query('SELECT 1 AS db_ok');
    logInfo('PostgreSQL connection established');
  } catch (error) {
    logError('PostgreSQL connection failed', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
};

const query = (text, params = []) => {
  return getDbPool().query(text, params);
};

const closeDb = async () => {
  if (pool) {
    await pool.end();
    pool = undefined;
  }

};

module.exports = {
  // Legacy compatibility for modules that still call db.query(...).
  db: {
    query,
  },
  connectDb,
  getDbPool,
  query,
  closeDb,
};
