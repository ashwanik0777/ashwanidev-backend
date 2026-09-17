const express = require("express");
const { query } = require("../../config/db");
const { successResponse, errorResponse } = require("../../utils/response");
const { logInfo, logError } = require("../../config/logger");

const router = express.Router();

// ── Ensure the visitors table exists ──
const ensureVisitorsTable = async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS unique_visitors (
        id SERIAL PRIMARY KEY,
        visitor_hash VARCHAR(64) NOT NULL UNIQUE,
        ip_address VARCHAR(45),
        user_agent TEXT,
        first_visit TIMESTAMPTZ DEFAULT NOW(),
        last_visit TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Index for fast lookups
    await query(`
      CREATE INDEX IF NOT EXISTS idx_visitors_hash ON unique_visitors(visitor_hash);
    `);

    logInfo("unique_visitors table ensured");
  } catch (err) {
    logError("Failed to create unique_visitors table", { error: err.message });
  }
};

// Call on module load
ensureVisitorsTable();

/**
 * Generate a simple hash from string (no crypto dependency needed).
 * Uses a djb2-style hash and returns a hex string.
 */
const simpleHash = (str) => {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

/**
 * POST /api/v1/visitors/track
 *
 * Tracks a unique visitor based on IP + User-Agent fingerprint.
 * Returns the total unique visitor count.
 */
router.post("/visitors/track", async (req, res) => {
  try {
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.headers["x-real-ip"] ||
      req.socket?.remoteAddress ||
      "unknown";

    const userAgent = req.headers["user-agent"] || "unknown";

    // Create a fingerprint from IP + User-Agent
    const fingerprint = `${ip}::${userAgent}`;
    const visitorHash = simpleHash(fingerprint);

    // Upsert: insert if new, update last_visit if existing
    await query(
      `INSERT INTO unique_visitors (visitor_hash, ip_address, user_agent, first_visit, last_visit)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (visitor_hash) DO UPDATE SET last_visit = NOW()`,
      [visitorHash, ip.substring(0, 45), userAgent.substring(0, 500)]
    );

    // Get total count
    const result = await query("SELECT COUNT(*) AS total FROM unique_visitors");
    const total = parseInt(result.rows[0]?.total || "0", 10);

    return successResponse(res, "Visitor tracked", { count: total });
  } catch (error) {
    logError("Visitor tracking failed", { error: error.message });
    // Still try to return count even if tracking fails
    try {
      const result = await query("SELECT COUNT(*) AS total FROM unique_visitors");
      const total = parseInt(result.rows[0]?.total || "0", 10);
      return successResponse(res, "Count retrieved", { count: total });
    } catch {
      return errorResponse(
        res,
        "Visitor tracking failed",
        [{ field: "visitor", message: error.message }],
        500
      );
    }
  }
});

/**
 * GET /api/v1/visitors/count
 *
 * Returns the total unique visitor count (no tracking).
 */
router.get("/visitors/count", async (req, res) => {
  try {
    const result = await query("SELECT COUNT(*) AS total FROM unique_visitors");
    const total = parseInt(result.rows[0]?.total || "0", 10);
    return successResponse(res, "Visitor count retrieved", { count: total });
  } catch (error) {
    logError("Visitor count failed", { error: error.message });
    return errorResponse(
      res,
      "Failed to retrieve visitor count",
      [{ field: "visitor", message: error.message }],
      500
    );
  }
});

module.exports = router;
