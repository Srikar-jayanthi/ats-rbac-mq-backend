import app from './app';
import { initDb } from './db';
import * as dotenv from 'dotenv';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);

/**
 * Main application entrypoint.
 * Boots the database (running schema updates with connection retry validation)
 * and starts the HTTP REST API server.
 */
const startServer = async (): Promise<void> => {
  try {
    // Validate database availability and initialize tables
    await initDb();
    
    app.listen(PORT, () => {
      console.log(`ATS API Server is listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('Fatal: Failed to bootstrap ATS API Server:', err);
    process.exit(1);
  }
};

startServer();
