const express = require("express");
const { query } = require("../../config/db");
const { successResponse, errorResponse } = require("../../utils/response");
const { authenticate, authorize } = require("../../middleware/auth");
const ROLES = require("../../constants/roles");

const router = express.Router();
const CACHE_TTL_MS = Number.parseInt(process.env.API_CACHE_TTL_MS || "60000", 10);
const RESPONSE_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=120";

let tendersCache = {
  payload: null,
  expiresAt: 0,
};

const toDateOnlyString = (value) => {
  if (!value) {
    return null;
  }

  // DATE columns arrive as 'YYYY-MM-DD' strings (see config/db.js) — take them
  // as-is. Formatting a Date via toISOString() would shift the day backwards on
  // a server running in a positive-offset timezone such as IST.
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) {
      return match[1];
    }
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const mapTenderRow = (row) => {
  const closingDate = toDateOnlyString(row.closing_date);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    referenceNo: row.reference_no,
    category: row.category,
    tenderType: row.tender_type,
    publishedDate: toDateOnlyString(row.published_date),
    closingDate,
    documentUrl: row.document_url,
    isArchived: row.is_archived,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

router.get("/tenders", async (req, res) => {
  try {
    if (tendersCache.payload && Date.now() < tendersCache.expiresAt) {
      res.set("Cache-Control", RESPONSE_CACHE_CONTROL);
      return successResponse(res, "Tenders fetched successfully", tendersCache.payload);
    }

    const result = await query(
      `
			SELECT
				id,
				title,
				description,
				reference_no,
				category,
				tender_type,
				published_date,
				closing_date,
				document_url,
        (closing_date IS NOT NULL AND closing_date < CURRENT_DATE) AS is_archived,
        CASE
          WHEN closing_date IS NOT NULL AND closing_date < CURRENT_DATE THEN 'archived'
          ELSE 'current'
        END AS status,
				created_at,
				updated_at
			FROM tenders
      WHERE is_active = TRUE
			ORDER BY closing_date ASC NULLS LAST, id DESC
			`,
    );

    const items = result.rows.map(mapTenderRow);
    const current = items.filter((item) => item.status === "current");
    const archived = items.filter((item) => item.status === "archived");

    const payload = {
      items,
      current,
      archived,
      meta: {
        total: items.length,
        currentCount: current.length,
        archivedCount: archived.length,
      },
    };

    tendersCache = {
      payload,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };

    res.set("Cache-Control", RESPONSE_CACHE_CONTROL);

    return successResponse(res, "Tenders fetched successfully", payload);
  } catch (error) {
    if (error.code === "42P01") {
      return successResponse(res, "Tenders fetched successfully", {
        items: [],
        current: [],
        archived: [],
        meta: {
          total: 0,
          currentCount: 0,
          archivedCount: 0,
        },
      });
    }

    return errorResponse(
      res,
      "Failed to fetch tenders",
      [{ field: "tenders", message: error.message }],
      500,
    );
  }
});

/* ═══════════════════════════════════════════════════════════════
   ADMIN CRUD

   The admin dashboard has always called POST/PUT/DELETE /tenders, but only the
   public GET existed — so every tender save from the dashboard returned 404 and
   the data never reached the database. These handlers close that gap.
   ═══════════════════════════════════════════════════════════════ */

const ensureTendersSchema = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS tenders (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      reference_no VARCHAR(100),
      category VARCHAR(100),
      tender_type VARCHAR(20) NOT NULL DEFAULT 'RFP',
      published_date DATE,
      closing_date DATE,
      document_url TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  // Older installs made these NOT NULL / UNIQUE, which blocks saving a tender
  // that legitimately has no reference number or document yet.
  for (const statement of [
    `ALTER TABLE tenders ALTER COLUMN reference_no DROP NOT NULL`,
    `ALTER TABLE tenders ALTER COLUMN document_url DROP NOT NULL`,
    `ALTER TABLE tenders ALTER COLUMN closing_date DROP NOT NULL`,
  ]) {
    try {
      await query(statement);
    } catch {
      // Already nullable on this install.
    }
  }
};

const invalidateTendersCache = () => {
  tendersCache = { payload: null, expiresAt: 0 };
};

const tenderBody = (body = {}) => ({
  title: String(body.title || "").trim(),
  description: String(body.description || "").trim() || null,
  referenceNo: String(body.referenceNo || body.reference_no || "").trim() || null,
  category: String(body.category || "").trim() || null,
  tenderType: String(body.tenderType || body.tender_type || "RFP").trim() || "RFP",
  publishedDate: toDateOnlyString(body.publishedDate || body.published_date),
  closingDate: toDateOnlyString(body.closingDate || body.closing_date),
  documentUrl: String(body.documentUrl || body.document_url || "").trim() || null,
});

const adminGuard = [authenticate, authorize(ROLES.SUPER_ADMIN)];

router.post("/tenders", ...adminGuard, async (req, res) => {
  const data = tenderBody(req.body);

  if (!data.title) {
    return errorResponse(res, "Validation failed", [{ field: "title", message: "Title is required" }], 400);
  }

  try {
    await ensureTendersSchema();
    const result = await query(
      `INSERT INTO tenders
         (title, description, reference_no, category, tender_type, published_date, closing_date, document_url, is_active)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), $7, $8, TRUE)
       RETURNING *,
         (closing_date IS NOT NULL AND closing_date < CURRENT_DATE) AS is_archived,
         CASE WHEN closing_date IS NOT NULL AND closing_date < CURRENT_DATE THEN 'archived' ELSE 'current' END AS status`,
      [
        data.title,
        data.description,
        data.referenceNo,
        data.category,
        data.tenderType,
        data.publishedDate,
        data.closingDate,
        data.documentUrl,
      ],
    );

    invalidateTendersCache();
    return successResponse(res, "Tender created successfully", mapTenderRow(result.rows[0]), 201);
  } catch (error) {
    if (error.code === "23505") {
      return errorResponse(
        res,
        "Duplicate tender",
        [{ field: "referenceNo", message: "A tender with this reference number already exists" }],
        409,
      );
    }
    return errorResponse(res, "Failed to create tender", [{ field: "tender", message: error.message }], 500);
  }
});

router.put("/tenders/:id", ...adminGuard, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return errorResponse(res, "Validation failed", [{ field: "id", message: "Invalid tender id" }], 400);
  }

  const data = tenderBody(req.body);
  if (!data.title) {
    return errorResponse(res, "Validation failed", [{ field: "title", message: "Title is required" }], 400);
  }

  try {
    await ensureTendersSchema();
    const result = await query(
      `UPDATE tenders SET
         title = $1, description = $2, reference_no = $3, category = $4,
         tender_type = $5, published_date = COALESCE($6, published_date),
         closing_date = $7, document_url = $8, updated_at = NOW()
       WHERE id = $9
       RETURNING *,
         (closing_date IS NOT NULL AND closing_date < CURRENT_DATE) AS is_archived,
         CASE WHEN closing_date IS NOT NULL AND closing_date < CURRENT_DATE THEN 'archived' ELSE 'current' END AS status`,
      [
        data.title,
        data.description,
        data.referenceNo,
        data.category,
        data.tenderType,
        data.publishedDate,
        data.closingDate,
        data.documentUrl,
        id,
      ],
    );

    if (!result.rows.length) {
      return errorResponse(res, "Tender not found", [{ field: "id", message: "No tender for this id" }], 404);
    }

    invalidateTendersCache();
    return successResponse(res, "Tender updated successfully", mapTenderRow(result.rows[0]));
  } catch (error) {
    if (error.code === "23505") {
      return errorResponse(
        res,
        "Duplicate tender",
        [{ field: "referenceNo", message: "A tender with this reference number already exists" }],
        409,
      );
    }
    return errorResponse(res, "Failed to update tender", [{ field: "tender", message: error.message }], 500);
  }
});

router.delete("/tenders/:id", ...adminGuard, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return errorResponse(res, "Validation failed", [{ field: "id", message: "Invalid tender id" }], 400);
  }

  try {
    await ensureTendersSchema();
    const result = await query(`DELETE FROM tenders WHERE id = $1 RETURNING id`, [id]);

    if (!result.rows.length) {
      return errorResponse(res, "Tender not found", [{ field: "id", message: "No tender for this id" }], 404);
    }

    invalidateTendersCache();
    return successResponse(res, "Tender deleted successfully", { id });
  } catch (error) {
    return errorResponse(res, "Failed to delete tender", [{ field: "tender", message: error.message }], 500);
  }
});

module.exports = router;
