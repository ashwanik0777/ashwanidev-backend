const express = require("express");
const { query } = require("../../config/db");
const { successResponse, errorResponse } = require("../../utils/response");
const { authenticate, authorize } = require("../../middleware/auth");
const ROLES = require("../../constants/roles");

const router = express.Router();

/*
 * University-wide headline statistics.
 *
 * The same figures (campus acreage, student count, faculty count, programmes,
 * placement rate, number of schools …) were hardcoded independently in the
 * homepage Glance section, the About page, the Admissions page and the Campus
 * Life page. They had drifted apart — students read 8200+ in one place and
 * 6500+ in another, placement 90% vs 95%, programmes 160+ vs 80+.
 *
 * This module is the single source of truth: every one of those places now
 * reads from here, and an administrator updates a figure once.
 *
 * Values are stored as free text ("511", "8200+", "90%", "2.5L+") because the
 * site displays them verbatim — a plain integer column could not represent the
 * "+" and "%" suffixes the design relies on.
 */

const STAT_SEEDS = [
  { key: "acres_campus", label: "Acres Campus", value: "511", category: "campus", sortOrder: 1 },
  { key: "academic_schools", label: "Academic Schools", value: "8", category: "academics", sortOrder: 2 },
  { key: "programs", label: "Programs", value: "160+", category: "academics", sortOrder: 3 },
  { key: "students", label: "Students", value: "8200+", category: "people", sortOrder: 4 },
  { key: "faculty_members", label: "Faculty Members", value: "350+", category: "people", sortOrder: 5 },
  { key: "placement_rate", label: "Placement Rate", value: "90%", category: "placement", sortOrder: 6 },
  { key: "available_seats", label: "Available Seats", value: "2500+", category: "academics", sortOrder: 7 },
  { key: "hostels", label: "Single-Seated Hostels", value: "18", category: "campus", sortOrder: 8 },
  { key: "library_books", label: "Library Book Collection", value: "2.5L+", category: "campus", sortOrder: 9 },
  { key: "stadium_capacity", label: "Stadium Seating Capacity", value: "3,000+", category: "campus", sortOrder: 10 },
  { key: "countries_represented", label: "Countries Represented", value: "15+", category: "people", sortOrder: 11 },
  { key: "research_publications", label: "Research Publications", value: "1200+", category: "research", sortOrder: 12 },
];

let bootstrapped = false;

const ensureStatsSchema = async () => {
  if (bootstrapped) return;

  await query(`
    CREATE TABLE IF NOT EXISTS university_stats (
      id SERIAL PRIMARY KEY,
      stat_key VARCHAR(64) UNIQUE NOT NULL,
      label VARCHAR(160) NOT NULL,
      value VARCHAR(64) NOT NULL DEFAULT '',
      description TEXT,
      category VARCHAR(40) NOT NULL DEFAULT 'general',
      sort_order INT NOT NULL DEFAULT 100,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_by_name VARCHAR(160) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Seed the known figures once. ON CONFLICT DO NOTHING means an administrator's
  // later edits are never overwritten by a redeploy.
  for (const stat of STAT_SEEDS) {
    await query(
      `INSERT INTO university_stats (stat_key, label, value, category, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (stat_key) DO NOTHING`,
      [stat.key, stat.label, stat.value, stat.category, stat.sortOrder],
    );
  }

  bootstrapped = true;
};

const mapStatRow = (row) => ({
  id: row.id,
  key: row.stat_key,
  label: row.label,
  value: row.value ?? "",
  description: row.description || "",
  category: row.category || "general",
  sortOrder: Number(row.sort_order || 0),
  isActive: row.is_active !== false,
  updatedByName: row.updated_by_name || "",
  updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : "",
});

/**
 * Public read. Returns both a list (for admin tables) and a key -> value map,
 * which is what the website components consume.
 */
router.get("/university-stats", async (req, res) => {
  try {
    await ensureStatsSchema();
    const result = await query(
      `SELECT * FROM university_stats WHERE is_active = TRUE ORDER BY sort_order ASC, id ASC`,
    );

    const items = result.rows.map(mapStatRow);
    const values = Object.fromEntries(items.map((item) => [item.key, item.value]));

    return successResponse(res, "University stats fetched successfully", { items, values });
  } catch (error) {
    return errorResponse(
      res,
      "Failed to fetch university stats",
      [{ field: "universityStats", message: error.message }],
      500,
    );
  }
});

/** Admin list, including any stat that has been deactivated. */
router.get(
  "/admin/university-stats",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      await ensureStatsSchema();
      const result = await query(`SELECT * FROM university_stats ORDER BY sort_order ASC, id ASC`);
      return successResponse(res, "University stats fetched", result.rows.map(mapStatRow));
    } catch (error) {
      return errorResponse(
        res,
        "Failed to fetch university stats",
        [{ field: "universityStats", message: error.message }],
        500,
      );
    }
  },
);

/**
 * Bulk upsert — the admin screen edits every figure on one form and saves once.
 * Unknown keys are created, so a new statistic can be introduced without a
 * migration.
 */
router.put(
  "/admin/university-stats",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    const incoming = Array.isArray(req.body?.stats) ? req.body.stats : null;

    if (!incoming) {
      return errorResponse(
        res,
        "Validation failed",
        [{ field: "stats", message: "stats must be an array" }],
        400,
      );
    }

    const editorName = String(req.user?.name || req.user?.email || "").slice(0, 160);

    try {
      await ensureStatsSchema();

      for (const stat of incoming) {
        const key = String(stat?.key || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
        if (!key) continue;

        await query(
          `INSERT INTO university_stats
             (stat_key, label, value, description, category, sort_order, is_active, updated_by_name, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
           ON CONFLICT (stat_key) DO UPDATE SET
             label = EXCLUDED.label,
             value = EXCLUDED.value,
             description = EXCLUDED.description,
             category = EXCLUDED.category,
             sort_order = EXCLUDED.sort_order,
             is_active = EXCLUDED.is_active,
             updated_by_name = EXCLUDED.updated_by_name,
             updated_at = NOW()`,
          [
            key,
            String(stat?.label || key).slice(0, 160),
            String(stat?.value ?? "").slice(0, 64),
            String(stat?.description || "") || null,
            String(stat?.category || "general").slice(0, 40),
            Number.parseInt(stat?.sortOrder, 10) || 100,
            stat?.isActive !== false,
            editorName,
          ],
        );
      }

      const result = await query(`SELECT * FROM university_stats ORDER BY sort_order ASC, id ASC`);
      return successResponse(res, "University stats updated", result.rows.map(mapStatRow));
    } catch (error) {
      return errorResponse(
        res,
        "Failed to update university stats",
        [{ field: "universityStats", message: error.message }],
        500,
      );
    }
  },
);

module.exports = router;
