const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { query } = require("../../config/db");
const { successResponse, errorResponse } = require("../../utils/response");
const { authenticate, authorize } = require("../../middleware/auth");
const { ensureAuthBootstrap } = require("../auth/auth.service");
const ROLES = require("../../constants/roles");
const { sendMail } = require("../../utils/mailer");
const env = require("../../config/env");

const router = express.Router();

const normalize = (value) => String(value || "").trim();

const toSafeInt = (value, fallback) => {
	const parsed = Number.parseInt(String(value || ""), 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return parsed;
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

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

const ensureRegistrationSchema = async () => {
	if (schemaReady) return;

	await ensureAuthBootstrap();

	await query(`
		CREATE TABLE IF NOT EXISTS registration_otps (
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
		CREATE TABLE IF NOT EXISTS faculty_registration_requests (
			id SERIAL PRIMARY KEY,
			name VARCHAR(180) NOT NULL,
			category VARCHAR(100) NOT NULL,
			school_code VARCHAR(50) NOT NULL,
			school_name VARCHAR(255) NOT NULL,
			department VARCHAR(180) NOT NULL,
			designation VARCHAR(180) NOT NULL,
			email VARCHAR(255) NOT NULL,
			mobile VARCHAR(15) NOT NULL,
			status VARCHAR(30) DEFAULT 'pending',
			reviewed_by INT,
			reviewed_at TIMESTAMP,
			rejection_reason TEXT,
			created_at TIMESTAMP DEFAULT NOW(),
			updated_at TIMESTAMP DEFAULT NOW()
		);
	`);

	await query(`CREATE INDEX IF NOT EXISTS idx_registration_otps_email ON registration_otps((LOWER(email)));`);
	await query(`CREATE INDEX IF NOT EXISTS idx_faculty_reg_requests_email ON faculty_registration_requests((LOWER(email)));`);
	await query(`CREATE INDEX IF NOT EXISTS idx_faculty_reg_requests_school_code ON faculty_registration_requests((LOWER(school_code)));`);
	await query(`CREATE INDEX IF NOT EXISTS idx_faculty_reg_requests_status ON faculty_registration_requests(status);`);

	schemaReady = true;
};

/* ═══════════════════════════════════════════════════════════════
   PUBLIC ENDPOINTS (no auth required)
   ═══════════════════════════════════════════════════════════════ */

// POST /faculty-registration/send-otp
router.post("/faculty-registration/send-otp", async (req, res) => {
	try {
		await ensureRegistrationSchema();

		const email = normalize(req.body?.email).toLowerCase();
		if (!email || !EMAIL_RE.test(email)) {
			return errorResponse(res, "Validation failed", [{ field: "email", message: "A valid email address is required" }], 400);
		}

		const otpCode = generateOtpCode();
		const expiresAt = new Date(Date.now() + env.otpExpiresMinutes * 60 * 1000);

		// Invalidate any existing unconsumed OTPs for the same email
		await query(
			`UPDATE registration_otps SET consumed_at = NOW() WHERE LOWER(email) = $1 AND consumed_at IS NULL AND expires_at > NOW()`,
			[email]
		);

		// Store new OTP
		await query(
			`INSERT INTO registration_otps (email, otp_hash, expires_at) VALUES ($1, $2, $3)`,
			[email, hashOtp(otpCode), expiresAt]
		);

		// Send OTP via email
		const subject = "GBU Faculty Registration - Email Verification OTP";
		const html = `
			<p>Dear Applicant,</p>
			<p>Your OTP for email verification is:</p>
			<h2 style="letter-spacing: 4px;">${otpCode}</h2>
			<p>This OTP is valid for ${env.otpExpiresMinutes} minutes.</p>
			<p>If you did not request this, please ignore this email.</p>
		`;
		await sendMail({ to: email, subject, text: `Your OTP is ${otpCode}`, html });

		return successResponse(res, "OTP sent successfully. Please check your email.");
	} catch (error) {
		console.error("[FacultyRegistration] send-otp error:", error.message);
		return errorResponse(res, "Failed to send OTP", [{ field: "email", message: error.message }], 500);
	}
});

// POST /faculty-registration/verify-otp
router.post("/faculty-registration/verify-otp", async (req, res) => {
	try {
		await ensureRegistrationSchema();

		const email = normalize(req.body?.email).toLowerCase();
		const otp = normalize(req.body?.otp);

		if (!email || !EMAIL_RE.test(email)) {
			return errorResponse(res, "Validation failed", [{ field: "email", message: "A valid email address is required" }], 400);
		}
		if (!otp) {
			return errorResponse(res, "Validation failed", [{ field: "otp", message: "OTP is required" }], 400);
		}

		// Find latest unconsumed, unexpired OTP for this email
		const otpResult = await query(
			`SELECT id, otp_hash, attempts FROM registration_otps
			 WHERE LOWER(email) = $1 AND consumed_at IS NULL AND expires_at > NOW()
			 ORDER BY created_at DESC LIMIT 1`,
			[email]
		);

		const activeOtp = otpResult.rows[0];
		if (!activeOtp) {
			return errorResponse(res, "OTP expired or not found. Please request a new OTP.", [], 400);
		}

		// Check max attempts
		if (Number(activeOtp.attempts || 0) >= env.otpMaxAttempts) {
			await query(`UPDATE registration_otps SET consumed_at = NOW() WHERE id = $1`, [activeOtp.id]);
			return errorResponse(res, "Too many failed attempts. Please request a new OTP.", [], 400);
		}

		// Verify OTP hash
		if (hashOtp(otp) !== activeOtp.otp_hash) {
			const nextAttempts = Number(activeOtp.attempts || 0) + 1;
			await query(
				`UPDATE registration_otps SET attempts = $2, consumed_at = CASE WHEN $2 >= $3 THEN NOW() ELSE consumed_at END WHERE id = $1`,
				[activeOtp.id, nextAttempts, env.otpMaxAttempts]
			);
			return errorResponse(res, "Invalid OTP", [{ field: "otp", message: "The OTP you entered is incorrect" }], 400);
		}

		// Consume the OTP
		await query(`UPDATE registration_otps SET consumed_at = NOW() WHERE id = $1`, [activeOtp.id]);

		// Sign a short-lived verification token
		const verificationToken = jwt.sign(
			{ email, type: "registration-verify" },
			env.jwtAccessSecret,
			{ expiresIn: "15m" }
		);

		return successResponse(res, "Email verified successfully", { emailVerificationToken: verificationToken });
	} catch (error) {
		console.error("[FacultyRegistration] verify-otp error:", error.message);
		return errorResponse(res, "Failed to verify OTP", [{ field: "otp", message: error.message }], 500);
	}
});

// POST /faculty-registration/register
router.post("/faculty-registration/register", async (req, res) => {
	try {
		await ensureRegistrationSchema();

		const b = req.body || {};
		const name = normalize(b.name);
		const category = normalize(b.category);
		const schoolCode = normalize(b.schoolCode);
		const department = normalize(b.department);
		const designation = normalize(b.designation);
		const email = normalize(b.email).toLowerCase();
		const mobile = normalize(b.mobile);
		const emailVerificationToken = normalize(b.emailVerificationToken);

		// Validate all fields are present
		const missing = [];
		if (!name) missing.push({ field: "name", message: "Name is required" });
		if (!category) missing.push({ field: "category", message: "Category is required" });
		if (!schoolCode) missing.push({ field: "schoolCode", message: "School code is required" });
		if (!department) missing.push({ field: "department", message: "Department is required" });
		if (!designation) missing.push({ field: "designation", message: "Designation is required" });
		if (!email) missing.push({ field: "email", message: "Email is required" });
		if (!mobile) missing.push({ field: "mobile", message: "Mobile number is required" });
		if (!emailVerificationToken) missing.push({ field: "emailVerificationToken", message: "Email verification token is required" });
		if (missing.length) return errorResponse(res, "Validation failed", missing, 400);

		// Validate email format
		if (!EMAIL_RE.test(email)) {
			return errorResponse(res, "Validation failed", [{ field: "email", message: "Invalid email format" }], 400);
		}

		// Validate mobile format
		if (!MOBILE_RE.test(mobile)) {
			return errorResponse(res, "Validation failed", [{ field: "mobile", message: "Mobile must be exactly 10 digits" }], 400);
		}

		// Verify the email verification token
		let tokenPayload;
		try {
			tokenPayload = jwt.verify(emailVerificationToken, env.jwtAccessSecret);
		} catch (_err) {
			return errorResponse(res, "Email verification token is invalid or expired. Please verify your email again.", [], 400);
		}

		if (tokenPayload.type !== "registration-verify") {
			return errorResponse(res, "Invalid verification token type", [], 400);
		}
		if (tokenPayload.email !== email) {
			return errorResponse(res, "Email mismatch. The verification token was issued for a different email.", [], 400);
		}

		// Check for duplicate pending/approved requests
		const duplicateResult = await query(
			`SELECT id, status FROM faculty_registration_requests
			 WHERE LOWER(email) = $1 AND status IN ('pending', 'approved')
			 LIMIT 1`,
			[email]
		);
		if (duplicateResult.rows.length) {
			const existingStatus = duplicateResult.rows[0].status;
			return errorResponse(res, `A registration request with this email is already ${existingStatus}`, [{ field: "email", message: `Request already ${existingStatus}` }], 409);
		}

		// Look up school name from schools table
		const schoolResult = await query(
			`SELECT name FROM schools WHERE UPPER(code) = UPPER($1) LIMIT 1`,
			[schoolCode]
		);
		const schoolName = schoolResult.rows[0]?.name || schoolCode;

		// Insert registration request
		const insertResult = await query(
			`INSERT INTO faculty_registration_requests
			 (name, category, school_code, school_name, department, designation, email, mobile, status)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
			 RETURNING id, name, category, school_code, school_name, department, designation, email, mobile, status, created_at`,
			[name, category, schoolCode.toUpperCase(), schoolName, department, designation, email, mobile]
		);

		return successResponse(res, "Registration request submitted successfully", insertResult.rows[0], 201);
	} catch (error) {
		console.error("[FacultyRegistration] register error:", error.message);
		return errorResponse(res, "Failed to submit registration request", [{ field: "registration", message: error.message }], 500);
	}
});

/* ═══════════════════════════════════════════════════════════════
   ADMIN ENDPOINTS (super_admin + school auth)
   ═══════════════════════════════════════════════════════════════ */

const adminAuth = [authenticate, authorize(ROLES.SUPER_ADMIN, ROLES.SCHOOL)];

// GET /admin/faculty-registration-requests
router.get("/admin/faculty-registration-requests", adminAuth, async (req, res) => {
	try {
		await ensureRegistrationSchema();

		const status = normalize(req.query?.status).toLowerCase();
		const search = normalize(req.query?.query).toLowerCase();
		const page = toSafeInt(req.query?.page, 1);
		const limit = clamp(toSafeInt(req.query?.limit, 20), 1, 100);
		const offset = (page - 1) * limit;

		const clauses = ["1 = 1"];
		const params = [];

		// School users: filter by their linked school
		if (req.user?.role === ROLES.SCHOOL) {
			const userSchoolCode = normalize(req.user?.schoolCode).toLowerCase();
			params.push(userSchoolCode);
			clauses.push(`LOWER(school_code) = $${params.length}`);
		}

		// Status filter
		if (status && status !== "all") {
			params.push(status);
			clauses.push(`status = $${params.length}`);
		}

		// Search filter
		if (search) {
			params.push(`%${search}%`);
			const idx = params.length;
			clauses.push(`(LOWER(name) LIKE $${idx} OR LOWER(email) LIKE $${idx} OR LOWER(department) LIKE $${idx} OR LOWER(mobile) LIKE $${idx} OR LOWER(school_name) LIKE $${idx})`);
		}

		const whereClause = clauses.join(" AND ");
		const countResult = await query(`SELECT COUNT(*)::INT AS total FROM faculty_registration_requests WHERE ${whereClause}`, params);
		const total = Number(countResult.rows[0]?.total || 0);
		const totalPages = Math.max(1, Math.ceil(total / limit));

		const resultParams = [...params, limit, offset];
		const result = await query(
			`SELECT id, name, category, school_code, school_name, department, designation, email, mobile, status, reviewed_by, reviewed_at, rejection_reason, created_at, updated_at
			 FROM faculty_registration_requests WHERE ${whereClause}
			 ORDER BY created_at DESC, id DESC
			 LIMIT $${resultParams.length - 1} OFFSET $${resultParams.length}`,
			resultParams
		);

		return successResponse(res, "Registration requests fetched successfully", {
			items: result.rows,
			pagination: { page, limit, total, totalPages },
		});
	} catch (error) {
		console.error("[FacultyRegistration] list requests error:", error.message);
		return errorResponse(res, "Failed to fetch registration requests", [{ field: "registration", message: error.message }], 500);
	}
});

// POST /admin/faculty-registration-requests/:id/approve
router.post("/admin/faculty-registration-requests/:id/approve", adminAuth, async (req, res) => {
	try {
		await ensureRegistrationSchema();

		const id = toSafeInt(req.params?.id, 0);
		if (!id) return errorResponse(res, "Valid request ID is required", [], 400);

		// Find the request
		const reqResult = await query(
			`SELECT * FROM faculty_registration_requests WHERE id = $1 LIMIT 1`,
			[id]
		);
		if (!reqResult.rows.length) return errorResponse(res, "Registration request not found", [], 404);

		const regReq = reqResult.rows[0];

		if (regReq.status !== "pending") {
			return errorResponse(res, `Request has already been ${regReq.status}`, [{ field: "status", message: `Cannot approve a ${regReq.status} request` }], 400);
		}

		// School users: verify the request belongs to their school
		if (req.user?.role === ROLES.SCHOOL) {
			const userSchoolCode = normalize(req.user?.schoolCode).toLowerCase();
			if (userSchoolCode && normalize(regReq.school_code).toLowerCase() !== userSchoolCode) {
				return errorResponse(res, "Forbidden", [{ field: "school", message: "You do not have permission for this request" }], 403);
			}
		}

		// Update status to approved
		await query(
			`UPDATE faculty_registration_requests SET status = 'approved', reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW() WHERE id = $1`,
			[id, Number(req.user?.sub) || null]
		);

		// Create faculty profile
		const facultyId = `faculty-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
		await query(
			`INSERT INTO faculty_profiles (id, name, designation, department, school, school_code, email, phone, is_active, created_by, updated_by)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, $9, $9)`,
			[
				facultyId,
				regReq.name,
				regReq.designation,
				regReq.department,
				regReq.school_code,
				regReq.school_code,
				regReq.email.toLowerCase(),
				regReq.mobile,
				Number(req.user?.sub) || null,
			]
		);

		// Create user account
		const firstName = regReq.name.split(" ")[0];
		const currentYear = new Date().getFullYear();
		const plainPassword = `${firstName}${currentYear}`;
		const passwordHash = await bcrypt.hash(plainPassword, 10);
		const username = regReq.email.split("@")[0] || facultyId;

		// Check if username already exists
		const existingUsername = await query(
			`SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
			[username]
		);
		const finalUsername = existingUsername.rows.length
			? `${username}${Date.now().toString().slice(-4)}`
			: username;

		await query(
			`INSERT INTO users (username, email, name, role, password_hash, linked_faculty_id, linked_school_code, force_password_reset)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
			[finalUsername, regReq.email.toLowerCase(), regReq.name, ROLES.FACULTY, passwordHash, facultyId, regReq.school_code]
		);

		// Send credentials email
		const loginUrl = env.appBaseUrl ? `${env.appBaseUrl}/login` : "https://gbu.ac.in/login";
		const credentialHtml = `
			<p>Dear ${regReq.name},</p>
			<p>Your faculty registration request has been <strong>approved</strong>. Your login credentials are as follows:</p>
			<table style="border-collapse: collapse; margin: 16px 0;">
				<tr><td style="padding: 4px 12px; font-weight: bold;">Login ID:</td><td style="padding: 4px 12px;">${regReq.email}</td></tr>
				<tr><td style="padding: 4px 12px; font-weight: bold;">Temporary Password:</td><td style="padding: 4px 12px;">${plainPassword}</td></tr>
			</table>
			<p>Please login at <a href="${loginUrl}">${loginUrl}</a> and change your password immediately.</p>
			<p>Regards,<br/>GBU Faculty Portal</p>
		`;
		try {
			await sendMail({
				to: regReq.email,
				subject: "GBU Faculty Portal - Your Login Credentials",
				text: `Dear ${regReq.name}, Your registration has been approved. Login ID: ${regReq.email}, Temporary Password: ${plainPassword}. Please login at ${loginUrl} and change your password.`,
				html: credentialHtml,
			});
		} catch (mailErr) {
			console.error("[FacultyRegistration] Failed to send credentials email:", mailErr.message);
		}

		return successResponse(res, "Registration request approved and faculty account created", {
			facultyId,
			name: regReq.name,
			email: regReq.email,
			username: finalUsername,
			schoolCode: regReq.school_code,
			department: regReq.department,
			designation: regReq.designation,
		}, 201);
	} catch (error) {
		if (error.code === "23505") {
			const field = String(error.constraint || "").includes("email") ? "email" : "id";
			return errorResponse(res, "Duplicate entry", [{ field, message: `${field} already exists. The faculty account may already exist.` }], 409);
		}
		console.error("[FacultyRegistration] approve error:", error.message);
		return errorResponse(res, "Failed to approve registration request", [{ field: "registration", message: error.message }], 500);
	}
});

// POST /admin/faculty-registration-requests/:id/reject
router.post("/admin/faculty-registration-requests/:id/reject", adminAuth, async (req, res) => {
	try {
		await ensureRegistrationSchema();

		const id = toSafeInt(req.params?.id, 0);
		if (!id) return errorResponse(res, "Valid request ID is required", [], 400);

		// Find the request
		const reqResult = await query(
			`SELECT * FROM faculty_registration_requests WHERE id = $1 LIMIT 1`,
			[id]
		);
		if (!reqResult.rows.length) return errorResponse(res, "Registration request not found", [], 404);

		const regReq = reqResult.rows[0];

		if (regReq.status !== "pending") {
			return errorResponse(res, `Request has already been ${regReq.status}`, [{ field: "status", message: `Cannot reject a ${regReq.status} request` }], 400);
		}

		// School users: verify the request belongs to their school
		if (req.user?.role === ROLES.SCHOOL) {
			const userSchoolCode = normalize(req.user?.schoolCode).toLowerCase();
			if (userSchoolCode && normalize(regReq.school_code).toLowerCase() !== userSchoolCode) {
				return errorResponse(res, "Forbidden", [{ field: "school", message: "You do not have permission for this request" }], 403);
			}
		}

		const reason = normalize(req.body?.reason);

		// Update status to rejected
		await query(
			`UPDATE faculty_registration_requests SET status = 'rejected', reviewed_by = $2, reviewed_at = NOW(), rejection_reason = $3, updated_at = NOW() WHERE id = $1`,
			[id, Number(req.user?.sub) || null, reason || null]
		);

		// Send rejection email
		try {
			const rejectionHtml = `
				<p>Dear ${regReq.name},</p>
				<p>We regret to inform you that your faculty registration request has been <strong>rejected</strong>.</p>
				${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ""}
				<p>If you believe this is an error, please contact the administration.</p>
				<p>Regards,<br/>GBU Faculty Portal</p>
			`;
			await sendMail({
				to: regReq.email,
				subject: "GBU Faculty Portal - Registration Request Update",
				text: `Dear ${regReq.name}, Your faculty registration request has been rejected.${reason ? ` Reason: ${reason}` : ""} Please contact administration if you have questions.`,
				html: rejectionHtml,
			});
		} catch (mailErr) {
			console.error("[FacultyRegistration] Failed to send rejection email:", mailErr.message);
		}

		return successResponse(res, "Registration request rejected", { id, status: "rejected", rejectionReason: reason || null });
	} catch (error) {
		console.error("[FacultyRegistration] reject error:", error.message);
		return errorResponse(res, "Failed to reject registration request", [{ field: "registration", message: error.message }], 500);
	}
});

module.exports = router;
