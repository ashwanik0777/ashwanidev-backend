const express = require("express");
const { query, getDbPool } = require("../../config/db");
const { successResponse, errorResponse } = require("../../utils/response");
const { authenticate, authorize } = require("../../middleware/auth");
const ROLES = require("../../constants/roles");

const router = express.Router();
const CACHE_TTL_MS = Number.parseInt(process.env.API_CACHE_TTL_MS || "60000", 10);
const RESPONSE_CACHE_CONTROL = "public, max-age=30, stale-while-revalidate=120";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const recruitmentsCacheByKey = new Map();

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toBool = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  return fallback;
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

const mapRecruitmentRow = (row) => {
  const closingDate = toDateOnlyString(row.closing_date);
  const publishedDate = toDateOnlyString(row.published_date);

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    referenceNo: row.reference_no,
    category: row.category,
    tabId: row.tab_id,
    publishedDate,
    closingDate,
    year: row.year,
    isArchived: row.is_archived,
    status: row.status,
    documents: Array.isArray(row.documents) ? row.documents : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
};

const groupItemsByCategory = (items) => {
  return items.reduce((accumulator, item) => {
    const key = item.category || "others";
    if (!accumulator[key]) {
      accumulator[key] = [];
    }
    accumulator[key].push(item);
    return accumulator;
  }, {});
};

const groupItemsByYear = (items) => {
  return items.reduce((accumulator, item) => {
    const key = String(item.year || "unknown");
    if (!accumulator[key]) {
      accumulator[key] = [];
    }
    accumulator[key].push(item);
    return accumulator;
  }, {});
};

const listRecruitments = async (req, res) => {
  try {
    const page = toPositiveInt(req.query.page, 1);
    const limit = Math.min(toPositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const offset = (page - 1) * limit;
    const status = String(req.query.status || "all").trim().toLowerCase();
    const includeGrouped = toBool(req.query.grouped, false);

    const statusFilterSql =
      status === "current"
        ? "AND (r.closing_date IS NULL OR r.closing_date >= CURRENT_DATE)"
        : status === "archived"
          ? "AND (r.closing_date IS NOT NULL AND r.closing_date < CURRENT_DATE)"
          : "";

    const cacheKey = JSON.stringify({ page, limit, status, includeGrouped });
    const cached = recruitmentsCacheByKey.get(cacheKey);

    if (cached && Date.now() < cached.expiresAt) {
      res.set("Cache-Control", RESPONSE_CACHE_CONTROL);
      return successResponse(
        res,
        "Recruitments fetched successfully",
        cached.payload,
      );
    }

    const totalCountResult = await query(
      `
      SELECT COUNT(*)::int AS total
      FROM recruitments r
      WHERE r.is_active = TRUE
      ${statusFilterSql}
      `,
    );

    const total = totalCountResult.rows[0]?.total || 0;
    const pages = total === 0 ? 1 : Math.ceil(total / limit);
    const safePage = Math.min(page, pages);
    const safeOffset = (safePage - 1) * limit;

    const result = await query(
      `
			SELECT
				r.id,
				r.title,
				r.description,
				r.reference_no,
				r.category,
				r.tab_id,
				r.published_date,
				r.closing_date,
        EXTRACT(YEAR FROM COALESCE(r.closing_date, r.published_date))::int AS year,
        (r.closing_date IS NOT NULL AND r.closing_date < CURRENT_DATE) AS is_archived,
        CASE
          WHEN r.closing_date IS NOT NULL AND r.closing_date < CURRENT_DATE THEN 'archived'
          ELSE 'current'
        END AS status,
				r.created_at,
				r.updated_at,
				COALESCE(
					json_agg(
						json_build_object(
							'id', d.id,
							'name', d.name,
							'documentType', d.document_type,
							'url', d.file_url,
							'description', d.description,
							'sortOrder', d.sort_order
						)
						ORDER BY d.sort_order ASC, d.id ASC
					) FILTER (WHERE d.id IS NOT NULL),
					'[]'::json
				) AS documents
			FROM recruitments r
			LEFT JOIN recruitment_documents d
				ON d.recruitment_id = r.id
				AND d.is_active = TRUE
      WHERE r.is_active = TRUE
			${statusFilterSql}
			GROUP BY r.id
			ORDER BY r.closing_date DESC NULLS LAST, r.published_date DESC NULLS LAST, r.id DESC
			LIMIT $1 OFFSET $2
			`,
      [limit, safeOffset],
    );

    const items = result.rows.map(mapRecruitmentRow);

    const payload = {
      items,
      meta: {
        page: safePage,
        limit,
        total,
        pages,
        offset: safeOffset,
      },
    };

    if (includeGrouped) {
      const current = items.filter((item) => item.status === "current");
      const archived = items.filter((item) => item.status === "archived");

      payload.current = current;
      payload.archived = archived;
      payload.currentByCategory = groupItemsByCategory(current);
      payload.archivedByYear = groupItemsByYear(archived);
      payload.meta.currentCount = current.length;
      payload.meta.archivedCount = archived.length;
    }

    recruitmentsCacheByKey.set(cacheKey, {
      payload,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });

    res.set("Cache-Control", RESPONSE_CACHE_CONTROL);

    return successResponse(res, "Recruitments fetched successfully", payload);
  } catch (error) {
    if (error.code === "42P01") {
      return successResponse(res, "Recruitments fetched successfully", {
        items: [],
        current: [],
        archived: [],
        currentByCategory: {},
        archivedByYear: {},
        meta: {
          total: 0,
          currentCount: 0,
          archivedCount: 0,
        },
      });
    }

    return errorResponse(
      res,
      "Failed to fetch recruitments",
      [{ field: "recruitments", message: error.message }],
      500,
    );
  }
};

router.get("/recruitments", listRecruitments);

/* ═══════════════════════════════════════════════════════════════
   ADMIN CRUD

   Recruitment entries were only ever edited in the admin dashboard's
   localStorage, so nothing an administrator added there reached the public
   Recruitments page (which reads GET /recruitments from the database). These
   handlers give the dashboard a real persistence path, documents included.
   ═══════════════════════════════════════════════════════════════ */

const ensureRecruitmentsSchema = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS recruitments (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      reference_no VARCHAR(100),
      category VARCHAR(50) NOT NULL DEFAULT 'others',
      tab_id VARCHAR(50) NOT NULL DEFAULT '',
      published_date DATE,
      closing_date DATE,
      year VARCHAR(10),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS recruitment_documents (
      id SERIAL PRIMARY KEY,
      recruitment_id INT NOT NULL REFERENCES recruitments(id) ON DELETE CASCADE,
      name VARCHAR(150) NOT NULL,
      document_type VARCHAR(50) NOT NULL DEFAULT 'notice',
      file_url TEXT,
      description TEXT,
      sort_order INT NOT NULL DEFAULT 1,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
  await query(`ALTER TABLE recruitments ADD COLUMN IF NOT EXISTS year VARCHAR(10);`);
  // Older installs made these NOT NULL, which blocks saving a draft posting.
  for (const statement of [
    `ALTER TABLE recruitments ALTER COLUMN reference_no DROP NOT NULL`,
    `ALTER TABLE recruitments ALTER COLUMN closing_date DROP NOT NULL`,
    `ALTER TABLE recruitment_documents ALTER COLUMN file_url DROP NOT NULL`,
  ]) {
    try {
      await query(statement);
    } catch {
      // Already nullable on this install.
    }
  }
};

const invalidateRecruitmentsCache = () => recruitmentsCacheByKey.clear();

const recruitmentBody = (body = {}) => {
  const closingDate = toDateOnlyString(body.closingDate || body.closing_date);
  return {
    title: String(body.title || "").trim(),
    description: String(body.description || "").trim() || null,
    referenceNo: String(body.referenceNo || body.reference_no || "").trim() || null,
    category: String(body.category || body.categoryType || "others").trim() || "others",
    tabId: String(body.tabId || body.tab_id || "").trim(),
    publishedDate: toDateOnlyString(body.publishedDate || body.published_date),
    closingDate,
    year:
      String(body.year || "").trim() ||
      (closingDate ? closingDate.slice(0, 4) : String(new Date().getFullYear())),
  };
};

const normalizeDocuments = (documents) =>
  (Array.isArray(documents) ? documents : [])
    .map((doc, index) => ({
      name: String(doc?.name || "").trim(),
      documentType: String(doc?.documentType || doc?.document_type || "notice").trim() || "notice",
      url: String(doc?.url || doc?.fileUrl || doc?.file_url || "").trim() || null,
      description: String(doc?.description || "").trim() || null,
      sortOrder: Number.parseInt(doc?.sortOrder ?? doc?.sort_order ?? index + 1, 10) || index + 1,
    }))
    .filter((doc) => doc.name);

/** Replaces a posting's document set inside the caller's transaction. */
const replaceDocuments = async (client, recruitmentId, documents) => {
  await client.query(`DELETE FROM recruitment_documents WHERE recruitment_id = $1`, [recruitmentId]);
  for (const doc of documents) {
    await client.query(
      `INSERT INTO recruitment_documents
         (recruitment_id, name, document_type, file_url, description, sort_order, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE)`,
      [recruitmentId, doc.name, doc.documentType, doc.url, doc.description, doc.sortOrder],
    );
  }
};

/** Re-reads one posting with its documents, in the same shape as the list route. */
const fetchRecruitmentById = async (id) => {
  const result = await query(
    `SELECT r.id, r.title, r.description, r.reference_no, r.category, r.tab_id,
            r.published_date, r.closing_date, r.year,
            (r.closing_date IS NOT NULL AND r.closing_date < CURRENT_DATE) AS is_archived,
            CASE WHEN r.closing_date IS NOT NULL AND r.closing_date < CURRENT_DATE
                 THEN 'archived' ELSE 'current' END AS status,
            r.created_at, r.updated_at,
            COALESCE(
              json_agg(
                json_build_object(
                  'id', d.id, 'name', d.name, 'documentType', d.document_type,
                  'url', d.file_url, 'description', d.description, 'sortOrder', d.sort_order
                ) ORDER BY d.sort_order ASC, d.id ASC
              ) FILTER (WHERE d.id IS NOT NULL), '[]'::json
            ) AS documents
     FROM recruitments r
     LEFT JOIN recruitment_documents d ON d.recruitment_id = r.id AND d.is_active = TRUE
     WHERE r.id = $1
     GROUP BY r.id`,
    [id],
  );
  return result.rows.length ? mapRecruitmentRow(result.rows[0]) : null;
};

const recruitmentAdminGuard = [authenticate, authorize(ROLES.SUPER_ADMIN)];

router.post("/recruitments", ...recruitmentAdminGuard, async (req, res) => {
  const data = recruitmentBody(req.body);
  if (!data.title) {
    return errorResponse(res, "Validation failed", [{ field: "title", message: "Title is required" }], 400);
  }

  const documents = normalizeDocuments(req.body?.documents);
  const client = await getDbPool().connect();

  try {
    await ensureRecruitmentsSchema();
    await client.query("BEGIN");

    const inserted = await client.query(
      `INSERT INTO recruitments
         (title, description, reference_no, category, tab_id, published_date, closing_date, year, is_active)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6, CURRENT_DATE), $7, $8, TRUE)
       RETURNING id`,
      [
        data.title,
        data.description,
        data.referenceNo,
        data.category,
        data.tabId,
        data.publishedDate,
        data.closingDate,
        data.year,
      ],
    );

    const recruitmentId = inserted.rows[0].id;
    await replaceDocuments(client, recruitmentId, documents);
    await client.query("COMMIT");

    invalidateRecruitmentsCache();
    return successResponse(res, "Recruitment created successfully", await fetchRecruitmentById(recruitmentId), 201);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") {
      return errorResponse(
        res,
        "Duplicate recruitment",
        [{ field: "referenceNo", message: "A recruitment with this reference number already exists" }],
        409,
      );
    }
    return errorResponse(res, "Failed to create recruitment", [{ field: "recruitment", message: error.message }], 500);
  } finally {
    client.release();
  }
});

router.put("/recruitments/:id", ...recruitmentAdminGuard, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return errorResponse(res, "Validation failed", [{ field: "id", message: "Invalid recruitment id" }], 400);
  }

  const data = recruitmentBody(req.body);
  if (!data.title) {
    return errorResponse(res, "Validation failed", [{ field: "title", message: "Title is required" }], 400);
  }

  const client = await getDbPool().connect();

  try {
    await ensureRecruitmentsSchema();
    await client.query("BEGIN");

    const updated = await client.query(
      `UPDATE recruitments SET
         title = $1, description = $2, reference_no = $3, category = $4, tab_id = $5,
         published_date = COALESCE($6, published_date), closing_date = $7, year = $8,
         updated_at = NOW()
       WHERE id = $9
       RETURNING id`,
      [
        data.title,
        data.description,
        data.referenceNo,
        data.category,
        data.tabId,
        data.publishedDate,
        data.closingDate,
        data.year,
        id,
      ],
    );

    if (!updated.rows.length) {
      await client.query("ROLLBACK");
      return errorResponse(res, "Recruitment not found", [{ field: "id", message: "No recruitment for this id" }], 404);
    }

    // Only touch documents when the caller actually sent the field, so a partial
    // save cannot silently wipe an existing document set.
    if (req.body?.documents !== undefined) {
      await replaceDocuments(client, id, normalizeDocuments(req.body.documents));
    }

    await client.query("COMMIT");
    invalidateRecruitmentsCache();
    return successResponse(res, "Recruitment updated successfully", await fetchRecruitmentById(id));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (error.code === "23505") {
      return errorResponse(
        res,
        "Duplicate recruitment",
        [{ field: "referenceNo", message: "A recruitment with this reference number already exists" }],
        409,
      );
    }
    return errorResponse(res, "Failed to update recruitment", [{ field: "recruitment", message: error.message }], 500);
  } finally {
    client.release();
  }
});

router.delete("/recruitments/:id", ...recruitmentAdminGuard, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return errorResponse(res, "Validation failed", [{ field: "id", message: "Invalid recruitment id" }], 400);
  }

  try {
    await ensureRecruitmentsSchema();
    // recruitment_documents cascades on delete.
    const result = await query(`DELETE FROM recruitments WHERE id = $1 RETURNING id`, [id]);

    if (!result.rows.length) {
      return errorResponse(res, "Recruitment not found", [{ field: "id", message: "No recruitment for this id" }], 404);
    }

    invalidateRecruitmentsCache();
    return successResponse(res, "Recruitment deleted successfully", { id });
  } catch (error) {
    return errorResponse(res, "Failed to delete recruitment", [{ field: "recruitment", message: error.message }], 500);
  }
});

module.exports = router;
