const express = require("express");
const { query, getDbPool } = require("../../config/db");
const { successResponse, errorResponse } = require("../../utils/response");
const { getPagination } = require("../../utils/pagination");
const { authenticate, authorize } = require("../../middleware/auth");
const ROLES = require("../../constants/roles");
const { ensureAnnouncementsSchema } = require("../announcements/store");

const router = express.Router();

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 50;

const ANNOUNCEMENT_SORT_FIELDS = {
  date: "published_date",
  title: "title",
  category: "type",
  priority: "priority",
  views: "views",
};

const NEWS_SORT_FIELDS = {
  date: "published_date",
  title: "title",
  category: "category",
  priority: "priority",
  views: "views",
  likes: "likes",
};

const NEWSLETTER_SORT_FIELDS = {
  date: "published_date",
  title: "title",
  issueNumber: "issue_number",
  category: "category",
  views: "views",
};

const MEDIA_GALLERY_SORT_FIELDS = {
  date: "published_date",
  title: "title",
  category: "category",
  year: "year",
};

const EVENTS_SORT_FIELDS = {
  date: "e.date",
  title: "e.title",
  category: "e.type",
  attendees: "e.attendees",
  year: "e.year",
};

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
};

const normalizeOrder = (order) => {
  return String(order || "DESC").toUpperCase() === "ASC" ? "ASC" : "DESC";
};

const buildSortClause = ({ sortBy, order, sortFields, fallbackSortBy }) => {
  const selectedColumn = sortFields[sortBy] || sortFields[fallbackSortBy];
  const selectedOrder = normalizeOrder(order);
  if (!selectedColumn) {
    return "id DESC";
  }
  return `${selectedColumn} ${selectedOrder}, id DESC`;
};

/*
 * Public visibility rules, shared by every announcement endpoint.
 *
 * - Only 'published' rows are ever returned (pending/rejected stay internal).
 * - With ?schoolCode=SOICT: that school's own items plus university-wide ones.
 * - Without schoolCode: ALL published items (every school + university-wide).
 *
 * The frontend's global /announcements/* pages call without schoolCode and
 * should display everything. School-specific pages pass their schoolCode to
 * see their own items plus college-level ones.
 */
const buildVisibilityClause = (schoolCode, startIndex = 1) => {
  const params = [];
  let clause = `t.approval_status = 'published'`;

  if (schoolCode) {
    params.push(String(schoolCode).trim().toUpperCase());
    clause += ` AND (UPPER(t.school_code) = $${startIndex} OR t.level = 'college')`;
  }
  // Without schoolCode: no extra filter — return all published items.

  return { clause, params };
};

const publicSelect = (table, columns, schoolCode, orderBy) => {
  const { clause, params } = buildVisibilityClause(schoolCode);
  return {
    text: `
      SELECT ${columns}, t.school_code, t.level, s.name AS school_name
      FROM ${table} t
      LEFT JOIN schools s ON UPPER(s.code) = UPPER(t.school_code)
      WHERE ${clause}
      ORDER BY ${orderBy}
    `,
    params,
  };
};

const withSchoolMeta = (mapped, row) => ({
  ...mapped,
  schoolCode: row.school_code || null,
  schoolName: row.school_name || (row.school_code ? row.school_code : "GBU"),
  level: row.level || "college",
});

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

  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, "0");
  const day = String(parsedDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const parseTimeString = (value) => {
  if (!value) {
    return null;
  }
  const normalized = String(value).trim();
  const isValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(normalized);
  return isValid ? normalized : null;
};

const normalizeTags = (rawTags) => {
  if (rawTags === undefined || rawTags === null || rawTags === "") {
    return [];
  }
  const sourceItems = Array.isArray(rawTags)
    ? rawTags
    : String(rawTags)
        .split(",")
        .map((item) => item.trim());
  return [
    ...new Set(sourceItems.map((item) => item.toLowerCase()).filter(Boolean)),
  ];
};

const parseTagString = (tagText) => {
  if (!tagText) {
    return [];
  }

  if (Array.isArray(tagText)) {
    return tagText
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean);
  }

  if (typeof tagText === "string") {
    const normalized = tagText.trim();
    if (!normalized) {
      return [];
    }

    if (normalized.startsWith("[") && normalized.endsWith("]")) {
      try {
        const parsed = JSON.parse(normalized);
        if (Array.isArray(parsed)) {
          return parsed
            .map((item) => String(item).trim().toLowerCase())
            .filter(Boolean);
        }
      } catch (error) {
        // Fallback to comma split below.
      }
    }

    return normalized
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  return [];
};

const normalizeJsonArray = (rawValue) => {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return [];
  }

  if (Array.isArray(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        return [];
      }
    }

    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
};

const formatTimestampForApi = (value) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 19);
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(normalized)) {
    const asIso = normalized.replace(" ", "T");
    return asIso.length === 16 ? `${asIso}:00` : asIso;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 19);
};

const parseTimestampInput = (value) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 19).replace("T", " ");
};

const parseEventId = (value) => {
  if (!/^\d+$/.test(String(value || ""))) {
    return null;
  }
  return Number.parseInt(value, 10);
};

const buildEventStartIso = (eventDate, eventTime) => {
  if (!eventDate) {
    return null;
  }

  const normalizedDate =
    toDateOnlyString(eventDate) ||
    (/^\d{4}-\d{2}-\d{2}$/.test(String(eventDate || ""))
      ? String(eventDate)
      : null);

  if (!normalizedDate) {
    return null;
  }

  const safeTime = parseTimeString(eventTime) || "00:00";
  return `${normalizedDate}T${safeTime}:00`;
};

const writeAuditLog = async (
  client,
  { actorUserId, action, resourceType, resourceId, requestId, metadata },
) => {
  try {
    await client.query(
      `
      INSERT INTO audit_logs (
        actor_user_id,
        action,
        resource_type,
        resource_id,
        request_id,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      `,
      [
        actorUserId || null,
        action,
        resourceType,
        resourceId || null,
        requestId || null,
        metadata ? JSON.stringify(metadata) : null,
      ],
    );
  } catch (error) {
    if (error.code === "42P01") {
      return;
    }
    throw error;
  }
};

const appendCommonClauses = ({
  whereClauses,
  params,
  search,
  category,
  dateFrom,
  dateTo,
  tags,
  searchColumns,
  categoryColumn,
  dateColumn,
  tagsFilter,
}) => {
  if (search) {
    const placeholder = `$${params.length + 1}`;
    params.push(`%${search}%`);
    whereClauses.push(
      `(${searchColumns
        .map((column) => `COALESCE(${column}, '') ILIKE ${placeholder}`)
        .join(" OR ")})`,
    );
  }

  if (category) {
    const placeholder = `$${params.length + 1}`;
    params.push(category.toLowerCase());
    whereClauses.push(`LOWER(${categoryColumn}) = ${placeholder}`);
  }

  if (dateFrom) {
    const placeholder = `$${params.length + 1}`;
    params.push(dateFrom);
    whereClauses.push(`${dateColumn} >= ${placeholder}::date`);
  }

  if (dateTo) {
    const placeholder = `$${params.length + 1}`;
    params.push(dateTo);
    whereClauses.push(`${dateColumn} <= ${placeholder}::date`);
  }

  if (tags.length && tagsFilter) {
    const placeholder = `$${params.length + 1}`;
    params.push(tags);
    whereClauses.push(tagsFilter(placeholder));
  }
};
const isNoticeNew = (publishedDate) => {
  if (!publishedDate) return false;
  const pubDate = new Date(publishedDate);
  const diffTime = Math.abs(new Date() - pubDate);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays <= 7;
};

/**
 * Notices carry both the API's `publishedAt`/`category` names and the plain
 * `publishedDate`/`date`/`type` names the website's normalizer reads. Emitting
 * only the former is what made the Notices page render "Invalid Date": the
 * frontend looked for `publishedDate`, found nothing, and fed `new Date("")`
 * to the formatter.
 */
const mapAnnouncement = (row) => {
  const pubDate = toDateOnlyString(row.published_date);
  const isNew = row.is_new !== undefined && row.is_new !== null ? row.is_new : isNoticeNew(row.published_date);
  return {
    id: row.id,
    title: row.title,
    slug: `notice-${row.id}`,
    summary: row.content,
    content: row.content,
    category: row.type,
    type: row.type,
    date: pubDate,
    publishedDate: pubDate,
    tags: [
      String(row.type || "").toLowerCase(),
      String(row.priority || "").toLowerCase(),
    ].filter(Boolean),
    coverImageUrl: row.pdf_url,
    publishedAt: pubDate,
    createdAt: null,
    updatedAt: null,
    priority: row.priority,
    views: row.views,
    isNew: isNew,
    pdfUrl: row.pdf_url,
    schoolCode: row.schoolCode || null,
    schoolName: row.schoolName || "GBU",
    level: row.level || "college",
  };
};

const mapNewsItem = (row) => ({
  id: row.id,
  title: row.title,
  slug: `news-${row.id}`,
  summary: row.excerpt,
  excerpt: row.excerpt,
  content: row.content,
  category: row.category,
  tags: parseTagString(row.tags),
  sourceUrl: null,
  coverImageUrl: row.image_url,
  image: row.image_url,
  date: toDateOnlyString(row.published_date),
  publishedDate: toDateOnlyString(row.published_date),
  publishedAt: toDateOnlyString(row.published_date),
  createdAt: null,
  updatedAt: null,
  author: row.author,
  department: row.department,
  priority: row.priority,
  views: row.views,
  likes: row.likes,
  featured: row.is_featured,
  status: row.status,
  schoolCode: row.schoolCode || null,
  schoolName: row.schoolName || "GBU",
  level: row.level || "college",
});

const mapEvent = (row) => {
  const startsAt =
    formatTimestampForApi(row.starts_at) ||
    buildEventStartIso(row.date, row.time);
  const endsAt = formatTimestampForApi(row.ends_at);
  const venue = row.venue || row.location || null;
  const coverImageUrl = row.cover_image || row.image || null;
  const tags = parseTagString(row.tags);
  const timeString = row.time_string || row.time || null;

  return {
    id: row.id,
    title: row.title,
    slug: `event-${row.id}`,
    summary: row.description,
    description: row.description,
    category: row.type,
    venue,
    organizer: row.organizer,
    startsAt,
    endsAt,
    coverImageUrl,
    registrationUrl: row.registration_url || null,
    brochureUrl: row.brochure_url || null,
    flyerUrl: row.flyer_url || null,
    isFeatured: false,
    isPublished: String(row.status || "").toLowerCase() !== "draft",
    publishedAt: startsAt,
    tags,
    createdAt: null,
    updatedAt: null,
    attendees: row.attendees,
    status: row.status,
    price: row.price,
    year: row.year,
    date: startsAt ? startsAt.slice(0, 10) : null,
    time: timeString,
    location: venue,
    type: row.type,
    mode: row.mode || "Offline",
    gallery: normalizeJsonArray(row.gallery),
    agenda: normalizeJsonArray(row.agenda),
    speakers: normalizeJsonArray(row.speakers),
  };
};

const mapMediaGalleryItem = (row) => {
  const images = normalizeJsonArray(row.images);
  const pubDate = toDateOnlyString(row.published_date);

  return {
    id: row.id,
    title: row.title,
    category: row.category,
    year: row.year,
    date: pubDate,
    publishedDate: pubDate,
    publishedAt: pubDate,
    images,
    coverImage: images[0] || null,
    coverImageUrl: images[0] || null,
  };
};

const mapNewsletter = (row) => ({
  id: row.id,
  title: row.title,
  issueNumber: row.issue_number,
  date: toDateOnlyString(row.published_date),
  publishedDate: toDateOnlyString(row.published_date),
  coverImage: row.cover_image_url,
  coverImageUrl: row.cover_image_url,
  excerpt: row.excerpt,
  pdfLink: row.pdf_url,
  pdfUrl: row.pdf_url,
  views: row.views,
  category: row.category,
});

const parseListFilters = (req, res) => {
  const { search, category, dateFrom, dateTo, tags, sortBy, order } = req.query;
  const parsedDateFrom = dateFrom ? toDateOnlyString(dateFrom) : null;
  const parsedDateTo = dateTo ? toDateOnlyString(dateTo) : null;

  if (dateFrom && !parsedDateFrom) {
    errorResponse(
      res,
      "Validation failed",
      [{ field: "dateFrom", message: "dateFrom must be a valid date" }],
      400,
    );
    return null;
  }

  if (dateTo && !parsedDateTo) {
    errorResponse(
      res,
      "Validation failed",
      [{ field: "dateTo", message: "dateTo must be a valid date" }],
      400,
    );
    return null;
  }

  if (parsedDateFrom && parsedDateTo && parsedDateFrom > parsedDateTo) {
    errorResponse(
      res,
      "Validation failed",
      [{ field: "dateRange", message: "dateFrom cannot be after dateTo" }],
      400,
    );
    return null;
  }

  return {
    search: String(search || "").trim(),
    category: String(category || "").trim(),
    dateFrom: parsedDateFrom,
    dateTo: parsedDateTo,
    tags: normalizeTags(tags),
    sortBy: String(sortBy || "").trim(),
    order: String(order || "").trim(),
    page: toPositiveInt(req.query.page, 1),
    limit: Math.min(toPositiveInt(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT),
  };
};

const handleNoticesList = async (req, res) => {
  const isNoticesRoute = req.path === "/notices";
  const successMessage = isNoticesRoute
    ? "Notices fetched successfully"
    : "Announcements fetched successfully";
  const errorField = isNoticesRoute ? "notices" : "announcements";
  const errorMessage = isNoticesRoute
    ? "Failed to fetch notices"
    : "Failed to fetch announcements";

  const { schoolCode } = req.query;

  try {
    await ensureAnnouncementsSchema();
    const { text, params } = publicSelect(
      "notices",
      "t.id, t.title, t.content, t.published_date, t.type, t.priority, t.views, t.is_new, t.pdf_url",
      schoolCode,
      "t.published_date DESC NULLS LAST, t.id DESC",
    );

    const listResult = await query(text, params);
    const allNotices = listResult.rows.map((row) => withSchoolMeta(mapAnnouncement(row), row));

    return successResponse(res, successMessage, allNotices);
  } catch (error) {
    return errorResponse(
      res,
      errorMessage,
      [{ field: errorField, message: error.message }],
      500,
    );
  }
};

router.get("/announcements", handleNoticesList);
router.get("/notices", handleNoticesList);

router.get("/notices/:id", async (req, res) => {
  const id = parseEventId(req.params.id);

  if (!id) {
    return errorResponse(
      res,
      "Validation failed",
      [{ field: "id", message: "Notice id must be a valid integer" }],
      400,
    );
  }

  try {
    const noticeResult = await query(
      `
      SELECT id, title, content, published_date, type, priority, views, is_new, pdf_url
      FROM notices
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    );

    if (!noticeResult.rows.length) {
      return errorResponse(
        res,
        "Notice not found",
        [{ field: "id", message: "No notice found for this id" }],
        404,
      );
    }

    return successResponse(
      res,
      "Notice fetched successfully",
      mapAnnouncement(noticeResult.rows[0]),
    );
  } catch (error) {
    return errorResponse(
      res,
      "Failed to fetch notice",
      [{ field: "notice", message: error.message }],
      500,
    );
  }
});

router.get("/news", async (req, res) => {
  const { schoolCode } = req.query;
  try {
    await ensureAnnouncementsSchema();
    const { text, params } = publicSelect(
      "news",
      `t.id, t.title, t.excerpt, t.content, t.published_date, t.author, t.department,
       t.tags, t.category, t.priority, t.views, t.likes, t.image_url, t.is_featured,
       t.status, t.image_link, t.pdf_url, t.external_link`,
      schoolCode,
      "t.published_date DESC NULLS LAST, t.id DESC",
    );

    const listResult = await query(text, params);
    const allNews = listResult.rows.map((row) => ({
      ...withSchoolMeta(mapNewsItem(row), row),
      imageLink: row.image_link || "",
      pdfUrl: row.pdf_url || "",
      link: row.external_link || "",
    }));

    return successResponse(res, "News fetched successfully", allNews);
  } catch (error) {
    return errorResponse(
      res,
      "Failed to fetch news",
      [{ field: "news", message: error.message }],
      500,
    );
  }
});

router.get("/news/:id", async (req, res) => {
  const id = parseEventId(req.params.id);

  if (!id) {
    return errorResponse(
      res,
      "Validation failed",
      [{ field: "id", message: "News id must be a valid integer" }],
      400,
    );
  }

  try {
    const newsResult = await query(
      `
      SELECT
        id, title, excerpt, content, published_date, author, department,
        tags, category, priority, views, likes, image_url, is_featured, status
      FROM news
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    );

    if (!newsResult.rows.length) {
      return errorResponse(
        res,
        "News not found",
        [{ field: "id", message: "No news found for this id" }],
        404,
      );
    }

    return successResponse(
      res,
      "News fetched successfully",
      mapNewsItem(newsResult.rows[0]),
    );
  } catch (error) {
    return errorResponse(
      res,
      "Failed to fetch news",
      [{ field: "news", message: error.message }],
      500,
    );
  }
});

router.get("/media-gallery", async (req, res) => {
  const { schoolCode } = req.query;
  try {
    await ensureAnnouncementsSchema();
    const { text, params } = publicSelect(
      "media_gallery",
      "t.id, t.title, t.category, t.year, t.published_date, t.images",
      schoolCode,
      "t.published_date DESC NULLS LAST, t.id DESC",
    );

    const listResult = await query(text, params);

    return successResponse(
      res,
      "Media gallery fetched successfully",
      listResult.rows.map((row) => withSchoolMeta(mapMediaGalleryItem(row), row)),
    );
  } catch (error) {
    return errorResponse(
      res,
      "Failed to fetch media gallery",
      [{ field: "media_gallery", message: error.message }],
      500,
    );
  }
});

router.get("/events", async (req, res) => {
  const { schoolCode } = req.query;
  try {
    await ensureAnnouncementsSchema();
    const { text, params } = publicSelect(
      "events",
      `t.id, t.title, t.description, t.starts_at, t.ends_at, t.time_string, t.venue,
       t.location, t.organizer, t.type, t.mode, t.status, t.price, t.attendees,
       t.cover_image, t.image_link, t.registration_url, t.brochure_url, t.flyer_url,
       t.tags, t.gallery, t.year`,
      schoolCode,
      "t.starts_at DESC NULLS LAST, t.id DESC",
    );

    const listResult = await query(text, params);
    const allEvents = listResult.rows.map((row) => ({
      ...row,
      imageLink: row.image_link || "",
      brochureUrl: row.brochure_url || "",
      flyerUrl: row.flyer_url || "",
      schoolCode: row.school_code || null,
      schoolName: row.school_name || (row.school_code ? row.school_code : "GBU"),
      level: row.level || "college",
    }));

    return res.status(200).json({
      success: true,
      count: allEvents.length,
      data: allEvents,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server Error" });
  }
});

router.get("/events/:id", async (req, res) => {
  const id = parseEventId(req.params.id);

  if (!id) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid event id" });
  }

  try {
    const eventResult = await query(
      `
      SELECT *
      FROM events
      WHERE id = $1
      LIMIT 1
      `,
      [id],
    );

    if (!eventResult.rows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Event not found" });
    }

    return res.status(200).json({
      success: true,
      data: eventResult.rows[0],
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server Error" });
  }
});

router.get("/newsletters", async (req, res) => {
  const { schoolCode } = req.query;
  try {
    await ensureAnnouncementsSchema();
    const { text, params } = publicSelect(
      "newsletters",
      `t.id, t.title, t.issue_number, t.published_date, t.cover_image_url,
       t.excerpt, t.pdf_url, t.views, t.category`,
      schoolCode,
      "t.published_date DESC NULLS LAST, t.id DESC",
    );

    const listResult = await query(text, params);

    return successResponse(
      res,
      "Newsletters fetched successfully",
      listResult.rows.map((row) => withSchoolMeta(mapNewsletter(row), row)),
    );
  } catch (error) {
    return errorResponse(
      res,
      "Failed to fetch newsletters",
      [{ field: "newsletters", message: error.message }],
      500,
    );
  }
});

router.post(
  "/events",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    const {
      title,
      description,
      organizer,
      venue,
      location,
      type,
      category,
      mode,
      status,
      price,
      attendees = 0,
      startsAt,
      starts_at,
      endsAt,
      ends_at,
      date,
      time,
      timeString,
      time_string,
      year,
      coverImageUrl,
      cover_image,
      image,
      registrationUrl,
      registration_url,
      tags,
      gallery,
      agenda,
      speakers,
    } = req.body;

    if (!title) {
      return errorResponse(
        res,
        "Validation failed",
        [{ field: "title", message: "title is required" }],
        400,
      );
    }

    const startsAtInput = startsAt || starts_at;
    const endsAtInput = endsAt || ends_at;

    const parsedDate = toDateOnlyString(date);
    const parsedTime = parseTimeString(time) || "00:00";
    const normalizedStartsAt =
      parseTimestampInput(startsAtInput) ||
      (parsedDate ? `${parsedDate} ${parsedTime}:00` : null);

    if (!normalizedStartsAt) {
      return errorResponse(
        res,
        "Validation failed",
        [{ field: "startsAt", message: "startsAt or date is required" }],
        400,
      );
    }

    const normalizedEndsAt = parseTimestampInput(endsAtInput);
    const normalizedVenue = String(venue || location || "").trim() || null;
    const normalizedType = String(type || category || "General").trim();
    const normalizedMode = String(mode || "Offline").trim();
    const normalizedStatus = String(status || "upcoming").trim();
    const normalizedPrice = String(price || "Free").trim();

    const parsedAttendees = Number.parseInt(attendees, 10);
    const safeAttendees = Number.isNaN(parsedAttendees) ? 0 : parsedAttendees;

    const normalizedTimeString = String(
      timeString ||
        time_string ||
        parseTimeString(time) ||
        normalizedStartsAt.slice(11, 16),
    ).trim();
    const normalizedYear = String(
      year || normalizedStartsAt.slice(0, 4),
    ).trim();
    const normalizedCoverImage = cover_image || coverImageUrl || image || null;
    const normalizedRegistrationUrl =
      registration_url || registrationUrl || null;

    const normalizedTags = normalizeTags(tags);
    const normalizedGallery = normalizeJsonArray(gallery);
    const normalizedAgenda = normalizeJsonArray(agenda);
    const normalizedSpeakers = normalizeJsonArray(speakers);

    const client = await getDbPool().connect();

    try {
      await client.query("BEGIN");

      const insertResult = await client.query(
        `
        INSERT INTO events (
          title,
          description,
          organizer,
          venue,
          type,
          mode,
          status,
          price,
          attendees,
          starts_at,
          ends_at,
          time_string,
          year,
          cover_image,
          registration_url,
          tags,
          gallery,
          agenda,
          speakers
        ) VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10::timestamp,
          $11::timestamp,
          $12,
          $13,
          $14,
          $15,
          $16::jsonb,
          $17::jsonb,
          $18::jsonb,
          $19::jsonb
        )
        RETURNING *
        `,
        [
          String(title).trim(),
          description || null,
          organizer || null,
          normalizedVenue,
          normalizedType,
          normalizedMode,
          normalizedStatus,
          normalizedPrice,
          safeAttendees,
          normalizedStartsAt,
          normalizedEndsAt,
          normalizedTimeString,
          normalizedYear,
          normalizedCoverImage,
          normalizedRegistrationUrl,
          JSON.stringify(normalizedTags),
          JSON.stringify(normalizedGallery),
          JSON.stringify(normalizedAgenda),
          JSON.stringify(normalizedSpeakers),
        ],
      );

      const createdEvent = insertResult.rows[0];

      await writeAuditLog(client, {
        actorUserId: req?.user?.sub,
        action: "event.create",
        resourceType: "events",
        resourceId: null,
        requestId: req.requestId,
        metadata: { eventId: createdEvent.id, title: String(title).trim() },
      });

      await client.query("COMMIT");

      return successResponse(
        res,
        "Event created successfully",
        mapEvent(createdEvent),
        201,
      );
    } catch (error) {
      await client.query("ROLLBACK");
      return errorResponse(
        res,
        "Failed to create event",
        [{ field: "event", message: error.message }],
        500,
      );
    } finally {
      client.release();
    }
  },
);

router.post(
  "/newsletters",
  authenticate,
  authorize(ROLES.SUPER_ADMIN),
  async (req, res) => {
    const {
      title,
      issueNo,
      issueNumber,
      issueDate,
      publishedDate,
      summary,
      contentHtml,
      pdfUrl,
      coverImageUrl,
      views = 0,
      category = "General",
      isPublished = true,
    } = req.body;

    const resolvedIssueDate = issueDate || publishedDate;

    if (!title || !resolvedIssueDate) {
      return errorResponse(
        res,
        "Validation failed",
        [
          { field: "title", message: "title is required" },
          { field: "issueDate", message: "issueDate is required" },
        ],
        400,
      );
    }

    const parsedIssueDate = toDateOnlyString(resolvedIssueDate);
    if (!parsedIssueDate) {
      return errorResponse(
        res,
        "Validation failed",
        [{ field: "issueDate", message: "issueDate must be a valid date" }],
        400,
      );
    }

    const client = await getDbPool().connect();

    try {
      await client.query("BEGIN");
      const normalizedIssueNumber = String(issueNumber || issueNo || "").trim();
      const normalizedViews = Number.isNaN(Number.parseInt(views, 10))
        ? 0
        : Number.parseInt(views, 10);
      const normalizedExcerpt = summary || contentHtml || String(title).trim();

      const insertResult = await client.query(
        `
        INSERT INTO newsletters (
          title,
          issue_number,
          published_date,
          cover_image_url,
          excerpt,
          pdf_url,
          views,
          category
        ) VALUES (
          $1, $2, $3::date, $4, $5, $6, $7, $8
        )
        RETURNING id
        `,
        [
          String(title).trim(),
          normalizedIssueNumber || null,
          parsedIssueDate,
          coverImageUrl || null,
          normalizedExcerpt,
          pdfUrl || null,
          normalizedViews,
          String(category || "General").trim() || "General",
        ],
      );

      const createdNewsletterId = Number(insertResult.rows[0].id);

      await writeAuditLog(client, {
        actorUserId: req?.user?.sub,
        action: "newsletter.create",
        resourceType: "newsletters",
        resourceId: null,
        requestId: req.requestId,
        metadata: {
          newsletterId: createdNewsletterId,
          title: String(title).trim(),
          issueNumber: normalizedIssueNumber || null,
          isPublished: Boolean(isPublished),
        },
      });

      await client.query("COMMIT");

      return successResponse(
        res,
        "Newsletter created successfully",
        {
          id: createdNewsletterId,
          title: String(title).trim(),
          issueNumber: normalizedIssueNumber || null,
          issueDate: parsedIssueDate,
          publishedDate: parsedIssueDate,
          summary: normalizedExcerpt,
          contentHtml: contentHtml || null,
          pdfUrl: pdfUrl || null,
          coverImageUrl: coverImageUrl || null,
          views: normalizedViews,
          category: String(category || "General").trim() || "General",
          isPublished: Boolean(isPublished),
        },
        201,
      );
    } catch (error) {
      await client.query("ROLLBACK");
      return errorResponse(
        res,
        "Failed to create newsletter",
        [{ field: "newsletter", message: error.message }],
        500,
      );
    } finally {
      client.release();
    }
  },
);

module.exports = router;
