const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  user: !process.env.DATABASE_URL ? (process.env.DB_USER || 'user') : undefined,
  host: !process.env.DATABASE_URL ? (process.env.DB_HOST || 'localhost') : undefined,
  database: !process.env.DATABASE_URL ? (process.env.DB_NAME || 'location_db') : undefined,
  password: !process.env.DATABASE_URL ? (process.env.DB_PASSWORD || 'password') : undefined,
  port: !process.env.DATABASE_URL ? (process.env.DB_PORT || 5432) : undefined,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

const initDb = async () => {
  const usersTable = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(255) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  const locationHistoryTable = `
    CREATE TABLE IF NOT EXISTS location_history (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(255) NOT NULL,
      latitude DECIMAL NOT NULL,
      longitude DECIMAL NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(usersTable);
    await pool.query(locationHistoryTable);
    console.log('Database initialized');
  } catch (err) {
    console.error('Error initializing database', err);
  }
};

module.exports = {
  query: (text, params) => pool.query(text, params),
  initDb,
};
