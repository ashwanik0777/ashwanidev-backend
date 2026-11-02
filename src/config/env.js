const dotenv = require("dotenv");

dotenv.config();

const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || "0.0.0.0",
  databaseUrl: process.env.DATABASE_URL || "",
  // School CMS content is saved as a single JSON document; 100kb (the express
  // default) is not enough once a school has a full announcements archive.
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || "10mb",
  // Limit for requests without a logged-in session (public forms, trackers).
  publicBodyLimit: process.env.PUBLIC_BODY_LIMIT || "100kb",
  dbSslEnabled: String(process.env.DB_SSL_ENABLED || "false") === "true",
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || "change-me-access-secret",
  jwtRefreshSecret:
    process.env.JWT_REFRESH_SECRET || "change-me-refresh-secret",
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "1d",
  otpExpiresMinutes: Number(process.env.OTP_EXPIRES_MINUTES) || 10,
  otpMaxAttempts: Number(process.env.OTP_MAX_ATTEMPTS) || 5,
  otpPepper: process.env.OTP_PEPPER || "change-me-otp-pepper",
  appBaseUrl: process.env.APP_BASE_URL || "",
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: Number(process.env.SMTP_PORT) || 587,
  smtpSecure: String(process.env.SMTP_SECURE || "false") === "true",
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || "no-reply@gbu.ac.in",
  corsOrigin: process.env.CORS_ORIGIN || process.env.APP_BASE_URL || "*",
  apiRateLimitWindowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  apiRateLimitMax:
    Number(process.env.API_RATE_LIMIT_MAX) ||
    (String(process.env.NODE_ENV || "development") === "production" ? 300 : 2000),
  authRateLimitWindowMs: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  authRateLimitMax: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
  
  // Cloudinary Config (legacy — kept for backward compatibility)
  cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
  cloudinaryApiKey: process.env.CLOUDINARY_API_KEY || "",
  cloudinaryApiSecret: process.env.CLOUDINARY_API_SECRET || "",

  // Local File Storage
  uploadStoragePath: process.env.UPLOAD_STORAGE_PATH || "./storage/uploads",
  uploadBaseUrl: process.env.UPLOAD_BASE_URL || "/uploads",
  uploadPublicUrl: process.env.UPLOAD_PUBLIC_URL || "",  // full public URL prefix e.g. http://localhost:3000/uploads
  uploadMaxImageSize: Number(process.env.UPLOAD_MAX_IMAGE_SIZE) || 10 * 1024 * 1024,
  uploadMaxFileSize: Number(process.env.UPLOAD_MAX_FILE_SIZE) || 20 * 1024 * 1024,
  uploadImageMaxWidth: Number(process.env.UPLOAD_IMAGE_MAX_WIDTH) || 2400,
  uploadImageMaxHeight: Number(process.env.UPLOAD_IMAGE_MAX_HEIGHT) || 2400,
  uploadImageQuality: Number(process.env.UPLOAD_IMAGE_QUALITY) || 82,
  uploadKeepOriginals: String(process.env.UPLOAD_KEEP_ORIGINALS || "false") === "true",
  // Files that must only be served through an authorised endpoint (grievance attachments).
  privateStoragePath: process.env.PRIVATE_STORAGE_PATH || "./storage/private",
  // How often the grievance SLA job checks for missed site visits and overdue work.
  grievanceSlaIntervalMs: Number(process.env.GRIEVANCE_SLA_INTERVAL_MS) || 10 * 60 * 1000,

  // Faculty Profile Completion Portal (temporary — remove after use)
  facultyPortalEnabled: String(process.env.FACULTY_PORTAL_ENABLED || "false") === "true",
  facultyPortalExpiresAt: process.env.FACULTY_PORTAL_EXPIRES_AT || "",
  facultyPortalAccessCode: process.env.FACULTY_PORTAL_ACCESS_CODE || "",
  facultyPortalUrl: process.env.FACULTY_PORTAL_URL || "http://localhost:5174",

  // Creates the built-in demo admin/school/student and grievance staff accounts
  // with their well-known passwords. Only for local development — never set
  // this on a server reachable from the internet.
  seedDemoUsers: String(process.env.SEED_DEMO_USERS || "false") === "true",
};

/*
 * Anyone who knows a signing secret can mint tokens for any role, and the
 * fallbacks above are public in this repo. Refuse to start without real values
 * in every environment rather than running silently on the defaults.
 */
const REQUIRED_SECRETS = [
  { name: "JWT_ACCESS_SECRET", value: env.jwtAccessSecret, minLength: 32 },
  { name: "JWT_REFRESH_SECRET", value: env.jwtRefreshSecret, minLength: 32 },
  { name: "OTP_PEPPER", value: env.otpPepper, minLength: 16 },
];

const secretProblems = REQUIRED_SECRETS.flatMap(({ name, value, minLength }) => {
  if (!process.env[name] || value.startsWith("change-me")) return [`${name} is not set`];
  if (value.length < minLength) return [`${name} must be at least ${minLength} characters`];
  return [];
});

if (env.jwtAccessSecret === env.jwtRefreshSecret) {
  secretProblems.push("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different");
}

if (secretProblems.length) {
  throw new Error(
    `Insecure configuration, refusing to start:\n  - ${secretProblems.join("\n  - ")}\n` +
      "Generate values with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"",
  );
}

module.exports = env;
