const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { query } = require("../../config/db");
const { successResponse, errorResponse } = require("../../utils/response");
const { authenticate, authorize } = require("../../middleware/auth");
const ROLES = require("../../constants/roles");
const { sendMail } = require("../../utils/mailer");
const { buildOtpEmail, buildBookingNotificationEmail, buildBookingStatusEmail } = require("../../utils/mailTemplate");
const env = require("../../config/env");

const router = express.Router();

const normalize = (value) => String(value || "").trim();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^[0-9]{10}$/;

/* ─── OTP helpers (same pattern as auth.service.js) ─── */

const hashOtp = (otpCode) => {
  return crypto
    .createHash("sha256")
    .update(`${String(otpCode)}:${env.otpPepper}`)
    .digest("hex");
};

const generateOtpCode = () => {
  const otp = crypto.randomInt(0, 1000000);
  return String(otp).padStart(6, "0");
};

/* ─── Schema bootstrap ─── */

let schemaReady = false;

const ensureBookingSchema = async () => {
  if (schemaReady) return;

  await query(`
    CREATE TABLE IF NOT EXISTS booking_requests (
      id SERIAL PRIMARY KEY,
      token VARCHAR(50) UNIQUE NOT NULL,
      facility_id VARCHAR(50) NOT NULL,
      facility_name VARCHAR(180) NOT NULL,
      user_name VARCHAR(180) NOT NULL,
      user_email VARCHAR(255) NOT NULL,
      user_phone_primary VARCHAR(20) NOT NULL,
      user_phone_secondary VARCHAR(20) NOT NULL,
      organization VARCHAR(255),
      purpose TEXT NOT NULL,
      start_time TIMESTAMP NOT NULL,
      end_time TIMESTAMP NOT NULL,
      status VARCHAR(30) DEFAULT 'pending',
      remarks TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS booking_otps (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) NOT NULL,
      otp_hash VARCHAR(128) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      attempts INT DEFAULT 0,
      consumed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS facility_incharges (
      facility_id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(180) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_booking_requests_token ON booking_requests(token);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_booking_requests_status ON booking_requests(status);`);
  await query(`CREATE INDEX IF NOT EXISTS idx_booking_otps_email ON booking_otps((LOWER(email)));`);

  // Seed default values matching facilities.js
  await query(`
    INSERT INTO facility_incharges (facility_id, name, email, phone) VALUES
    ('aud-01', 'Dr. Rajesh Kumar', 'facilities@gbu.ac.in', '+91-9876543210'),
    ('aud-02', 'Dr. Priya Singh', 'facilities@gbu.ac.in', '+91-9876543211'),
    ('aud-03', 'Prof. Amit Sharma', 'facilities@gbu.ac.in', '+91-9876543212'),
    ('aud-04', 'Dr. Sunita Yadav', 'facilities@gbu.ac.in', '+91-9876543213'),
    ('aud-05', 'Prof. Ravi Kumar', 'facilities@gbu.ac.in', '+91-9876543214'),
    ('conference-hall', 'Mr. Vikash Gupta', 'conference@gbu.ac.in', '+91-9876543215'),
    ('convention-dining', 'Chef Manoj Verma', 'catering@gbu.ac.in', '+91-9876543216'),
    ('guesthouse-a', 'Mr. Sunil Kumar', 'guesthouse@gbu.ac.in', '+91-9876543217'),
    ('guesthouse-b', 'Mr. Sunil Kumar', 'guesthouse@gbu.ac.in', '+91-9876543217'),
    ('convention-rooms', 'Dr. Kavita Sharma', 'convention@gbu.ac.in', '+91-9876543218'),
    ('cricket-ground', 'Coach Suresh Patel', 'sports@gbu.ac.in', '+91-9876543211'),
    ('football-ground', 'Coach Rajesh Singh', 'sports@gbu.ac.in', '+91-9876543212'),
    ('basketball-court', 'Coach Amit Sharma', 'sports@gbu.ac.in', '+91-9876543213')
    ON CONFLICT (facility_id) DO NOTHING;
  `);

  schemaReady = true;
};

/* ═══════════════════════════════════════════════════════════════
   PUBLIC ENDPOINTS
   ═══════════════════════════════════════════════════════════════ */

// POST /send-otp
router.post("/send-otp", async (req, res) => {
  try {
    await ensureBookingSchema();

    const email = normalize(req.body.email);

    if (!email || !EMAIL_RE.test(email)) {
      return errorResponse(res, "Invalid email format", [{ field: "email", message: "A valid email is required" }], 400);
    }

    // Invalidate existing unconsumed OTPs
    await query(
      `UPDATE booking_otps SET consumed_at = NOW() WHERE email = $1 AND consumed_at IS NULL`,
      [email]
    );

    const otpCode = generateOtpCode();
    const otpHashValue = hashOtp(otpCode);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await query(
      `INSERT INTO booking_otps (email, otp_hash, expires_at) VALUES ($1, $2, $3)`,
      [email, otpHashValue, expiresAt]
    );

    const htmlContent = buildOtpEmail(email, otpCode, 10, "Facility Booking Request Verification", "Booking Portal");

    await sendMail({
      to: email,
      subject: "GBU Booking Portal - Email Verification OTP",
      text: `Your verification OTP is ${otpCode}. Valid for 10 minutes.`,
      html: htmlContent,
    });

    return successResponse(res, "OTP sent successfully to your email");
  } catch (error) {
    return errorResponse(res, "Failed to send OTP", [{ field: "otp", message: error.message }], 500);
  }
});

// POST /verify-otp
router.post("/verify-otp", async (req, res) => {
  try {
    await ensureBookingSchema();

    const email = normalize(req.body.email);
    const otp = normalize(req.body.otp);

    if (!email || !otp) {
      return errorResponse(res, "Email and OTP are required", [], 400);
    }

    const otpResult = await query(
      `SELECT * FROM booking_otps WHERE email = $1 AND consumed_at IS NULL ORDER BY id DESC LIMIT 1`,
      [email]
    );

    if (otpResult.rows.length === 0) {
      return errorResponse(res, "OTP request not found or already verified", [], 400);
    }

    const otpRecord = otpResult.rows[0];

    if (new Date() > new Date(otpRecord.expires_at)) {
      return errorResponse(res, "OTP has expired. Please request a new one.", [], 400);
    }

    if (otpRecord.attempts >= 5) {
      return errorResponse(res, "Maximum OTP verification attempts exceeded.", [], 400);
    }

    const submittedHash = hashOtp(otp);
    if (otpRecord.otp_hash !== submittedHash) {
      await query(
        `UPDATE booking_otps SET attempts = attempts + 1 WHERE id = $1`,
        [otpRecord.id]
      );
      return errorResponse(res, "Invalid OTP code", [], 400);
    }

    // Mark as consumed
    await query(
      `UPDATE booking_otps SET consumed_at = NOW() WHERE id = $1`,
      [otpRecord.id]
    );

    // Sign a temporary verification token
    const token = jwt.sign(
      { email, type: "booking-verify" },
      env.jwtAccessSecret,
      { expiresIn: "15m" }
    );

    return successResponse(res, "OTP verified successfully", { verificationToken: token });
  } catch (error) {
    return errorResponse(res, "Failed to verify OTP", [{ field: "otp", message: error.message }], 500);
  }
});

// POST / (Submit booking request)
router.post("/", async (req, res) => {
  try {
    await ensureBookingSchema();

    const {
      userName,
      userEmail,
      userPhonePrimary,
      userPhoneSecondary,
      organization,
      purpose,
      startTime,
      endTime,
      facilityId,
      facilityName,
      emailVerificationToken,
    } = req.body;

    // Validate inputs
    if (!userName || !userEmail || !userPhonePrimary || !purpose || !startTime || !endTime || !facilityId || !facilityName || !emailVerificationToken) {
      return errorResponse(res, "All fields are required to complete the booking", [], 400);
    }

    if (!EMAIL_RE.test(normalize(userEmail))) {
      return errorResponse(res, "Invalid email format", [], 400);
    }

    if (!MOBILE_RE.test(normalize(userPhonePrimary))) {
      return errorResponse(res, "Primary mobile number must be exactly 10 digits", [], 400);
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(emailVerificationToken, env.jwtAccessSecret);
    } catch (e) {
      return errorResponse(res, "Email verification token expired or invalid", [], 400);
    }

    if (decoded.type !== "booking-verify" || normalize(decoded.email) !== normalize(userEmail)) {
      return errorResponse(res, "Email verification token mismatch", [], 400);
    }

    // Generate unique tracking token: GBUBK-YYYYMMDD-[rand]
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const randomHex = crypto.randomBytes(3).toString("hex").toUpperCase();
    const token = `GBUBK-${dateStr}-${randomHex}`;

    const result = await query(
      `
      INSERT INTO booking_requests (
        token, facility_id, facility_name, user_name, user_email,
        user_phone_primary, user_phone_secondary, organization, purpose,
        start_time, end_time
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
      `,
      [
        token,
        normalize(facilityId),
        normalize(facilityName),
        normalize(userName),
        normalize(userEmail),
        normalize(userPhonePrimary),
        normalize(userPhoneSecondary),
        normalize(organization),
        normalize(purpose),
        startTime,
        endTime,
      ]
    );

    const booking = result.rows[0];

    // Fetch In-Charge Details
    const managerResult = await query(
      `SELECT * FROM facility_incharges WHERE facility_id = $1`,
      [normalize(facilityId)]
    );

    const manager = managerResult.rows[0] || {
      name: "Facility Manager",
      email: "facilities@gbu.ac.in",
      phone: "+91-9876543210"
    };

    // Send emails (In-Charge & User)
    const emailToManager = buildBookingNotificationEmail(manager.name, booking);
    const emailToUser = buildBookingStatusEmail(userName, booking, "pending");

    await sendMail({
      to: manager.email,
      subject: `New GBU Facility Booking - ${token}`,
      text: `A new booking request has been submitted for ${facilityName}. Review token ${token}.`,
      html: emailToManager
    }).catch(err => console.error("Failed to email manager:", err.message));

    await sendMail({
      to: userEmail,
      subject: `GBU Facility Booking Received - ${token}`,
      text: `Your booking request for ${facilityName} has been received. Token: ${token}`,
      html: emailToUser
    }).catch(err => console.error("Failed to email user:", err.message));

    return successResponse(res, "Booking request submitted successfully", { token });
  } catch (error) {
    return errorResponse(res, "Failed to submit booking", [{ field: "booking", message: error.message }], 500);
  }
});

// GET /dates (Fetch occupied/pending dates)
router.get("/dates", async (req, res) => {
  try {
    await ensureBookingSchema();
    const facilityId = normalize(req.query.facilityId);

    if (!facilityId) {
      return errorResponse(res, "facilityId is required", [], 400);
    }

    const dates = await query(
      `
      SELECT start_time AS "startTime", end_time AS "endTime", status
      FROM booking_requests
      WHERE facility_id = $1 AND status IN ('pending', 'approved')
      `,
      [facilityId]
    );

    return successResponse(res, "Occupied dates retrieved", dates.rows);
  } catch (error) {
    return errorResponse(res, "Failed to retrieve booking dates", [], 500);
  }
});

// GET /track
router.get("/track", async (req, res) => {
  try {
    await ensureBookingSchema();
    const token = normalize(req.query.token);

    if (!token) {
      return errorResponse(res, "Tracking token is required", [], 400);
    }

    const bookingResult = await query(
      `SELECT * FROM booking_requests WHERE token = $1`,
      [token]
    );

    if (bookingResult.rows.length === 0) {
      return errorResponse(res, "No booking request found with this token", [], 404);
    }

    return successResponse(res, "Booking status retrieved", bookingResult.rows[0]);
  } catch (error) {
    return errorResponse(res, "Failed to track booking status", [], 500);
  }
});

// GET /in-charge/:facilityId
router.get("/in-charge/:facilityId", async (req, res) => {
  try {
    await ensureBookingSchema();
    const { facilityId } = req.params;

    const result = await query(
      `SELECT name, email, phone FROM facility_incharges WHERE facility_id = $1`,
      [facilityId]
    );

    if (result.rows.length === 0) {
      return successResponse(res, "Facility in-charge retrieved", null);
    }

    return successResponse(res, "Facility in-charge retrieved", result.rows[0]);
  } catch (error) {
    return errorResponse(res, "Failed to retrieve in-charge info", [], 500);
  }
});

/* ─── ADMIN ENDPOINTS ─── */

// GET /admin/requests
router.get("/admin/requests", authenticate, authorize([ROLES.SUPER_ADMIN]), async (req, res) => {
  try {
    await ensureBookingSchema();

    const status = normalize(req.query.status);
    const facilityId = normalize(req.query.facilityId);
    const search = normalize(req.query.search);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 15));
    const offset = (page - 1) * limit;

    let filterQuery = `WHERE 1=1`;
    const params = [];

    if (status && status !== "all") {
      params.push(status);
      filterQuery += ` AND status = $${params.length}`;
    }

    if (facilityId && facilityId !== "all") {
      params.push(facilityId);
      filterQuery += ` AND facility_id = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      filterQuery += ` AND (token ILIKE $${params.length} OR user_name ILIKE $${params.length} OR user_email ILIKE $${params.length})`;
    }

    const countResult = await query(
      `SELECT COUNT(*) FROM booking_requests ${filterQuery}`,
      params
    );
    const totalItems = parseInt(countResult.rows[0].count);

    params.push(limit);
    const limitIndex = params.length;
    params.push(offset);
    const offsetIndex = params.length;

    const requests = await query(
      `
      SELECT * FROM booking_requests
      ${filterQuery}
      ORDER BY id DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
      `,
      params
    );

    return successResponse(res, "Admin booking requests retrieved", {
      requests: requests.rows,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalItems / limit),
        totalItems,
        limit,
      }
    });
  } catch (error) {
    return errorResponse(res, "Failed to retrieve booking requests for admin", [], 500);
  }
});

// POST /admin/requests/:id/approve
router.post("/admin/requests/:id/approve", authenticate, authorize([ROLES.SUPER_ADMIN]), async (req, res) => {
  try {
    await ensureBookingSchema();
    const { id } = req.params;

    const check = await query(`SELECT * FROM booking_requests WHERE id = $1`, [id]);
    if (check.rows.length === 0) {
      return errorResponse(res, "Booking request not found", [], 404);
    }

    const booking = check.rows[0];
    if (booking.status !== "pending") {
      return errorResponse(res, "Booking request is already reviewed", [], 400);
    }

    const result = await query(
      `UPDATE booking_requests SET status = 'approved', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );

    const updatedBooking = result.rows[0];

    // Email user
    const htmlEmail = buildBookingStatusEmail(updatedBooking.user_name, updatedBooking, "approved");
    await sendMail({
      to: updatedBooking.user_email,
      subject: `GBU Facility Booking Approved - ${updatedBooking.token}`,
      text: `Your booking request for ${updatedBooking.facility_name} is approved.`,
      html: htmlEmail
    }).catch(err => console.error("Email failed on approval:", err.message));

    return successResponse(res, "Booking request approved successfully", updatedBooking);
  } catch (error) {
    return errorResponse(res, "Failed to approve booking request", [], 500);
  }
});

// POST /admin/requests/:id/reject
router.post("/admin/requests/:id/reject", authenticate, authorize([ROLES.SUPER_ADMIN]), async (req, res) => {
  try {
    await ensureBookingSchema();
    const { id } = req.params;
    const remarks = normalize(req.body.remarks);

    const check = await query(`SELECT * FROM booking_requests WHERE id = $1`, [id]);
    if (check.rows.length === 0) {
      return errorResponse(res, "Booking request not found", [], 404);
    }

    const booking = check.rows[0];
    if (booking.status !== "pending") {
      return errorResponse(res, "Booking request is already reviewed", [], 400);
    }

    const result = await query(
      `UPDATE booking_requests SET status = 'rejected', remarks = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [remarks, id]
    );

    const updatedBooking = result.rows[0];

    // Email user
    const htmlEmail = buildBookingStatusEmail(updatedBooking.user_name, updatedBooking, "rejected", remarks);
    await sendMail({
      to: updatedBooking.user_email,
      subject: `GBU Facility Booking Rejected - ${updatedBooking.token}`,
      text: `Your booking request for ${updatedBooking.facility_name} has been rejected.`,
      html: htmlEmail
    }).catch(err => console.error("Email failed on rejection:", err.message));

    return successResponse(res, "Booking request rejected successfully", updatedBooking);
  } catch (error) {
    return errorResponse(res, "Failed to reject booking request", [], 500);
  }
});

// GET /admin/in-charges
router.get("/admin/in-charges", authenticate, authorize([ROLES.SUPER_ADMIN]), async (req, res) => {
  try {
    await ensureBookingSchema();
    const result = await query(`SELECT * FROM facility_incharges ORDER BY facility_id ASC`);
    return successResponse(res, "Facility in-charges list retrieved", result.rows);
  } catch (error) {
    return errorResponse(res, "Failed to retrieve facility in-charges", [], 500);
  }
});

// POST /admin/in-charges/:facilityId
router.post("/admin/in-charges/:facilityId", authenticate, authorize([ROLES.SUPER_ADMIN]), async (req, res) => {
  try {
    await ensureBookingSchema();
    const { facilityId } = req.params;
    const name = normalize(req.body.name);
    const email = normalize(req.body.email);
    const phone = normalize(req.body.phone);

    if (!name || !email || !phone) {
      return errorResponse(res, "All fields (name, email, phone) are required", [], 400);
    }

    if (!EMAIL_RE.test(email)) {
      return errorResponse(res, "Invalid email format", [], 400);
    }

    await query(
      `
      INSERT INTO facility_incharges (facility_id, name, email, phone, updated_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (facility_id) DO UPDATE
      SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone, updated_at = NOW()
      `,
      [facilityId, name, email, phone]
    );

    return successResponse(res, "Facility in-charge updated successfully");
  } catch (error) {
    return errorResponse(res, "Failed to update facility in-charge", [], 500);
  }
});

module.exports = router;
