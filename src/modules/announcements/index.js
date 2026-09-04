const express = require("express");
const { query } = require("../../config/db");
const { successResponse, errorResponse } = require("../../utils/response");
const { authenticate, authorize } = require("../../middleware/auth");
const ROLES = require("../../constants/roles");
const { APPROVAL, KINDS, LEVELS, UNIVERSITY_SCHOOL_CODE } = require("./schema");
const {
  buildColumnValues,
  ensureAnnouncementsSchema,
  isUniversityCode,
  mapRow,
  normalizeSchoolCode,
} = require("./store");

const router = express.Router();

const kindConfig = (kind) => KINDS[String(kind || "").toLowerCase()] || null;

const badKind = (res, kind) =>
  errorResponse(
    res,
    "Unknown announcement type",
    [{ field: "kind", message: `'${kind}' is not one of: ${Object.keys(KINDS).join(", ")}` }],
    404,
  );

/**
 * Who the caller is, in announcement terms.
 * A super admin owns the university; a school account owns exactly its own school.
 */
const actorContext = (req) => {
  const role = req.user?.role;
  return {
    role,
    userId: Number(req.user?.sub) || null,
    name: req.user?.name || req.user?.email || "",
    isAdmin: role === ROLES.SUPER_ADMIN,
    schoolCode: normalizeSchoolCode(req.user?.schoolCode),
  };
};

/**
 * Decides the stored school_code / level / approval_status for a write.
 *
 * - Super admin publishes anything immediately, for any school.
 * - A school publishes its own school-level items immediately.
 * - A school asking for college-level reach is queued as 'pending' for review.
 */
const resolveGovernance = (actor, body) => {
  const requestedLevel =
    String(body.level || "").toLowerCase() === LEVELS.SCHOOL ? LEVELS.SCHOOL : LEVELS.COLLEGE;

  if (actor.isAdmin) {
    const requestedSchool = normalizeSchoolCode(body.schoolCode);
    return {
      level: requestedLevel,
      // College-level items belong to the university, not to any one school.
      schoolCode:
        requestedLevel === LEVELS.COLLEGE
          ? UNIVERSITY_SCHOOL_CODE
          : requestedSchool || UNIVERSITY_SCHOOL_CODE,
      approvalStatus: APPROVAL.PUBLISHED,
    };
  }

  // School account: always pinned to its own school, regardless of what was sent.
  return {
    level: requestedLevel,
    schoolCode: actor.schoolCode,
    approvalStatus:
      requestedLevel === LEVELS.COLLEGE ? APPROVAL.PENDING : APPROVAL.PUBLISHED,
  };
};

/** A school may only touch rows belonging to it. */
const canMutate = (actor, row) => {
  if (actor.isAdmin) return true;
  if (!actor.schoolCode) return false;
  return normalizeSchoolCode(row.school_code) === actor.schoolCode;
};

const selectWithSchoolName = (table) => `
  SELECT t.*, s.name AS school_name
  FROM ${table} t
  LEFT JOIN schools s ON UPPER(s.code) = UPPER(t.school_code)
`;

/* ═══════════════════════════════════════════════════════════════
   LIST — scoped to what the caller is allowed to see
   ═══════════════════════════════════════════════════════════════ */

router.get(
  "/admin/announcements/:kind",
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SCHOOL),
  async (req, res) => {
    const config = kindConfig(req.params.kind);
    if (!config) return badKind(res, req.params.kind);

    try {
      await ensureAnnouncementsSchema();
      const actor = actorContext(req);
      const { status, level, schoolCode, search } = req.query;

      const where = [];
      const params = [];

      if (!actor.isAdmin) {
        // Schools see only their own items — never another school's data.
        // Use the JWT school code, falling back to the query param if needed.
        const effectiveSchool = actor.schoolCode || normalizeSchoolCode(schoolCode);
        if (effectiveSchool) {
          params.push(effectiveSchool);
          where.push(`UPPER(t.school_code) = $${params.length}`);
        } else {
          // No school code at all — return nothing rather than leaking data.
          where.push("FALSE");
        }
      } else if (schoolCode) {
        params.push(normalizeSchoolCode(schoolCode));
        where.push(`UPPER(t.school_code) = $${params.length}`);
      }

      if (status && status !== "all") {
        params.push(String(status).toLowerCase());
        where.push(`t.approval_status = $${params.length}`);
      }

      if (level && level !== "all") {
        params.push(String(level).toLowerCase());
        where.push(`t.level = $${params.length}`);
      }

      if (search) {
        params.push(`%${String(search).trim().toLowerCase()}%`);
        where.push(`LOWER(t.title) LIKE $${params.length}`);
      }

      const result = await query(
        `${selectWithSchoolName(config.table)}
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY t.${config.dateColumn} DESC NULLS LAST, t.id DESC`,
        params,
      );

      return successResponse(
        res,
        `${config.label} list fetched`,
        result.rows.map((row) => mapRow(req.params.kind.toLowerCase(), row)),
      );
    } catch (error) {
      return errorResponse(
        res,
        `Failed to fetch ${config.label.toLowerCase()} list`,
        [{ field: "announcements", message: error.message }],
        500,
      );
    }
  },
);

/* ═══════════════════════════════════════════════════════════════
   PENDING QUEUE — college-level submissions awaiting admin review
   ═══════════════════════════════════════════════════════════════ */

router.get(
  "/admin/announcements-pending",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    try {
      await ensureAnnouncementsSchema();
      const pending = [];

      for (const [kind, config] of Object.entries(KINDS)) {
        const result = await query(
          `${selectWithSchoolName(config.table)}
           WHERE t.approval_status = $1
           ORDER BY t.created_at DESC, t.id DESC`,
          [APPROVAL.PENDING],
        );
        pending.push(...result.rows.map((row) => mapRow(kind, row)));
      }

      pending.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      return successResponse(res, "Pending announcements fetched", pending);
    } catch (error) {
      return errorResponse(
        res,
        "Failed to fetch pending announcements",
        [{ field: "announcements", message: error.message }],
        500,
      );
    }
  },
);

/* ═══════════════════════════════════════════════════════════════
   CREATE
   ═══════════════════════════════════════════════════════════════ */

router.post(
  "/admin/announcements/:kind",
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SCHOOL),
  async (req, res) => {
    const kind = String(req.params.kind || "").toLowerCase();
    const config = kindConfig(kind);
    if (!config) return badKind(res, req.params.kind);

    try {
      await ensureAnnouncementsSchema();
      const actor = actorContext(req);

      if (!actor.isAdmin && !actor.schoolCode) {
        return errorResponse(
          res,
          "No school linked to this account",
          [{ field: "schoolCode", message: "Ask an administrator to link your login to a school" }],
          403,
        );
      }

      const { columns, values, missing } = buildColumnValues(kind, req.body);
      if (missing.length) {
        return errorResponse(res, "Validation failed", missing, 400);
      }

      const governance = resolveGovernance(actor, req.body);
      const allColumns = [
        ...columns,
        "school_code",
        "level",
        "approval_status",
        "created_by",
        "created_by_name",
      ];
      const allValues = [
        ...values,
        governance.schoolCode,
        governance.level,
        governance.approvalStatus,
        actor.userId,
        actor.name,
      ];

      const placeholders = allValues.map((_, index) => `$${index + 1}`).join(", ");
      const result = await query(
        `INSERT INTO ${config.table} (${allColumns.join(", ")})
         VALUES (${placeholders})
         RETURNING *`,
        allValues,
      );

      const created = mapRow(kind, result.rows[0]);
      const queued = governance.approvalStatus === APPROVAL.PENDING;

      return successResponse(
        res,
        queued
          ? `${config.label} submitted for admin approval`
          : `${config.label} published successfully`,
        created,
        201,
      );
    } catch (error) {
      return errorResponse(
        res,
        `Failed to create ${config.label.toLowerCase()}`,
        [{ field: "announcements", message: error.message }],
        500,
      );
    }
  },
);

/* ═══════════════════════════════════════════════════════════════
   UPDATE
   ═══════════════════════════════════════════════════════════════ */

router.put(
  "/admin/announcements/:kind/:id",
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SCHOOL),
  async (req, res) => {
    const kind = String(req.params.kind || "").toLowerCase();
    const config = kindConfig(kind);
    if (!config) return badKind(res, req.params.kind);

    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return errorResponse(res, "Validation failed", [{ field: "id", message: "Invalid id" }], 400);
    }

    try {
      await ensureAnnouncementsSchema();
      const actor = actorContext(req);

      const existing = await query(`SELECT * FROM ${config.table} WHERE id = $1 LIMIT 1`, [id]);
      if (!existing.rows.length) {
        return errorResponse(res, `${config.label} not found`, [], 404);
      }
      if (!canMutate(actor, existing.rows[0])) {
        return errorResponse(
          res,
          "Forbidden",
          [{ field: "schoolCode", message: "You can only edit announcements owned by your school" }],
          403,
        );
      }

      const { columns, values, missing } = buildColumnValues(kind, req.body, { partial: true });
      if (missing.length) {
        return errorResponse(res, "Validation failed", missing, 400);
      }

      const governance = resolveGovernance(actor, {
        level: req.body.level ?? existing.rows[0].level,
        schoolCode: req.body.schoolCode ?? existing.rows[0].school_code,
      });

      // Editing an already-approved item as a school re-opens review only when
      // the item is (or becomes) college-level.
      const nextApproval = actor.isAdmin
        ? existing.rows[0].approval_status === APPROVAL.PENDING
          ? APPROVAL.PUBLISHED
          : existing.rows[0].approval_status
        : governance.approvalStatus;

      const allColumns = [...columns, "school_code", "level", "approval_status", "updated_at"];
      const allValues = [...values, governance.schoolCode, governance.level, nextApproval];

      const assignments = allColumns
        .map((column, index) =>
          column === "updated_at" ? "updated_at = NOW()" : `${column} = $${index + 1}`,
        )
        .join(", ");

      const result = await query(
        `UPDATE ${config.table} SET ${assignments} WHERE id = $${allValues.length + 1} RETURNING *`,
        [...allValues, id],
      );

      return successResponse(res, `${config.label} updated`, mapRow(kind, result.rows[0]));
    } catch (error) {
      return errorResponse(
        res,
        `Failed to update ${config.label.toLowerCase()}`,
        [{ field: "announcements", message: error.message }],
        500,
      );
    }
  },
);

/* ═══════════════════════════════════════════════════════════════
   DELETE
   ═══════════════════════════════════════════════════════════════ */

router.delete(
  "/admin/announcements/:kind/:id",
  authenticate,
  authorize(ROLES.SUPER_ADMIN, ROLES.SCHOOL),
  async (req, res) => {
    const kind = String(req.params.kind || "").toLowerCase();
    const config = kindConfig(kind);
    if (!config) return badKind(res, req.params.kind);

    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return errorResponse(res, "Validation failed", [{ field: "id", message: "Invalid id" }], 400);
    }

    try {
      await ensureAnnouncementsSchema();
      const actor = actorContext(req);

      const existing = await query(`SELECT * FROM ${config.table} WHERE id = $1 LIMIT 1`, [id]);
      if (!existing.rows.length) {
        return errorResponse(res, `${config.label} not found`, [], 404);
      }
      if (!canMutate(actor, existing.rows[0])) {
        return errorResponse(
          res,
          "Forbidden",
          [{ field: "schoolCode", message: "You can only delete announcements owned by your school" }],
          403,
        );
      }

      await query(`DELETE FROM ${config.table} WHERE id = $1`, [id]);
      return successResponse(res, `${config.label} deleted`, { id });
    } catch (error) {
      return errorResponse(
        res,
        `Failed to delete ${config.label.toLowerCase()}`,
        [{ field: "announcements", message: error.message }],
        500,
      );
    }
  },
);

/* ═══════════════════════════════════════════════════════════════
   APPROVE / REJECT — super admin only
   ═══════════════════════════════════════════════════════════════ */

const reviewHandler = (decision) => async (req, res) => {
  const kind = String(req.params.kind || "").toLowerCase();
  const config = kindConfig(kind);
  if (!config) return badKind(res, req.params.kind);

  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) {
    return errorResponse(res, "Validation failed", [{ field: "id", message: "Invalid id" }], 400);
  }

  try {
    await ensureAnnouncementsSchema();
    const actor = actorContext(req);

    const result = await query(
      `UPDATE ${config.table}
       SET approval_status = $1,
           reviewed_by = $2,
           reviewed_by_name = $3,
           reviewed_at = NOW(),
           review_note = $4,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [decision, actor.userId, actor.name, String(req.body?.note || "").trim() || null, id],
    );

    if (!result.rows.length) {
      return errorResponse(res, `${config.label} not found`, [], 404);
    }

    return successResponse(
      res,
      decision === APPROVAL.PUBLISHED
        ? `${config.label} approved and published`
        : `${config.label} rejected`,
      mapRow(kind, result.rows[0]),
    );
  } catch (error) {
    return errorResponse(
      res,
      "Failed to review announcement",
      [{ field: "announcements", message: error.message }],
      500,
    );
  }
};

router.post(
  "/admin/announcements/:kind/:id/approve",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  reviewHandler(APPROVAL.PUBLISHED),
);

router.post(
  "/admin/announcements/:kind/:id/reject",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  reviewHandler(APPROVAL.REJECTED),
);

module.exports = router;
