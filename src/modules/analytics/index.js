const express = require("express");
const { query } = require("../../config/db");
const { authenticate, authorize } = require("../../middleware/auth");
const ROLES = require("../../constants/roles");
const { successResponse, errorResponse } = require("../../utils/response");

const router = express.Router();

/* ─── Schema Bootstrap ─── */
let schemaReady = false;
const ensureAnalyticsSchema = async () => {
  if (schemaReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS page_visits (
      id SERIAL PRIMARY KEY,
      visitor_hash VARCHAR(64) NOT NULL,
      page_path VARCHAR(500) NOT NULL DEFAULT '/',
      device_type VARCHAR(20) DEFAULT 'desktop',
      browser VARCHAR(50) DEFAULT 'Other',
      os VARCHAR(50) DEFAULT 'Other',
      referrer VARCHAR(500) DEFAULT '',
      visited_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_page_visits_visited_at ON page_visits(visited_at);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_page_visits_page_path ON page_visits(page_path);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_page_visits_hash ON page_visits(visitor_hash);`);
  schemaReady = true;
};

// Run on load
ensureAnalyticsSchema().catch((e) => console.error("[Analytics] Schema error:", e.message));

/* ─── User-Agent Parsing (zero dependencies) ─── */
const parseDevice = (ua) => {
  if (!ua) return "desktop";
  const lower = ua.toLowerCase();
  if (/ipad|tablet|kindle|playbook|silk/.test(lower)) return "tablet";
  if (/mobile|iphone|ipod|android.*mobile|opera mini|iemobile|wpdesktop|windows phone|blackberry/.test(lower)) return "mobile";
  return "desktop";
};

const parseBrowser = (ua) => {
  if (!ua) return "Other";
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\//i.test(ua) || /opera/i.test(ua)) return "Opera";
  if (/chrome|crios/i.test(ua) && !/edg/i.test(ua)) return "Chrome";
  if (/firefox|fxios/i.test(ua)) return "Firefox";
  if (/safari/i.test(ua) && !/chrome|crios/i.test(ua)) return "Safari";
  if (/trident|msie/i.test(ua)) return "IE";
  return "Other";
};

const parseOS = (ua) => {
  if (!ua) return "Other";
  if (/windows/i.test(ua)) return "Windows";
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/macintosh|mac os/i.test(ua)) return "macOS";
  if (/linux/i.test(ua)) return "Linux";
  if (/cros/i.test(ua)) return "ChromeOS";
  return "Other";
};

const simpleHash = (str) => {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

/* ─── Date range helper ─── */
/**
 * Parse `from`, `to`, `days` query params into a WHERE clause + params array.
 * Priority: from/to > days > default 30
 * Returns { clause, params, startIndex } where clause is like "visited_at >= $1 AND visited_at < $2"
 */
function parseDateRange(reqQuery, startParamIndex = 1) {
  const { from, to, days } = reqQuery;
  let idx = startParamIndex;

  if (from && to) {
    // Custom date range: from (inclusive) to to+1day (exclusive, so the "to" date is fully included)
    return {
      clause: `visited_at >= $${idx}::date AND visited_at < ($${idx + 1}::date + INTERVAL '1 day')`,
      params: [from, to],
      nextIndex: idx + 2,
    };
  }
  if (from) {
    // From a date until now
    return {
      clause: `visited_at >= $${idx}::date`,
      params: [from],
      nextIndex: idx + 1,
    };
  }
  if (to) {
    // Everything up to a date
    return {
      clause: `visited_at < ($${idx}::date + INTERVAL '1 day')`,
      params: [to],
      nextIndex: idx + 1,
    };
  }
  // Fallback: days-based (default 30, max 365, 0 = all time)
  const d = Number(days);
  if (d === 0) {
    // All time — no date filter
    return { clause: "TRUE", params: [], nextIndex: idx };
  }
  const numDays = Math.min(d || 30, 730);
  return {
    clause: `visited_at >= CURRENT_DATE - $${idx} * INTERVAL '1 day'`,
    params: [numDays],
    nextIndex: idx + 1,
  };
}

/* ─── POST /analytics/track (Public) ─── */
router.post("/analytics/track", async (req, res) => {
  try {
    await ensureAnalyticsSchema();

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.headers["x-real-ip"] ||
      req.socket?.remoteAddress ||
      "unknown";
    const userAgent = req.headers["user-agent"] || "unknown";
    const visitorHash = simpleHash(`${ip}::${userAgent}`);

    const pagePath = String(req.body?.path || req.body?.page || "/").substring(0, 500);
    const referrer = String(req.body?.referrer || "").substring(0, 500);

    const deviceType = parseDevice(userAgent);
    const browser = parseBrowser(userAgent);
    const os = parseOS(userAgent);

    await query(
      `INSERT INTO page_visits (visitor_hash, page_path, device_type, browser, os, referrer)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [visitorHash, pagePath, deviceType, browser, os, referrer],
    );

    return successResponse(res, "Visit tracked", {}, 200);
  } catch (error) {
    console.error("[Analytics] Track error:", error.message);
    return errorResponse(res, "Tracking failed", [{ field: "track", message: error.message }], 500);
  }
});

/* ─── GET /analytics/overview (Admin only) ─── */
router.get(
  "/analytics/overview",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      await ensureAnalyticsSchema();

      // Total unique visitors from legacy table
      const totalResult = await query(`SELECT COUNT(*) AS total FROM unique_visitors`);

      // Today's unique visitors from page_visits
      const todayResult = await query(`
        SELECT COUNT(DISTINCT visitor_hash) AS count
        FROM page_visits
        WHERE visited_at >= CURRENT_DATE
      `);

      // This week
      const weekResult = await query(`
        SELECT COUNT(DISTINCT visitor_hash) AS count
        FROM page_visits
        WHERE visited_at >= date_trunc('week', CURRENT_DATE)
      `);

      // This month
      const monthResult = await query(`
        SELECT COUNT(DISTINCT visitor_hash) AS count
        FROM page_visits
        WHERE visited_at >= date_trunc('month', CURRENT_DATE)
      `);

      // Total page views today
      const pageViewsToday = await query(`
        SELECT COUNT(*) AS count
        FROM page_visits
        WHERE visited_at >= CURRENT_DATE
      `);

      // Total page views overall
      const totalPageViews = await query(`SELECT COUNT(*) AS count FROM page_visits`);

      return successResponse(res, "Analytics overview", {
        totalUniqueVisitors: Number(totalResult.rows[0]?.total || 0),
        todayUniqueVisitors: Number(todayResult.rows[0]?.count || 0),
        weekUniqueVisitors: Number(weekResult.rows[0]?.count || 0),
        monthUniqueVisitors: Number(monthResult.rows[0]?.count || 0),
        todayPageViews: Number(pageViewsToday.rows[0]?.count || 0),
        totalPageViews: Number(totalPageViews.rows[0]?.count || 0),
      });
    } catch (error) {
      return errorResponse(res, "Failed to fetch overview", [{ field: "overview", message: error.message }], 500);
    }
  },
);

/* ─── GET /analytics/timeline?from=&to=&days=30 (Admin only) ─── */
router.get(
  "/analytics/timeline",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      await ensureAnalyticsSchema();
      const { clause, params } = parseDateRange(req.query);

      const result = await query(
        `SELECT
           visited_at::date AS date,
           COUNT(*) AS page_views,
           COUNT(DISTINCT visitor_hash) AS unique_visitors
         FROM page_visits
         WHERE ${clause}
         GROUP BY visited_at::date
         ORDER BY date ASC`,
        params,
      );

      return successResponse(res, "Visitor timeline", { data: result.rows });
    } catch (error) {
      return errorResponse(res, "Failed to fetch timeline", [{ field: "timeline", message: error.message }], 500);
    }
  },
);

/* ─── GET /analytics/devices (Admin only) ─── */
router.get(
  "/analytics/devices",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      await ensureAnalyticsSchema();
      const { clause, params } = parseDateRange(req.query);

      const result = await query(
        `SELECT device_type AS name, COUNT(*) AS value
         FROM page_visits
         WHERE ${clause}
         GROUP BY device_type
         ORDER BY value DESC`,
        params,
      );

      return successResponse(res, "Device breakdown", { data: result.rows });
    } catch (error) {
      return errorResponse(res, "Failed to fetch devices", [{ field: "devices", message: error.message }], 500);
    }
  },
);

/* ─── GET /analytics/browsers (Admin only) ─── */
router.get(
  "/analytics/browsers",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      await ensureAnalyticsSchema();
      const { clause, params } = parseDateRange(req.query);

      const result = await query(
        `SELECT browser AS name, COUNT(*) AS value
         FROM page_visits
         WHERE ${clause}
         GROUP BY browser
         ORDER BY value DESC`,
        params,
      );

      return successResponse(res, "Browser breakdown", { data: result.rows });
    } catch (error) {
      return errorResponse(res, "Failed to fetch browsers", [{ field: "browsers", message: error.message }], 500);
    }
  },
);

/* ─── GET /analytics/os (Admin only) ─── */
router.get(
  "/analytics/os",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      await ensureAnalyticsSchema();
      const { clause, params } = parseDateRange(req.query);

      const result = await query(
        `SELECT os AS name, COUNT(*) AS value
         FROM page_visits
         WHERE ${clause}
         GROUP BY os
         ORDER BY value DESC`,
        params,
      );

      return successResponse(res, "OS breakdown", { data: result.rows });
    } catch (error) {
      return errorResponse(res, "Failed to fetch OS data", [{ field: "os", message: error.message }], 500);
    }
  },
);

/* ─── GET /analytics/pages?limit=20&offset=0&search= (Admin only) ─── */
router.get(
  "/analytics/pages",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      await ensureAnalyticsSchema();
      const limit = Math.min(Number(req.query.limit) || 20, 200);
      const offset = Math.max(Number(req.query.offset) || 0, 0);
      const search = (req.query.search || "").trim();
      const { clause, params, nextIndex } = parseDateRange(req.query);

      // Build search condition
      let searchClause = "";
      const allParams = [...params];
      let pIdx = nextIndex;
      if (search) {
        searchClause = ` AND page_path ILIKE $${pIdx}`;
        allParams.push(`%${search}%`);
        pIdx++;
      }

      // Get total count
      const countResult = await query(
        `SELECT COUNT(DISTINCT page_path) AS total
         FROM page_visits
         WHERE ${clause}${searchClause}`,
        allParams,
      );
      const total = Number(countResult.rows[0]?.total || 0);

      // Get paginated results
      const dataParams = [...allParams, limit, offset];
      const result = await query(
        `SELECT
           page_path AS path,
           COUNT(*) AS views,
           COUNT(DISTINCT visitor_hash) AS unique_visitors
         FROM page_visits
         WHERE ${clause}${searchClause}
         GROUP BY page_path
         ORDER BY views DESC
         LIMIT $${pIdx} OFFSET $${pIdx + 1}`,
        dataParams,
      );

      return successResponse(res, "Top pages", { data: result.rows, total, limit, offset });
    } catch (error) {
      return errorResponse(res, "Failed to fetch pages", [{ field: "pages", message: error.message }], 500);
    }
  },
);

module.exports = router;
