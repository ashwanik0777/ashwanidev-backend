const express = require("express");
const { query } = require("../../config/db");
const { successResponse, errorResponse } = require("../../utils/response");
const { authenticate, authorize } = require("../../middleware/auth");
const ROLES = require("../../constants/roles");

const router = express.Router();

// ── Schema Bootstrap (promise-based lock to avoid concurrent queries) ──
let schemaPromise = null;
const ensureSchema = () => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query(`
        CREATE TABLE IF NOT EXISTS ticker_notices (
          id SERIAL PRIMARY KEY,
          text VARCHAR(500) NOT NULL,
          link VARCHAR(500) DEFAULT '#',
          is_active BOOLEAN DEFAULT true,
          sort_order INTEGER DEFAULT 0,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // Seed the initial notice if table is empty
      const countResult = await query(`SELECT COUNT(*) as total FROM ticker_notices`);
      if (parseInt(countResult.rows[0].total, 10) === 0) {
        await query(
          `INSERT INTO ticker_notices (text, link, sort_order) VALUES ($1, $2, $3)`,
          [
            "ADMISSION OPEN 2026-27/Fifth Phase : Counseling-cum-admission scheduled on 4th August 2026",
            "/announcements/news-notifications",
            0,
          ]
        );
      }
    })();
  }
  return schemaPromise;
};

// ══════════════════════════════════════════
// PUBLIC — Active ticker notices for homepage
// ══════════════════════════════════════════
router.get("/ticker-notices", async (req, res) => {
  try {
    await ensureSchema();
    const result = await query(
      `SELECT id, text, link FROM ticker_notices WHERE is_active = true ORDER BY sort_order ASC, created_at DESC LIMIT 5`
    );
    return successResponse(res, "Ticker notices fetched", result.rows);
  } catch (error) {
    console.error("Ticker fetch error:", error.message);
    return errorResponse(res, "Failed to fetch ticker notices", [], 500);
  }
});

// ══════════════════════════════════════════
// ADMIN — Full CRUD for ticker notices
// ══════════════════════════════════════════

// List all (including inactive)
router.get(
  "/admin/ticker-notices",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      await ensureSchema();
      const result = await query(
        `SELECT * FROM ticker_notices ORDER BY sort_order ASC, created_at DESC`
      );
      return successResponse(res, "All ticker notices fetched", result.rows);
    } catch (error) {
      console.error("Admin ticker list error:", error.message);
      return errorResponse(res, "Failed to fetch ticker notices", [], 500);
    }
  }
);

// Create
router.post(
  "/admin/ticker-notices",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      await ensureSchema();
      const { text, link } = req.body;

      if (!text || !text.trim()) {
        return errorResponse(res, "Notice text is required", [], 400);
      }

      // Get the next sort order
      const countResult = await query(`SELECT COUNT(*) as total FROM ticker_notices`);
      const nextOrder = parseInt(countResult.rows[0].total, 10);

      const result = await query(
        `INSERT INTO ticker_notices (text, link, sort_order) VALUES ($1, $2, $3) RETURNING *`,
        [text.trim(), (link || "#").trim(), nextOrder]
      );

      return successResponse(res, "Ticker notice created", result.rows[0], 201);
    } catch (error) {
      console.error("Admin ticker create error:", error.message);
      return errorResponse(res, "Failed to create ticker notice", [], 500);
    }
  }
);

// Update
router.put(
  "/admin/ticker-notices/:id",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      await ensureSchema();
      const { id } = req.params;
      const { text, link, is_active } = req.body;

      const existing = await query(`SELECT * FROM ticker_notices WHERE id = $1`, [id]);
      if (existing.rows.length === 0) {
        return errorResponse(res, "Ticker notice not found", [], 404);
      }

      const updatedText = text !== undefined ? text.trim() : existing.rows[0].text;
      const updatedLink = link !== undefined ? link.trim() : existing.rows[0].link;
      const updatedActive = is_active !== undefined ? is_active : existing.rows[0].is_active;

      const result = await query(
        `UPDATE ticker_notices SET text = $1, link = $2, is_active = $3, updated_at = NOW() WHERE id = $4 RETURNING *`,
        [updatedText, updatedLink, updatedActive, id]
      );

      return successResponse(res, "Ticker notice updated", result.rows[0]);
    } catch (error) {
      console.error("Admin ticker update error:", error.message);
      return errorResponse(res, "Failed to update ticker notice", [], 500);
    }
  }
);

// Delete
router.delete(
  "/admin/ticker-notices/:id",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      await ensureSchema();
      const { id } = req.params;

      const existing = await query(`SELECT * FROM ticker_notices WHERE id = $1`, [id]);
      if (existing.rows.length === 0) {
        return errorResponse(res, "Ticker notice not found", [], 404);
      }

      await query(`DELETE FROM ticker_notices WHERE id = $1`, [id]);
      return successResponse(res, "Ticker notice deleted");
    } catch (error) {
      console.error("Admin ticker delete error:", error.message);
      return errorResponse(res, "Failed to delete ticker notice", [], 500);
    }
  }
);

module.exports = router;
