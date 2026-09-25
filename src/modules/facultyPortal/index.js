/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  FACULTY PROFILE COMPLETION PORTAL — Backend Module             ║
 * ║                                                                  ║
 * ║  ⚠️  TEMPORARY MODULE — Remove after all faculty profiles are   ║
 * ║      collected. See removal guide in faculty_portal_plan.md.    ║
 * ║                                                                  ║
 * ║  Kill Switch: Set FACULTY_PORTAL_ENABLED=false in .env          ║
 * ║  Auto-Expiry: Set FACULTY_PORTAL_EXPIRES_AT=YYYY-MM-DD         ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const env = require("../../config/env");
const { query } = require("../../config/db");
const { successResponse, errorResponse } = require("../../utils/response");
const { sendMail } = require("../../utils/mailer");
const { buildOtpEmail } = require("../../utils/mailTemplate");
const { authenticate, authorize } = require("../../middleware/auth");
const ROLES = require("../../constants/roles");

const router = express.Router();

// ─────────────────────────────────────────────────────────────────
// PORTAL GUARD — Master kill switch + auto-expiry + access code
// Every portal endpoint MUST use this middleware FIRST.
// ─────────────────────────────────────────────────────────────────
const portalGuard = (req, res, next) => {
  // Kill switch
  if (!env.facultyPortalEnabled) {
    return errorResponse(res, "Faculty Profile Portal is currently disabled.", [], 503);
  }
  // Auto-expiry
  if (env.facultyPortalExpiresAt) {
    const expiryDate = new Date(env.facultyPortalExpiresAt);
    if (!isNaN(expiryDate.getTime()) && new Date() > expiryDate) {
      return errorResponse(res, "Faculty Profile Portal has expired. Contact admin.", [], 503);
    }
  }
  // Access code (if configured)
  if (env.facultyPortalAccessCode) {
    const code = req.headers["x-portal-access-code"] || "";
    if (code !== env.facultyPortalAccessCode) {
      return errorResponse(res, "Invalid portal access code.", [], 403);
    }
  }
  next();
};

// ─────────────────────────────────────────────────────────────────
// RATE LIMITERS
// ─────────────────────────────────────────────────────────────────
const searchLimiter = rateLimit({ windowMs: 60_000, max: 30, message: { success: false, message: "Too many search requests. Try again in a minute." } });
const otpSendLimiter = rateLimit({ windowMs: 60_000, max: 3, message: { success: false, message: "Too many OTP requests. Try again in a minute." } });
const otpVerifyLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { success: false, message: "Too many verify attempts. Try again in a minute." } });

// ─────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────
const hashOtp = (otp) => crypto.createHash("sha256").update(`${otp}:${env.otpPepper}`).digest("hex");
const generateOtp = () => String(crypto.randomInt(100000, 999999));

const maskEmail = (email) => {
  if (!email || !email.includes("@")) return "***@***.***";
  const [local, domain] = email.split("@");
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}${"*".repeat(Math.max(0, local.length - 3))}@${domain}`;
};

const signPortalAccessToken = (user) => {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      schoolCode: user.linked_school_code || "",
      portalSession: true,
    },
    env.jwtAccessSecret,
    { expiresIn: "1h" } // Portal sessions get 1 hour (longer than normal 15m for profile editing)
  );
};

const signPortalRefreshToken = (user) => {
  return jwt.sign(
    { sub: user.id, role: user.role, type: "refresh" },
    env.jwtRefreshSecret,
    { expiresIn: "7d" }
  );
};

const hashValue = (value) => crypto.createHash("sha256").update(value).digest("hex");

const getExpiresAtFromToken = (token) => {
  try {
    const decoded = jwt.decode(token);
    if (decoded?.exp) return new Date(decoded.exp * 1000);
  } catch (_) {}
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
};

// Audit logger
const auditLog = async (action, { facultyId = null, email = null, ip = null, userAgent = null, metadata = {} } = {}) => {
  try {
    await query(
      `INSERT INTO portal_audit_log (action, faculty_id, email, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [action, facultyId, email, ip, userAgent ? userAgent.slice(0, 500) : null, JSON.stringify(metadata)]
    );
  } catch (_) {
    // Audit logging should never break the main flow
  }
};

// ─────────────────────────────────────────────────────────────────
// BOOTSTRAP — Ensure required tables exist
// ─────────────────────────────────────────────────────────────────
const ensurePortalSchema = async () => {
  await query(`
    CREATE TABLE IF NOT EXISTS portal_audit_log (
      id SERIAL PRIMARY KEY,
      action VARCHAR(50) NOT NULL,
      faculty_id VARCHAR(120),
      email VARCHAR(255),
      ip_address VARCHAR(50),
      user_agent TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  // registration_otps table is already created by facultyRegistration module
};

// Run schema bootstrap on module load
ensurePortalSchema().catch(() => {});


// ═══════════════════════════════════════════════════════════════
//  ENDPOINT 1: Search Faculty by Name
//  GET /api/v1/faculty-portal/search?q=<name>
// ═══════════════════════════════════════════════════════════════
router.get(
  "/faculty-portal/search",
  portalGuard,
  searchLimiter,
  async (req, res) => {
    try {
      const q = String(req.query.q || "").trim();
      if (q.length < 2) {
        return successResponse(res, "Search results", []);
      }

      const result = await query(
        `SELECT id, name, designation, department, school, email
         FROM faculty_profiles
         WHERE is_active = true
           AND (LOWER(name) LIKE $1 OR LOWER(designation) LIKE $1)
         ORDER BY name
         LIMIT 15`,
        [`%${q.toLowerCase()}%`]
      );

      const masked = result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        designation: row.designation,
        department: row.department,
        school: row.school,
        maskedEmail: maskEmail(row.email),
        hasEmail: Boolean(row.email && row.email.includes("@")),
      }));

      await auditLog("search", { ip: req.ip, userAgent: req.headers["user-agent"], metadata: { query: q, resultsCount: masked.length } });

      return successResponse(res, "Search results", masked);
    } catch (err) {
      return errorResponse(res, "Search failed", [{ message: err.message }], 500);
    }
  }
);


// ═══════════════════════════════════════════════════════════════
//  ENDPOINT 2: Send OTP
//  POST /api/v1/faculty-portal/send-otp
//  Body: { facultyId: "SOICT-F0001" } or { email: "new@gbu.ac.in" }
// ═══════════════════════════════════════════════════════════════
router.post(
  "/faculty-portal/send-otp",
  portalGuard,
  otpSendLimiter,
  async (req, res) => {
    try {
      const { facultyId, email: rawEmail } = req.body;
      let targetEmail = "";
      let targetName = "Faculty Member";
      let resolvedFacultyId = null;

      if (facultyId) {
        // Existing faculty — look up their email
        const fResult = await query(
          `SELECT id, name, email FROM faculty_profiles WHERE id = $1 AND is_active = true`,
          [facultyId]
        );
        if (!fResult.rows.length) {
          return errorResponse(res, "Faculty member not found.", [], 404);
        }
        const faculty = fResult.rows[0];
        if (!faculty.email || !faculty.email.includes("@")) {
          return errorResponse(res, "No email address on file for this faculty member. Please contact admin.", [], 400);
        }
        targetEmail = faculty.email;
        targetName = faculty.name;
        resolvedFacultyId = faculty.id;
      } else if (rawEmail) {
        // New faculty — use their provided email
        targetEmail = String(rawEmail).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(targetEmail)) {
          return errorResponse(res, "Invalid email address.", [], 400);
        }
      } else {
        return errorResponse(res, "Either facultyId or email is required.", [], 400);
      }

      // Cooldown check — 1 OTP per email per 60 seconds
      const recentOtp = await query(
        `SELECT id FROM registration_otps
         WHERE email = $1 AND created_at > NOW() - INTERVAL '60 seconds'
         LIMIT 1`,
        [targetEmail]
      );
      if (recentOtp.rows.length) {
        return errorResponse(res, "OTP already sent. Please wait 60 seconds before requesting again.", [], 429);
      }

      // Invalidate old OTPs for this email
      await query(
        `UPDATE registration_otps SET consumed_at = NOW()
         WHERE email = $1 AND consumed_at IS NULL`,
        [targetEmail]
      );

      // Generate and store OTP
      const otp = generateOtp();
      const expiresAt = new Date(Date.now() + env.otpExpiresMinutes * 60 * 1000);

      await query(
        `INSERT INTO registration_otps (email, otp_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [targetEmail, hashOtp(otp), expiresAt]
      );

      // Send email
      const html = buildOtpEmail(
        targetName,
        otp,
        env.otpExpiresMinutes,
        "Faculty Profile Completion Portal verification",
        "Faculty Profile Portal"
      );

      await sendMail({
        to: targetEmail,
        subject: "GBU Faculty Portal — Verification OTP",
        html,
        text: `Your OTP is ${otp}. Valid for ${env.otpExpiresMinutes} minutes.`,
      });

      await auditLog("otp_sent", {
        facultyId: resolvedFacultyId,
        email: targetEmail,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      return successResponse(res, "OTP sent successfully.", {
        maskedEmail: maskEmail(targetEmail),
        expiresInMinutes: env.otpExpiresMinutes,
      });
    } catch (err) {
      return errorResponse(res, "Failed to send OTP", [{ message: err.message }], 500);
    }
  }
);


// ═══════════════════════════════════════════════════════════════
//  ENDPOINT 3: Verify OTP
//  POST /api/v1/faculty-portal/verify-otp
//  Body: { email, otp, facultyId? }
// ═══════════════════════════════════════════════════════════════
router.post(
  "/faculty-portal/verify-otp",
  portalGuard,
  otpVerifyLimiter,
  async (req, res) => {
    try {
      const { email: rawEmail, otp, facultyId } = req.body;
      let email = String(rawEmail || "").trim().toLowerCase();

      if (!otp) {
        return errorResponse(res, "OTP is required.", [], 400);
      }

      // If facultyId is provided and no real email, resolve email from DB
      if (facultyId && !email) {
        const fLookup = await query(
          `SELECT email FROM faculty_profiles WHERE id = $1 AND is_active = true`,
          [facultyId]
        );
        if (fLookup.rows.length && fLookup.rows[0].email) {
          email = fLookup.rows[0].email.toLowerCase();
        }
      }

      if (!email) {
        return errorResponse(res, "Email or Faculty ID is required.", [], 400);
      }

      // Look up active OTP
      const otpResult = await query(
        `SELECT id, otp_hash, attempts
         FROM registration_otps
         WHERE email = $1 AND consumed_at IS NULL AND expires_at > NOW()
         ORDER BY created_at DESC LIMIT 1`,
        [email]
      );

      if (!otpResult.rows.length) {
        return errorResponse(res, "OTP expired or not found. Please request a new one.", [], 400);
      }

      const activeOtp = otpResult.rows[0];

      // Check attempt count
      if (Number(activeOtp.attempts || 0) >= env.otpMaxAttempts) {
        await query(`UPDATE registration_otps SET consumed_at = NOW() WHERE id = $1`, [activeOtp.id]);
        return errorResponse(res, "Too many wrong attempts. OTP invalidated. Please request a new one.", [], 429);
      }

      // Verify hash
      if (hashOtp(String(otp)) !== activeOtp.otp_hash) {
        await query(
          `UPDATE registration_otps SET attempts = attempts + 1 WHERE id = $1`,
          [activeOtp.id]
        );
        const remaining = env.otpMaxAttempts - Number(activeOtp.attempts || 0) - 1;
        return errorResponse(res, `Invalid OTP. ${remaining} attempt(s) remaining.`, [], 400);
      }

      // OTP is valid — consume it
      await query(`UPDATE registration_otps SET consumed_at = NOW() WHERE id = $1`, [activeOtp.id]);

      // ── Case A: Existing faculty ──
      if (facultyId) {
        const fResult = await query(
          `SELECT id, name, email, school_code FROM faculty_profiles WHERE id = $1 AND is_active = true`,
          [facultyId]
        );
        if (!fResult.rows.length) {
          return errorResponse(res, "Faculty not found.", [], 404);
        }
        const faculty = fResult.rows[0];

        // Verify email matches
        if (faculty.email.toLowerCase() !== email) {
          return errorResponse(res, "Email does not match faculty records.", [], 403);
        }

        // Check if user account exists
        let userResult = await query(
          `SELECT id, name, email, role, linked_school_code, linked_faculty_id, password_hash, force_password_reset
           FROM users WHERE linked_faculty_id = $1`,
          [facultyId]
        );

        let user;
        let hasPassword = false;

        if (userResult.rows.length) {
          // User exists
          user = userResult.rows[0];
          hasPassword = Boolean(user.password_hash) && !user.force_password_reset;
        } else {
          // Create user account on-the-fly (no password yet)
          const username = faculty.email || `faculty-${faculty.id}`;
          const insertResult = await query(
            `INSERT INTO users (name, email, username, role, password_hash, is_active, linked_faculty_id, linked_school_code, force_password_reset)
             VALUES ($1, $2, $3, $4, $5, true, $6, $7, true)
             RETURNING id, name, email, role, linked_school_code, linked_faculty_id, force_password_reset`,
            [faculty.name, faculty.email, username, ROLES.FACULTY, "", faculty.id, faculty.school_code || ""]
          );
          user = insertResult.rows[0];
          hasPassword = false;
        }

        // Issue tokens
        const accessToken = signPortalAccessToken(user);
        const refreshToken = signPortalRefreshToken(user);

        // Store refresh token
        await query(
          `INSERT INTO auth_refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [user.id, hashValue(refreshToken), req.headers["user-agent"] || null, req.ip || null, getExpiresAtFromToken(refreshToken)]
        );

        await auditLog("otp_verified", {
          facultyId,
          email,
          ip: req.ip,
          userAgent: req.headers["user-agent"],
          metadata: { userId: user.id, hasPassword },
        });

        return successResponse(res, "OTP verified successfully.", {
          accessToken,
          refreshToken,
          hasPassword,
          facultyId: faculty.id,
          isNew: false,
          user: { id: user.id, name: user.name, email: user.email, role: user.role },
        });
      }

      // ── Case B: New faculty (no facultyId) — issue temporary email-verified token ──
      const emailToken = jwt.sign(
        { email, verified: true, purpose: "faculty-registration" },
        env.jwtAccessSecret,
        { expiresIn: "30m" }
      );

      await auditLog("otp_verified_new", {
        email,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });

      return successResponse(res, "Email verified successfully.", {
        emailVerificationToken: emailToken,
        isNew: true,
      });
    } catch (err) {
      return errorResponse(res, "OTP verification failed", [{ message: err.message }], 500);
    }
  }
);


// ═══════════════════════════════════════════════════════════════
//  ENDPOINT 4: Set Password
//  POST /api/v1/faculty-portal/set-password
//  Auth: Faculty JWT required
// ═══════════════════════════════════════════════════════════════
router.post(
  "/faculty-portal/set-password",
  portalGuard,
  authenticate,
  authorize(ROLES.FACULTY),
  async (req, res) => {
    try {
      const { password } = req.body;
      const userId = req.user.sub;

      if (!password) {
        return errorResponse(res, "Password is required.", [], 400);
      }

      // Validate password strength
      const value = String(password);
      if (value.length < 8) return errorResponse(res, "Password must be at least 8 characters.", [], 400);
      if (!/[A-Z]/.test(value)) return errorResponse(res, "Password must include at least one uppercase letter.", [], 400);
      if (!/[a-z]/.test(value)) return errorResponse(res, "Password must include at least one lowercase letter.", [], 400);
      if (!/[0-9]/.test(value)) return errorResponse(res, "Password must include at least one digit.", [], 400);
      if (!/[^A-Za-z0-9]/.test(value)) return errorResponse(res, "Password must include at least one special character.", [], 400);

      const passwordHash = await bcrypt.hash(value, 12);

      await query(
        `UPDATE users SET password_hash = $1, force_password_reset = false, updated_at = NOW() WHERE id = $2`,
        [passwordHash, userId]
      );

      await auditLog("password_set", {
        email: req.user.email,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        metadata: { userId },
      });

      return successResponse(res, "Password set successfully.");
    } catch (err) {
      return errorResponse(res, "Failed to set password", [{ message: err.message }], 500);
    }
  }
);


// ═══════════════════════════════════════════════════════════════
//  ENDPOINT 5: Register New Faculty
//  POST /api/v1/faculty-portal/register-new
//  Body: { name, designation, department, schoolCode, email, phone, verificationToken }
// ═══════════════════════════════════════════════════════════════
router.post(
  "/faculty-portal/register-new",
  portalGuard,
  async (req, res) => {
    try {
      const { name, designation, department, schoolCode, email, phone, verificationToken } = req.body;

      // Validate verification token
      if (!verificationToken) {
        return errorResponse(res, "Email verification token is required. Please verify your email first.", [], 400);
      }

      let decoded;
      try {
        decoded = jwt.verify(verificationToken, env.jwtAccessSecret);
      } catch (_) {
        return errorResponse(res, "Verification token is invalid or expired. Please re-verify your email.", [], 401);
      }

      if (!decoded.verified || decoded.purpose !== "faculty-registration") {
        return errorResponse(res, "Invalid verification token.", [], 401);
      }

      const verifiedEmail = decoded.email;

      // Validate required fields
      if (!name || !name.trim()) return errorResponse(res, "Name is required.", [], 400);
      if (!designation || !designation.trim()) return errorResponse(res, "Designation is required.", [], 400);
      if (!department || !department.trim()) return errorResponse(res, "Department is required.", [], 400);
      if (!schoolCode || !schoolCode.trim()) return errorResponse(res, "School is required.", [], 400);

      // Check for duplicate email in faculty_profiles
      const dupCheck = await query(
        `SELECT id FROM faculty_profiles WHERE LOWER(email) = $1`,
        [verifiedEmail.toLowerCase()]
      );
      if (dupCheck.rows.length) {
        return errorResponse(res, "A faculty profile with this email already exists. Please search for your name instead.", [], 409);
      }

      // Check for duplicate pending request
      const pendingCheck = await query(
        `SELECT id FROM faculty_registration_requests WHERE LOWER(email) = $1 AND status = 'pending'`,
        [verifiedEmail.toLowerCase()]
      );
      if (pendingCheck.rows.length) {
        return errorResponse(res, "A registration request with this email is already pending. Please wait for admin approval.", [], 409);
      }

      // Get school name from code
      const schoolResult = await query(`SELECT name FROM schools WHERE code = $1`, [schoolCode.toUpperCase()]);
      const schoolName = schoolResult.rows[0]?.name || schoolCode;

      // Create registration request
      const insertResult = await query(
        `INSERT INTO faculty_registration_requests (name, category, school_code, school_name, department, designation, email, mobile, status)
         VALUES ($1, 'faculty', $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING id`,
        [name.trim(), schoolCode.toUpperCase(), schoolName, department.trim(), designation.trim(), verifiedEmail, (phone || "").trim()]
      );

      await auditLog("registration_submitted", {
        email: verifiedEmail,
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        metadata: { requestId: insertResult.rows[0].id, name: name.trim(), schoolCode },
      });

      return successResponse(res, "Registration request submitted successfully. You will receive login credentials via email once approved by admin.", {
        requestId: insertResult.rows[0].id,
      }, 201);
    } catch (err) {
      return errorResponse(res, "Registration failed", [{ message: err.message }], 500);
    }
  }
);


// ═══════════════════════════════════════════════════════════════
//  ENDPOINT 6: Validate Access Code
//  POST /api/v1/faculty-portal/validate-code
// ═══════════════════════════════════════════════════════════════
router.post(
  "/faculty-portal/validate-code",
  (req, res) => {
    // If portal is disabled
    if (!env.facultyPortalEnabled) {
      return errorResponse(res, "Faculty Profile Portal is currently disabled.", [], 503);
    }
    // If no code is configured, always valid
    if (!env.facultyPortalAccessCode) {
      return successResponse(res, "No access code required.", { required: false });
    }

    const { code } = req.body;
    if (code === env.facultyPortalAccessCode) {
      return successResponse(res, "Access code valid.", { required: true, valid: true });
    }
    return errorResponse(res, "Invalid access code.", [], 403);
  }
);


module.exports = router;
