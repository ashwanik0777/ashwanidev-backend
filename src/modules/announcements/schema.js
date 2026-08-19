/*
 * Announcement kinds share one governance model.
 *
 * Previously the admin/school portals wrote announcements into the
 * `schools.content` JSONB blob while the public pages read the real tables, so
 * anything added from a dashboard never reached the website. Every kind now
 * lives in its own table with a common set of ownership + approval columns:
 *
 *   school_code      owning school ("" / "GBU" means university-wide)
 *   level            'college' (whole university) | 'school' (one school only)
 *   approval_status  'published' | 'pending' | 'rejected'
 *
 * A school account may publish its own school-level items directly, but a
 * college-level submission is held as 'pending' until a super admin approves it.
 * Public endpoints only ever return 'published' rows.
 */

const LEVELS = { COLLEGE: "college", SCHOOL: "school" };
const APPROVAL = { PUBLISHED: "published", PENDING: "pending", REJECTED: "rejected" };

const UNIVERSITY_SCHOOL_CODE = "GBU";

/**
 * Per-kind description: the table it lives in, and how API fields map onto
 * columns. `type` drives coercion so a form value never breaks the insert.
 */
const KINDS = {
  notices: {
    table: "notices",
    label: "Notice",
    dateColumn: "published_date",
    fields: {
      title: { column: "title", type: "text", required: true },
      content: { column: "content", type: "text" },
      date: { column: "published_date", type: "date", aliases: ["publishedDate"] },
      type: { column: "type", type: "text", default: "General" },
      priority: { column: "priority", type: "text", default: "medium" },
      views: { column: "views", type: "int", default: 0 },
      isNew: { column: "is_new", type: "bool", default: true },
      pdfUrl: { column: "pdf_url", type: "text" },
    },
  },

  news: {
    table: "news",
    label: "News",
    dateColumn: "published_date",
    fields: {
      title: { column: "title", type: "text", required: true },
      excerpt: { column: "excerpt", type: "text" },
      content: { column: "content", type: "text" },
      date: { column: "published_date", type: "date", aliases: ["publishedDate"] },
      author: { column: "author", type: "text", default: "GBU" },
      department: { column: "department", type: "text" },
      category: { column: "category", type: "text", default: "General" },
      priority: { column: "priority", type: "text", default: "medium" },
      views: { column: "views", type: "int", default: 0 },
      likes: { column: "likes", type: "int", default: 0 },
      featured: { column: "is_featured", type: "bool", default: false, aliases: ["isFeatured"] },
      status: { column: "status", type: "text", default: "published" },
      image: { column: "image_url", type: "text", aliases: ["imageUrl", "coverImageUrl"] },
      imageLink: { column: "image_link", type: "text" },
      pdfUrl: { column: "pdf_url", type: "text" },
      link: { column: "external_link", type: "text" },
      tags: { column: "tags", type: "jsonArray" },
    },
  },

  events: {
    table: "events",
    label: "Event",
    dateColumn: "starts_at",
    fields: {
      title: { column: "title", type: "text", required: true },
      description: { column: "description", type: "text" },
      organizer: { column: "organizer", type: "text", default: "GBU" },
      venue: { column: "venue", type: "text" },
      location: { column: "location", type: "text" },
      type: { column: "type", type: "text", default: "General" },
      mode: { column: "mode", type: "text", default: "Offline" },
      status: { column: "status", type: "text", default: "upcoming" },
      price: { column: "price", type: "text", default: "Free" },
      attendees: { column: "attendees", type: "int", default: 0 },
      startsAt: { column: "starts_at", type: "timestamp", required: true, aliases: ["date"] },
      endsAt: { column: "ends_at", type: "timestamp", aliases: ["endDate"] },
      time: { column: "time_string", type: "text", aliases: ["timeString"] },
      year: { column: "year", type: "text" },
      coverImageUrl: { column: "cover_image", type: "text", aliases: ["coverImage", "image"] },
      imageLink: { column: "image_link", type: "text" },
      registrationUrl: { column: "registration_url", type: "text" },
      brochureUrl: { column: "brochure_url", type: "text", aliases: ["brochure"] },
      flyerUrl: { column: "flyer_url", type: "text", aliases: ["flyer"] },
      tags: { column: "tags", type: "jsonArray" },
      images: { column: "gallery", type: "jsonArray", aliases: ["gallery"] },
      agenda: { column: "agenda", type: "jsonArray" },
      speakers: { column: "speakers", type: "jsonArray" },
    },
  },

  newsletters: {
    table: "newsletters",
    label: "Newsletter",
    dateColumn: "published_date",
    fields: {
      title: { column: "title", type: "text", required: true },
      issueNumber: { column: "issue_number", type: "text", aliases: ["issueNo"] },
      date: { column: "published_date", type: "date", aliases: ["publishedDate"] },
      coverImage: { column: "cover_image_url", type: "text", aliases: ["coverImageUrl"] },
      excerpt: { column: "excerpt", type: "text" },
      pdfUrl: { column: "pdf_url", type: "text" },
      englishPdfLink: { column: "english_pdf_url", type: "text", aliases: ["pdfLink"] },
      hindiPdfLink: { column: "hindi_pdf_url", type: "text" },
      views: { column: "views", type: "int", default: 0 },
      category: { column: "category", type: "text", default: "School Update" },
    },
  },

  gallery: {
    table: "media_gallery",
    label: "Gallery album",
    dateColumn: "published_date",
    fields: {
      title: { column: "title", type: "text", required: true },
      category: { column: "category", type: "text", default: "Events" },
      year: { column: "year", type: "text" },
      date: { column: "published_date", type: "date", aliases: ["publishedDate"] },
      images: { column: "images", type: "jsonArray" },
    },
  },
};

/** Columns every kind carries for ownership, approval and auditing. */
const GOVERNANCE_COLUMNS = [
  ["school_code", "VARCHAR(50) NOT NULL DEFAULT ''"],
  ["level", `VARCHAR(20) NOT NULL DEFAULT '${LEVELS.COLLEGE}'`],
  ["approval_status", `VARCHAR(20) NOT NULL DEFAULT '${APPROVAL.PUBLISHED}'`],
  ["created_by", "INT"],
  ["created_by_name", "VARCHAR(160) NOT NULL DEFAULT ''"],
  ["reviewed_by", "INT"],
  ["reviewed_by_name", "VARCHAR(160) NOT NULL DEFAULT ''"],
  ["reviewed_at", "TIMESTAMP"],
  ["review_note", "TEXT"],
  ["created_at", "TIMESTAMP NOT NULL DEFAULT NOW()"],
  ["updated_at", "TIMESTAMP NOT NULL DEFAULT NOW()"],
];

/** Kind-specific columns added after the fact (older deployments lack these). */
const EXTRA_COLUMNS = {
  news: [
    ["image_link", "TEXT"],
    ["pdf_url", "TEXT"],
    ["external_link", "TEXT"],
  ],
  events: [
    ["location", "VARCHAR(255)"],
    ["image_link", "TEXT"],
    ["brochure_url", "TEXT"],
    ["flyer_url", "TEXT"],
  ],
  newsletters: [
    ["english_pdf_url", "TEXT"],
    ["hindi_pdf_url", "TEXT"],
  ],
};

module.exports = {
  APPROVAL,
  EXTRA_COLUMNS,
  GOVERNANCE_COLUMNS,
  KINDS,
  LEVELS,
  UNIVERSITY_SCHOOL_CODE,
};
