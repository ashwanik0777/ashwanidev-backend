const { query } = require("../../config/db");
const { APPROVAL, KINDS, LEVELS, UNIVERSITY_SCHOOL_CODE } = require("./schema");
const { buildColumnValues, ensureAnnouncementsSchema, normalizeSchoolCode } = require("./store");

/*
 * One-time move of announcements out of the `schools.content` JSONB blob and
 * into their real tables.
 *
 * The admin/school dashboards used to write notices/news/events/newsletters/
 * gallery items into schools.content, while the public pages read the tables —
 * so dashboard entries were invisible on the website. Everything now lives in
 * the tables; this carries the existing blob data across so nothing is lost.
 *
 * The source arrays are left in place (only flagged as migrated) so the old data
 * is still recoverable if anything looks wrong after the switch.
 */

const MIGRATION_FLAG = "__announcementsMigratedAt";

// content key in schools.content -> announcement kind
const CONTENT_KEY_TO_KIND = {
  notices: "notices",
  news: "news",
  events: "events",
  newsletters: "newsletters",
  eventGallery: "gallery",
};

let migrationRun = false;

const migrateSchoolAnnouncements = async () => {
  if (migrationRun) return { migrated: 0, skipped: true };
  await ensureAnnouncementsSchema();

  let migrated = 0;

  const schools = await query(
    `SELECT id, code, name, content FROM schools WHERE content IS NOT NULL`,
  );

  for (const school of schools.rows) {
    const content = school.content || {};
    if (content[MIGRATION_FLAG]) continue;

    const schoolCode = normalizeSchoolCode(school.code);
    const isUniversity = schoolCode === UNIVERSITY_SCHOOL_CODE;

    for (const [contentKey, kind] of Object.entries(CONTENT_KEY_TO_KIND)) {
      const items = Array.isArray(content[contentKey]) ? content[contentKey] : [];
      const config = KINDS[kind];

      for (const item of items) {
        if (!item || !String(item.title || "").trim()) continue;

        try {
          // Skip anything that already looks migrated (same title + school).
          const duplicate = await query(
            `SELECT id FROM ${config.table}
             WHERE LOWER(title) = LOWER($1) AND UPPER(school_code) = $2 LIMIT 1`,
            [String(item.title).trim(), schoolCode],
          );
          if (duplicate.rows.length) continue;

          const { columns, values, missing } = buildColumnValues(kind, item);
          if (missing.length) continue;

          // A GBU-owned item is university-wide; a school's item defaults to its
          // own school unless it explicitly declared college level.
          const level =
            String(item.level || "").toLowerCase() === LEVELS.COLLEGE || isUniversity
              ? LEVELS.COLLEGE
              : LEVELS.SCHOOL;

          await query(
            `INSERT INTO ${config.table}
             (${[...columns, "school_code", "level", "approval_status", "created_by_name"].join(", ")})
             VALUES (${[...values, schoolCode, level, APPROVAL.PUBLISHED, "Migrated"]
               .map((_, index) => `$${index + 1}`)
               .join(", ")})`,
            [...values, schoolCode, level, APPROVAL.PUBLISHED, "Migrated"],
          );
          migrated += 1;
        } catch (error) {
          console.warn(
            `[Announcements migration] ${school.code}/${contentKey} "${item.title}": ${error.message}`,
          );
        }
      }
    }

    await query(
      `UPDATE schools SET content = jsonb_set(COALESCE(content, '{}'::jsonb), $2, to_jsonb($3::text), true) WHERE id = $1`,
      [school.id, `{${MIGRATION_FLAG}}`, new Date().toISOString()],
    );
  }

  migrationRun = true;
  if (migrated) {
    console.log(`[Announcements migration] moved ${migrated} item(s) into announcement tables`);
  }
  return { migrated, skipped: false };
};

module.exports = { migrateSchoolAnnouncements, MIGRATION_FLAG };
