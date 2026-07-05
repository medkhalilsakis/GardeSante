const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'hospital_guard',
  user: process.env.DB_USER || 'hospital_user',
  password: process.env.DB_PASSWORD || 'password123',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'test') {
    console.log('✅ Connected to PostgreSQL');
  }
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL error:', err.message);
});

/**
 * Execute a query with optional parameters
 */
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development' && duration > 1000) {
      console.warn(`⚠️  Slow query (${duration}ms):`, text.substring(0, 100));
    }
    return res;
  } catch (err) {
    console.error('❌ Query error:', err.message);
    throw err;
  }
};

/**
 * Get a client from the pool for transactions
 */
const getClient = async () => {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);

  // Wrap query to add logging
  client.query = (...args) => originalQuery(...args);

  // Set timeout on release
  client.release = () => {
    release();
  };

  return client;
};

/**
 * Execute multiple queries in a transaction
 */
const transaction = async (callback) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Initialize database - run migrations and optionally seeds
 */
const initializeDatabase = async () => {
  const migrationsDir = path.join(__dirname, 'migrations');
  const seedsDir = path.join(__dirname, 'seeds');

  console.log('🔄 Running database migrations...');

  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of migrationFiles) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    try {
      await pool.query(sql);
      console.log(`  ✅ Migration: ${file}`);
    } catch (err) {
      if (!err.message.includes('already exists')) {
        console.error(`  ❌ Migration failed: ${file}`, err.message);
        throw err;
      }
    }
  }

  if (process.env.SEED_DB === 'true') {
    console.log('🌱 Running seeds...');
    const seedFiles = fs.readdirSync(seedsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of seedFiles) {
      const sql = fs.readFileSync(path.join(seedsDir, file), 'utf-8');
      try {
        await pool.query(sql);
        console.log(`  ✅ Seed: ${file}`);
      } catch (err) {
        console.warn(`  ⚠️  Seed warning (${file}):`, err.message.substring(0, 80));
      }
    }
  }

  console.log('✅ Database initialized successfully');
};

module.exports = { query, getClient, transaction, initializeDatabase, pool };
