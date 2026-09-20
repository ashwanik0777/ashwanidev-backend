const express = require("express");
const { query } = require("../../config/db");
const { authenticate, authorize } = require("../../middleware/auth");
const ROLES = require("../../constants/roles");
const { successResponse, errorResponse } = require("../../utils/response");

const router = express.Router();

/**
 * GET /api/v1/admin/backup
 * Exports the entire database (all public-schema tables with full data) as JSON.
 * Only super_admin can access this endpoint.
 */
router.get(
  "/admin/backup",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      // 1. Discover all public-schema tables
      const { rows: tableRows } = await query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
        ORDER BY table_name
      `);

      const backup = {
        backupDate: new Date().toISOString().slice(0, 10),
        exportedAt: new Date().toISOString(),
        exportedBy: req.user?.email || "unknown",
        totalTables: tableRows.length,
        tables: {},
      };

      let totalRows = 0;

      for (const { table_name } of tableRows) {
        const { rows } = await query(
          `SELECT * FROM public."${table_name}"`,
        );
        backup.tables[table_name] = {
          rowCount: rows.length,
          rows,
        };
        totalRows += rows.length;
      }

      backup.totalRows = totalRows;

      // Stream the JSON as a downloadable file
      const filename = `gbu-full-db-backup-${backup.backupDate}.json`;
      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      return res.status(200).json(backup);
    } catch (error) {
      console.error("[Backup] Export failed:", error);
      return errorResponse(
        res,
        "Database backup failed",
        [{ field: "backup", message: error.message }],
        500,
      );
    }
  },
);

module.exports = router;
