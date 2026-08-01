const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'hospital_guard',
  user:     process.env.DB_USER     || 'hospital_user',
  password: process.env.DB_PASSWORD || 'password123',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('connect', () => {
  if (process.env.NODE_ENV !== 'test') {
    console.log('✅ Connected to PostgreSQL');
  }
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL pool error:', err.message);
});

/**
 * Execute a parameterised query
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
 * Get a pooled client (for transactions)
 */
const getClient = async () => {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);
  client.query = (...args) => originalQuery(...args);
  client.release = () => { release(); };
  return client;
};

/**
 * Run callback inside a BEGIN/COMMIT transaction
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
 * Run a single SQL file against the pool, splitting on statement boundaries.
 * Returns { ok: true } or { ok: false, error }.
 */
const runSqlFile = async (filePath) => {
  const sql = fs.readFileSync(filePath, 'utf-8');
  try {
    await pool.query(sql);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
};

/**
 * Initialize database
 *  1. Run all migration files (idempotent schema — CREATE ... IF NOT EXISTS)
 *  2. Always run seed files (idempotent data   — INSERT ... ON CONFLICT DO NOTHING)
 */
const initializeDatabase = async () => {
  const migrationsDir = path.join(__dirname, '..', 'db', 'migrations');
  const seedsDir      = path.join(__dirname, '..', 'db', 'seeds');

  // ── Migrations ──────────────────────────────────────────────
  console.log('🔄 Running database migrations...');

  let migrationFiles = [];
  try {
    migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
  } catch (_) {
    console.warn('  ⚠️  Migrations directory not found:', migrationsDir);
  }

  for (const file of migrationFiles) {
    const filePath = path.join(migrationsDir, file);
    const { ok, error } = await runSqlFile(filePath);
    if (ok) {
      console.log(`  ✅ Migration: ${file}`);
    } else if (
      error.message.includes('already exists') ||
      error.message.includes('existe déjà')   ||
      error.code === '42P07' ||  // duplicate_table
      error.code === '42710'     // duplicate_object
    ) {
      console.log(`  ♻️  Migration (schema already present): ${file}`);
    } else {
      console.error(`  ❌ Migration failed: ${file} — ${error.message}`);
      throw error;
    }
  }

  // ── Seeds (idempotent — ON CONFLICT DO NOTHING) ─────────────
  console.log('🌱 Running seeds (idempotent)...');

  let seedFiles = [];
  try {
    seedFiles = fs.readdirSync(seedsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
  } catch (_) {
    console.warn('  ⚠️  Seeds directory not found:', seedsDir);
  }

  for (const file of seedFiles) {
    const filePath = path.join(seedsDir, file);
    const { ok, error } = await runSqlFile(filePath);
    if (ok) {
      console.log(`  ✅ Seed: ${file}`);
    } else {
      // Seed errors are non-fatal warnings (data may already exist)
      console.warn(`  ⚠️  Seed warning (${file}): ${error.message.substring(0, 120)}`);
    }
  }

  console.log('✅ Database initialized successfully');
};

module.exports = { query, getClient, transaction, initializeDatabase, pool };
