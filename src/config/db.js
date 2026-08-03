
const { Pool, types } = require('pg');
const env = require('./env');
const { logInfo, logError } = require('./logger');

/*
 * Return DATE columns as the plain 'YYYY-MM-DD' string Postgres sends.
 *
 * By default node-postgres turns a DATE into a JS Date at LOCAL midnight. On a
 * server in a positive-offset zone (this one runs in IST, +05:30) the usual
 * `toISOString().slice(0, 10)` formatting then reports the PREVIOUS day — a
 * closing date saved as 2030-07-20 came back as 2030-07-19. Keeping DATE as a
 * string removes the conversion, and with it the whole class of off-by-one-day
 * bugs across tenders, recruitments and announcements.
 *
 * 1082 = DATE. Timestamps (1114/1184) are deliberately left alone; they carry a
 * real time component that the existing code formats intentionally.
 */
const PG_DATE_OID = 1082;
types.setTypeParser(PG_DATE_OID, (value) => value);

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
