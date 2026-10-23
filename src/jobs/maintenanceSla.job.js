const env = require("../config/env");
const { logInfo } = require("../config/logger");
const { runSlaSweepSafely } = require("../modules/grievance/service");

let timer = null;

/*
 * Periodically flags missed vendor site visits (2 working days) and moves work
 * past its promised completion date to "delayed", notifying the JE each time.
 */
const startMaintenanceSlaJob = () => {
  if (timer) return;

  const intervalMs = Math.max(env.grievanceSlaIntervalMs, 60 * 1000);
  setTimeout(runSlaSweepSafely, 15 * 1000).unref();
  timer = setInterval(runSlaSweepSafely, intervalMs);
  timer.unref();

  logInfo("Maintenance grievance SLA job started", { intervalMs });
};

module.exports = { startMaintenanceSlaJob };
