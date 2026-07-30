const { query } = require("../../config/db");
const {
  APPROVAL,
  EXTRA_COLUMNS,
  GOVERNANCE_COLUMNS,
  KINDS,
  LEVELS,
  UNIVERSITY_SCHOOL_CODE,
} = require("./schema");

let bootstrapped = false;

/**
 * Creates the announcement tables if missing and adds the governance columns to
 * existing installs. Safe to call on every request — it short-circuits after the
 * first successful run.
 */
const ensureAnnouncementsSchema = async () => {
  if (bootstrapped) return;

  // Base tables, in case this runs against a fresh database.
  await query(`
    CREATE TABLE IF NOT EXISTS notices (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      content TEXT,
      published_date DATE,
      type VARCHAR(100),
      priority VARCHAR(50) DEFAULT 'medium',
      views INT DEFAULT 0,
      is_new BOOLEAN DEFAULT true,
      pdf_url TEXT
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS news (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      excerpt TEXT,
      content TEXT,
      author VARCHAR(100),
      department VARCHAR(100),
      category VARCHAR(100),
      published_date DATE,
      priority VARCHAR(50) DEFAULT 'medium',
      views INT DEFAULT 0,
      likes INT DEFAULT 0,
      is_featured BOOLEAN DEFAULT false,
      status VARCHAR(50) DEFAULT 'published',
      image_url TEXT,
      tags JSONB DEFAULT '[]'::jsonb
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS newsletters (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      issue_number VARCHAR(100),
      published_date DATE,
      cover_image_url TEXT,
      excerpt TEXT,
      pdf_url TEXT,
      views INT DEFAULT 0,
      category VARCHAR(100)
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      organizer VARCHAR(255),
      venue VARCHAR(255),
      type VARCHAR(100),
      mode VARCHAR(50) DEFAULT 'Offline',
      status VARCHAR(20),
      price VARCHAR(50) DEFAULT 'Free',
      attendees INT DEFAULT 0,
      starts_at TIMESTAMP NOT NULL,
      ends_at TIMESTAMP,
      time_string VARCHAR(50),
      year VARCHAR(10),
      cover_image TEXT,
      registration_url TEXT,
      tags JSONB DEFAULT '[]'::jsonb,
      gallery JSONB DEFAULT '[]'::jsonb,
      agenda JSONB DEFAULT '[]'::jsonb,
      speakers JSONB DEFAULT '[]'::jsonb
    );
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS media_gallery (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      category VARCHAR(100),
      year VARCHAR(10),
      published_date DATE,
      images JSONB DEFAULT '[]'::jsonb
    );
  `);

  // Older installs declared these NOT NULL, but the dashboards legitimately
  // leave them blank (a gallery album need not carry a year, for instance).
  const optionalColumns = [
    ["media_gallery", "category"],
    ["media_gallery", "year"],
    ["media_gallery", "published_date"],
    ["notices", "content"],
    ["news", "content"],
  ];
  for (const [table, column] of optionalColumns) {
    try {
      await query(`ALTER TABLE ${table} ALTER COLUMN ${column} DROP NOT NULL;`);
    } catch (error) {
      // Column already nullable, or does not exist on this install.
    }
  }

  for (const [kind, config] of Object.entries(KINDS)) {
    const columns = [...GOVERNANCE_COLUMNS, ...(EXTRA_COLUMNS[kind] || [])];
    for (const [name, definition] of columns) {
      await query(`ALTER TABLE ${config.table} ADD COLUMN IF NOT EXISTS ${name} ${definition};`);
    }
    await query(
      `CREATE INDEX IF NOT EXISTS idx_${config.table}_visibility
       ON ${config.table} (approval_status, level, school_code);`,
    );
  }

  bootstrapped = true;
};

/* ─── Value coercion ─── */

const toText = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value, fallback = false) => {
  if (value === true || value === false) return value;
  if (value === null || value === undefined || value === "") return fallback;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return fallback;
};

const toDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const toTimestamp = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

/** Accepts an array, a JSON array string, or a comma/newline separated string. */
const toJsonArray = (value) => {
  if (Array.isArray(value)) {
    return JSON.stringify(value.map((item) => (typeof item === "string" ? item.trim() : item)).filter(Boolean));
  }
  if (value === null || value === undefined || value === "") return "[]";

  const text = String(value).trim();
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return JSON.stringify(parsed);
    } catch {
      // fall through to the split below
    }
  }
  return JSON.stringify(
    text
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
};

const coerce = (spec, value) => {
  switch (spec.type) {
    case "int":
      return toInt(value, spec.default ?? 0);
    case "bool":
      return toBool(value, spec.default ?? false);
    case "date":
      return toDate(value);
    case "timestamp":
      return toTimestamp(value);
    case "jsonArray":
      return toJsonArray(value);
    default:
      return toText(value) ?? (spec.default ?? null);
  }
};

/** Reads a field from the body, honouring its declared aliases. */
const readField = (body, name, spec) => {
  const keys = [name, spec.column, ...(spec.aliases || [])];
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== "") return body[key];
  }
  // Preserve an explicit false/0/empty-string when the caller sent the key.
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(body, key)) return body[key];
  }
  return undefined;
};

/**
 * Turns a request body into { columns, values } for the given kind.
 * `partial` skips fields the caller did not send (used by PUT).
 */
const buildColumnValues = (kind, body, { partial = false } = {}) => {
  const config = KINDS[kind];
  const columns = [];
  const values = [];
  const missing = [];

  for (const [name, spec] of Object.entries(config.fields)) {
    const raw = readField(body, name, spec);

    if (raw === undefined) {
      if (partial) continue;
      if (spec.required) {
        missing.push({ field: name, message: `${name} is required` });
        continue;
      }
      columns.push(spec.column);
      values.push(coerce(spec, spec.default ?? null));
      continue;
    }

    const coerced = coerce(spec, raw);
    if (spec.required && (coerced === null || coerced === "")) {
      missing.push({ field: name, message: `${name} is required` });
      continue;
    }

    columns.push(spec.column);
    values.push(coerced);
  }

  return { columns, values, missing };
};

/** Maps a DB row back to the camelCase shape the dashboards and pages expect. */
const mapRow = (kind, row) => {
  if (!row) return null;
  const config = KINDS[kind];
  const item = { id: row.id };

  for (const [name, spec] of Object.entries(config.fields)) {
    let value = row[spec.column];
    if (spec.type === "date" || spec.type === "timestamp") {
      value = value ? new Date(value).toISOString() : "";
      if (spec.type === "date") value = value ? value.slice(0, 10) : "";
    } else if (spec.type === "jsonArray") {
      value = Array.isArray(value) ? value : [];
    } else if (spec.type === "int") {
      value = Number(value || 0);
    } else if (spec.type === "bool") {
      value = Boolean(value);
    } else {
      value = value === null || value === undefined ? "" : String(value);
    }
    item[name] = value;
  }

  item.kind = kind;
  item.schoolCode = row.school_code || "";
  item.level = row.level || LEVELS.COLLEGE;
  item.approvalStatus = row.approval_status || APPROVAL.PUBLISHED;
  item.createdBy = row.created_by ?? null;
  item.createdByName = row.created_by_name || "";
  item.reviewedByName = row.reviewed_by_name || "";
  item.reviewedAt = row.reviewed_at ? new Date(row.reviewed_at).toISOString() : "";
  item.reviewNote = row.review_note || "";
  item.createdAt = row.created_at ? new Date(row.created_at).toISOString() : "";
  item.updatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : "";
  item.schoolName = row.school_name || (item.schoolCode ? item.schoolCode : "GBU");
  return item;
};

const normalizeSchoolCode = (value) => String(value || "").trim().toUpperCase();

const isUniversityCode = (code) =>
  !code || normalizeSchoolCode(code) === UNIVERSITY_SCHOOL_CODE;

module.exports = {
  buildColumnValues,
  ensureAnnouncementsSchema,
  isUniversityCode,
  mapRow,
  normalizeSchoolCode,
  toJsonArray,
};
