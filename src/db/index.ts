import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'ats_user',
  password: process.env.DB_PASSWORD || 'securepassword',
  database: process.env.DB_NAME || 'ats_db',
});

/**
 * Initializes the database schema.
 * Attempts to connect and runs the schema.sql script.
 * Retries if the database is not yet ready to accept connections.
 */
export const initDb = async (retries = 5, delay = 2000): Promise<void> => {
  for (let i = 0; i < retries; i++) {
    try {
      const client = await pool.connect();
      client.release();
      
      const schemaPath = path.join(__dirname, 'schema.sql');
      const sql = fs.readFileSync(schemaPath, 'utf8');
      await pool.query(sql);
      console.log('Database initialized successfully.');
      return;
    } catch (err) {
      console.error(`Database connection attempt ${i + 1} failed. Retrying in ${delay}ms...`, err);
      if (i === retries - 1) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
};

export default pool;
