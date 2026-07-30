const app = require("./app");
const env = require("./config/env");
const { connectDb } = require("./config/db");
const { logInfo, logError } = require("./config/logger");
const { ensureAuthBootstrap } = require("./modules/auth/auth.service");
const { ensureAnnouncementsSchema } = require("./modules/announcements/store");
const { migrateSchoolAnnouncements } = require("./modules/announcements/migrate");
// // const bookingRoutes = require("./modules/booking");
// const bookingRoutes = require("./modules/booking");
// app.use("/api/bookings", bookingRoutes);

const startServer = async () => {
  try {
    await connectDb();
    await ensureAuthBootstrap();
    await ensureAnnouncementsSchema();
    // Carries any announcements still sitting in schools.content into their
    // real tables. No-ops once every school has been flagged as migrated.
    await migrateSchoolAnnouncements();

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
