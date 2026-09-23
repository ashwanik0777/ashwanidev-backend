const app = require("./app");
const env = require("./config/env");
const { connectDb } = require("./config/db");
const { logInfo, logError } = require("./config/logger");
const { ensureAuthBootstrap } = require("./modules/auth/auth.service");
const { ensureAnnouncementsSchema } = require("./modules/announcements/store");
const { migrateSchoolAnnouncements } = require("./modules/announcements/migrate");
const storage = require("./services/storage");
const { query } = require("./config/db");

const UPLOADS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS uploads (
  id SERIAL PRIMARY KEY,
  original_name VARCHAR(500) NOT NULL,
  stored_name VARCHAR(500) NOT NULL,
  relative_path VARCHAR(1000) NOT NULL UNIQUE,
  mime_type VARCHAR(100) NOT NULL,
  file_size INTEGER NOT NULL,
  original_size INTEGER,
  width INTEGER,
  height INTEGER,
  file_category VARCHAR(20) DEFAULT 'image',
  storage_provider VARCHAR(20) DEFAULT 'local',
  folder VARCHAR(500),
  uploader_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_uploads_relative_path ON uploads(relative_path);
CREATE INDEX IF NOT EXISTS idx_uploads_folder ON uploads(folder);
`;

const startServer = async () => {
  try {
    await connectDb();
    await ensureAuthBootstrap();
    await ensureAnnouncementsSchema();
    // Carries any announcements still sitting in schools.content into their
    // real tables. No-ops once every school has been flagged as migrated.
    await migrateSchoolAnnouncements();

    // Initialize local file storage
    await storage.initialize();

    // Ensure uploads metadata table exists
    try { await query(UPLOADS_TABLE_SQL); } catch (e) { console.error("uploads table migration:", e.message); }

    app.listen(env.port, env.host, () => {
      logInfo("GBU backend server running", {
        env: env.nodeEnv,
        host: env.host,
        port: env.port,
      });
    });
  } catch (error) {
    logError("Failed to start server", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  }
};

startServer();
