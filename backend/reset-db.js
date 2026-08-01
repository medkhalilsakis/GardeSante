/**
 * reset-db.js — Réinitialise la base de données GardeSante
 * Supprime toutes les tables et relance les migrations + seed
 */
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host    : process.env.DB_HOST     || 'localhost',
  port    : parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME     || 'hospital_guard',
  user    : process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '1234',
});

async function reset() {
  const client = await pool.connect();
  try {
    console.log('🔄 Réinitialisation de la base de données…');
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('GRANT ALL ON SCHEMA public TO public');
    console.log('✅ Schéma réinitialisé');

    // Relancer les migrations + seed via le module db
    const { initializeDatabase } = require('./src/config/database');
    await initializeDatabase();
    console.log('✅ Migrations et seed appliqués');
    console.log('');
    console.log('📧 Connexion Super Admin :');
    console.log('   Email    : admin@gardesante.dz');
    console.log('   Password : Admin@123');
  } catch(err) {
    console.error('❌ Erreur:', err.message);
  } finally {
    client.release();
    await pool.end();
    process.exit(0);
  }
}

reset();
