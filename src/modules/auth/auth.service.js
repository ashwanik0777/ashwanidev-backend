const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const env = require("../../config/env");
const ROLES = require("../../constants/roles");
const { query, getDbPool } = require("../../config/db");
const { sendMail } = require("../../utils/mailer");
const { buildOtpEmail } = require("../../utils/mailTemplate");

const portalRoleMap = {
  teacher: [ROLES.FACULTY],
  faculty: [ROLES.FACULTY],
  school: [ROLES.SCHOOL],
  admin: [ROLES.SUPER_ADMIN],
  super_admin: [ROLES.SUPER_ADMIN],
};

/* ─── All GBU Schools & Orgs ─── */
const SCHOOL_SEEDS = [
  { code: "SOICT", name: "School of Information & Communication Technology", slug: "soict" },
  { code: "SOBT",  name: "School of Biotechnology",                          slug: "sobt"  },
  { code: "SOBSC", name: "School of Buddhist Studies & Civilization",         slug: "sobsc" },
  { code: "SOE",   name: "School of Engineering",                            slug: "soe"   },
  { code: "SOL",   name: "School of Law, Justice & Governance",              slug: "sol"   },
  { code: "SOM",   name: "School of Management",                             slug: "som"   },
  { code: "SOHSS", name: "School of Humanities & Social Sciences",           slug: "sohss" },
  { code: "SOVS",  name: "School of Vocational Studies & Applied Sciences",  slug: "sovs"  },
  { code: "NSS",   name: "National Service Scheme (NSS)",                    slug: "nss"   },
  { code: "NCC",   name: "National Cadet Corps (NCC)",                       slug: "ncc"   },
  { code: "GBU",   name: "Gautam Buddha University Administration",          slug: "gbu"   },
];

const demoUsers = [
  {
    name: "Super Admin",
    email: "admin@gbu.ac.in",
    username: "admin",
    role: ROLES.SUPER_ADMIN,
    password: "Admin@123",
    forceReset: false,
  },
  // School accounts for each school
  { name: "SOICT Admin",  email: "soict@gbu.ac.in",  username: "soict",  role: ROLES.SCHOOL, password: "Soict@123",  linkedSchoolCode: "SOICT", forceReset: true },
  { name: "SOBT Admin",   email: "sobt@gbu.ac.in",   username: "sobt",   role: ROLES.SCHOOL, password: "Sobt@123",   linkedSchoolCode: "SOBT",  forceReset: true },
  { name: "SOBSC Admin",  email: "sobsc@gbu.ac.in",  username: "sobsc",  role: ROLES.SCHOOL, password: "Sobsc@123",  linkedSchoolCode: "SOBSC", forceReset: true },
  { name: "SOE Admin",    email: "soe@gbu.ac.in",    username: "soe",    role: ROLES.SCHOOL, password: "Soe@1234",   linkedSchoolCode: "SOE",   forceReset: true },
  { name: "SOL Admin",    email: "sol@gbu.ac.in",    username: "sol",    role: ROLES.SCHOOL, password: "Sol@1234",   linkedSchoolCode: "SOL",   forceReset: true },
  { name: "SOM Admin",    email: "som@gbu.ac.in",    username: "som",    role: ROLES.SCHOOL, password: "Som@1234",   linkedSchoolCode: "SOM",   forceReset: true },
  { name: "SOHSS Admin",  email: "sohss@gbu.ac.in",  username: "sohss",  role: ROLES.SCHOOL, password: "Sohss@123",  linkedSchoolCode: "SOHSS", forceReset: true },
  { name: "SOVS Admin",   email: "sovs@gbu.ac.in",   username: "sovs",   role: ROLES.SCHOOL, password: "Sovs@123",   linkedSchoolCode: "SOVS",  forceReset: true },
];

let authBootstrapped = false;

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const hashValue = (value) => {
  return crypto
    .createHash("sha256")
    .update(String(value))
    .digest("hex");
};

const hashOtp = (otpCode) => hashValue(`${String(otpCode)}:${env.otpPepper}`);

const generateOtpCode = () => {
  const otp = crypto.randomInt(0, 1000000);
  return String(otp).padStart(6, "0");
};

const getExpiresAtFromToken = (token) => {
  const decoded = jwt.decode(token);
  if (!decoded?.exp) {
    return new Date(Date.now() + 60 * 60 * 1000);
  }
  return new Date(decoded.exp * 1000);
};

const signAccessToken = (user) => {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      schoolCode: user.linked_school_code,
    },
    env.jwtAccessSecret,
    { expiresIn: env.jwtAccessExpiresIn },
  );
};

const signRefreshToken = (user) => {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      type: "refresh",
    },
    env.jwtRefreshSecret,
    { expiresIn: env.jwtRefreshExpiresIn },
  );
};

const assertStrongPassword = (password) => {
  const value = String(password || "");
  if (value.length < 8) return "Password must be at least 8 characters";
  if (!/[A-Z]/.test(value)) return "Password must include at least one uppercase letter";
  if (!/[a-z]/.test(value)) return "Password must include at least one lowercase letter";
  if (!/[0-9]/.test(value)) return "Password must include at least one digit";
  if (!/[^A-Za-z0-9]/.test(value)) return "Password must include at least one special character";
  return null;
};

const ensureAuthBootstrap = async () => {
  if (authBootstrapped) {
    return;
  }

  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      username VARCHAR(80),
      role VARCHAR(30) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      email_verified BOOLEAN NOT NULL DEFAULT TRUE,
      linked_faculty_id VARCHAR(120) NOT NULL DEFAULT '',
      linked_school VARCHAR(80) NOT NULL DEFAULT '',
      linked_department VARCHAR(120) NOT NULL DEFAULT '',
      linked_school_code VARCHAR(50) NOT NULL DEFAULT '',
      force_password_reset BOOLEAN NOT NULL DEFAULT FALSE,
      password_updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(80);`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_faculty_id VARCHAR(120) NOT NULL DEFAULT '';`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_school VARCHAR(80) NOT NULL DEFAULT '';`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_department VARCHAR(120) NOT NULL DEFAULT '';`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS linked_school_code VARCHAR(50) NOT NULL DEFAULT '';`);
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS force_password_reset BOOLEAN NOT NULL DEFAULT FALSE;`);

  await query(`
    CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(128) NOT NULL UNIQUE,
      user_agent TEXT,
      ip_address VARCHAR(100),
      expires_at TIMESTAMP NOT NULL,
      revoked_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS password_reset_otps (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      otp_hash VARCHAR(128) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      consumed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  await query(
    `CREATE INDEX IF NOT EXISTS idx_users_email ON users((LOWER(email)));`,
  );
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users((LOWER(username))) WHERE username IS NOT NULL;`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_users_role_linked_school ON users(role, (LOWER(linked_school)));`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_users_role_linked_faculty_id ON users(role, (LOWER(linked_faculty_id)));`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active ON auth_refresh_tokens(user_id, revoked_at, expires_at);`,
  );
  await query(
    `CREATE INDEX IF NOT EXISTS idx_password_reset_otps_user_active ON password_reset_otps(user_id, consumed_at, expires_at, created_at DESC);`,
  );

  // Seed demo users (admin + 8 school accounts)
  for (const item of demoUsers) {
    try {
      const passwordHash = await bcrypt.hash(item.password, 12);
      await query(
        `
        INSERT INTO users (name, email, username, role, password_hash, is_active, email_verified, linked_school_code, force_password_reset)
        VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, $6, $7)
        ON CONFLICT (email) DO UPDATE
        SET username = COALESCE(users.username, EXCLUDED.username),
            linked_school_code = CASE WHEN TRIM(COALESCE(users.linked_school_code,'')) = '' THEN EXCLUDED.linked_school_code ELSE users.linked_school_code END;
        `,
        [item.name, item.email, item.username, item.role, passwordHash, item.linkedSchoolCode || '', item.forceReset || false],
      );
    } catch (err) {
      console.warn(`[Bootstrap] Skipping demo user ${item.email}: ${err.message}`);
    }
  }

  // Seed the 8 schools into the schools table
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS schools (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        slug VARCHAR(255) UNIQUE NOT NULL,
        overview TEXT,
        is_active BOOLEAN DEFAULT true,
        content JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await query(`ALTER TABLE schools ADD COLUMN IF NOT EXISTS content JSONB DEFAULT '{}'::jsonb;`);

    for (const school of SCHOOL_SEEDS) {
      await query(
        `INSERT INTO schools (code, name, slug) VALUES ($1, $2, $3) ON CONFLICT (code) DO NOTHING`,
        [school.code, school.name, school.slug],
      );
    }
  } catch (err) {
    console.warn(`[Bootstrap] School seeding: ${err.message}`);
  }

  authBootstrapped = true;
};

const login = async (email, password, portalRole, requestMeta = {}) => {
  await ensureAuthBootstrap();
  const normalizedLoginId = normalizeEmail(email);

  const userResult = await query(
    `
    SELECT id, name, email, username, role, password_hash, is_active, force_password_reset, linked_school_code
    FROM users
    WHERE LOWER(email) = $1 OR LOWER(COALESCE(username, '')) = $1
    LIMIT 1
    `,
    [normalizedLoginId],
  );

  const user = userResult.rows[0];
  if (!user || !user.is_active) {
    return null;
  }

  const isPasswordMatch = await bcrypt.compare(
    String(password || ""),
    user.password_hash,
  );

  if (!isPasswordMatch) {
    return null;
  }

  if (portalRole) {
    const roleKey = String(portalRole).toLowerCase();
    const allowedRoles = portalRoleMap[roleKey];

    if (!allowedRoles || !allowedRoles.includes(user.role)) {
      return null;
    }
  }

  // Generate OTP for login
  const otpCode = generateOtpCode();
  const expiresAt = new Date(Date.now() + env.otpExpiresMinutes * 60 * 1000);

  await query(
    `
    UPDATE password_reset_otps
    SET consumed_at = NOW()
    WHERE user_id = $1
      AND consumed_at IS NULL
      AND expires_at > NOW()
    `,
    [user.id],
  );

  await query(
    `
    INSERT INTO password_reset_otps (user_id, otp_hash, expires_at)
    VALUES ($1, $2, $3)
    `,
    [user.id, hashOtp(otpCode), expiresAt],
  );

  let portalName = "Faculty Portal";
  if (user.role === ROLES.SUPER_ADMIN) {
    portalName = "Admin Portal";
  } else if (user.role === ROLES.SCHOOL) {
    portalName = "School Portal";
  }

  const subject = `GBU ${portalName} - Verification OTP`;
  const html = buildOtpEmail(user.name, otpCode, env.otpExpiresMinutes, "logging in", portalName);
  await sendMail({ to: user.email, subject, text: `Your OTP is ${otpCode}`, html });

  return {
    requiresOtp: true,
    email: user.email,
    forcePasswordReset: user.force_password_reset
  };
};

const verifyLoginOtp = async (email, otp, newPassword, requestMeta = {}) => {
  await ensureAuthBootstrap();
  const normalizedEmail = normalizeEmail(email);

  const userResult = await query(
    `
    SELECT id, name, email, username, role, password_hash, is_active, force_password_reset, linked_school_code
    FROM users
    WHERE LOWER(email) = $1
    LIMIT 1
    `,
    [normalizedEmail],
  );

  const user = userResult.rows[0];
  if (!user || !user.is_active) return { success: false, message: "Invalid user" };

  const otpResult = await query(
    `
    SELECT id, otp_hash, attempts
    FROM password_reset_otps
    WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > NOW()
    ORDER BY created_at DESC LIMIT 1
    `,
    [user.id],
  );

  const activeOtp = otpResult.rows[0];
  if (!activeOtp) return { success: false, message: "OTP expired. Please login again." };

  if (hashOtp(otp) !== activeOtp.otp_hash) {
    const nextAttempts = Number(activeOtp.attempts || 0) + 1;
    await query(
      `UPDATE password_reset_otps SET attempts = $2, consumed_at = CASE WHEN $2 >= $3 THEN NOW() ELSE consumed_at END WHERE id = $1`,
      [activeOtp.id, nextAttempts, env.otpMaxAttempts]
    );
    return { success: false, message: "Invalid OTP" };
  }

  if (user.force_password_reset) {
     if (!newPassword) return { success: false, message: "New password is required for first time login" };
     const passwordError = assertStrongPassword(newPassword);
     if (passwordError) return { success: false, message: passwordError };
     const newPasswordHash = await bcrypt.hash(newPassword, 12);
     await query(`UPDATE users SET password_hash = $2, force_password_reset = FALSE WHERE id = $1`, [user.id, newPasswordHash]);
  }

  await query(`UPDATE password_reset_otps SET consumed_at = NOW() WHERE id = $1`, [activeOtp.id]);

  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  await query(
    `
    INSERT INTO auth_refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
    VALUES ($1, $2, $3, $4, $5)
    `,
    [user.id, hashValue(refreshToken), requestMeta.userAgent || null, requestMeta.ipAddress || null, getExpiresAtFromToken(refreshToken)]
  );

  return {
    success: true,
    data: {
      user: { id: user.id, name: user.name, email: user.email, username: user.username, role: user.role },
      accessToken,
      refreshToken,
    }
  };
};

const refresh = async (token) => {
  await ensureAuthBootstrap();

  if (!token) {
    return null;
  }

  try {
    const payload = jwt.verify(token, env.jwtRefreshSecret);
    if (payload?.type !== "refresh") {
      return null;
    }

    const refreshTokenResult = await query(
      `
      SELECT id, user_id
      FROM auth_refresh_tokens
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > NOW()
      LIMIT 1
      `,
      [hashValue(token)],
    );

    const activeToken = refreshTokenResult.rows[0];
    if (!activeToken || Number(activeToken.user_id) !== Number(payload.sub)) {
      return null;
    }

    const userResult = await query(
      `
      SELECT id, name, email, role, is_active, linked_school_code
      FROM users
      WHERE id = $1
      LIMIT 1
      `,
      [payload.sub],
    );

    const user = userResult.rows[0];
    if (!user || !user.is_active) {
      return null;
    }

    const accessToken = signAccessToken(user);
    return { accessToken };
  } catch (_error) {
    return null;
  }
};

const logout = async (token) => {
  await ensureAuthBootstrap();

  if (!token) {
    return false;
  }

  const result = await query(
    `
    UPDATE auth_refresh_tokens
    SET revoked_at = NOW()
    WHERE token_hash = $1
      AND revoked_at IS NULL
    `,
    [hashValue(token)],
  );

  return result.rowCount > 0;
};

const requestPasswordResetOtp = async (email) => {
  await ensureAuthBootstrap();
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    return { accepted: true };
  }

  const userResult = await query(
    `
    SELECT id, name, email, role, is_active
    FROM users
    WHERE LOWER(email) = $1
    LIMIT 1
    `,
    [normalizedEmail],
  );

  const user = userResult.rows[0];
  if (!user || !user.is_active) {
    return { accepted: true };
  }

  const otpCode = generateOtpCode();
  const expiresAt = new Date(Date.now() + env.otpExpiresMinutes * 60 * 1000);

  await query(
    `
    UPDATE password_reset_otps
    SET consumed_at = NOW()
    WHERE user_id = $1
      AND consumed_at IS NULL
      AND expires_at > NOW()
    `,
    [user.id],
  );

  await query(
    `
    INSERT INTO password_reset_otps (user_id, otp_hash, expires_at)
    VALUES ($1, $2, $3)
    `,
    [user.id, hashOtp(otpCode), expiresAt],
  );

  let portalName = "Faculty Portal";
  if (user.role === ROLES.SUPER_ADMIN) {
    portalName = "Admin Portal";
  } else if (user.role === ROLES.SCHOOL) {
    portalName = "School Portal";
  }

  const subject = `GBU ${portalName} - Password Reset OTP`;
  const html = buildOtpEmail(user.name, otpCode, env.otpExpiresMinutes, "resetting password", portalName);
  await sendMail({ to: user.email, subject, text: `Your OTP is ${otpCode}`, html });

  return { accepted: true };
};

const verifyOtpAndResetPassword = async ({ email, otp, newPassword }) => {
  await ensureAuthBootstrap();
  const normalizedEmail = normalizeEmail(email);

  const passwordError = assertStrongPassword(newPassword);
  if (passwordError) {
    return { success: false, code: "WEAK_PASSWORD", message: passwordError };
  }

  const userResult = await query(
    `
    SELECT id, email, is_active
    FROM users
    WHERE LOWER(email) = $1
    LIMIT 1
    `,
    [normalizedEmail],
  );

  const user = userResult.rows[0];
  if (!user || !user.is_active) {
    return { success: false, code: "INVALID_REQUEST", message: "Invalid email or OTP" };
  }

  const otpResult = await query(
    `
    SELECT id, otp_hash, attempts
    FROM password_reset_otps
    WHERE user_id = $1
      AND consumed_at IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [user.id],
  );

  const activeOtp = otpResult.rows[0];
  if (!activeOtp) {
    return { success: false, code: "OTP_EXPIRED", message: "OTP expired. Please request a new OTP" };
  }

  const incomingOtpHash = hashOtp(otp);
  if (incomingOtpHash !== activeOtp.otp_hash) {
    const nextAttempts = Number(activeOtp.attempts || 0) + 1;
    await query(
      `
      UPDATE password_reset_otps
      SET attempts = $2,
          consumed_at = CASE WHEN $2 >= $3 THEN NOW() ELSE consumed_at END
      WHERE id = $1
      `,
      [activeOtp.id, nextAttempts, env.otpMaxAttempts],
    );
    return { success: false, code: "INVALID_OTP", message: "OTP is invalid" };
  }

  const newPasswordHash = await bcrypt.hash(newPassword, 12);

  const client = await getDbPool().connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `
      UPDATE users
      SET password_hash = $2,
          email_verified = TRUE,
          password_updated_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
      `,
      [user.id, newPasswordHash],
    );

    await client.query(
      `
      UPDATE password_reset_otps
      SET consumed_at = NOW()
      WHERE user_id = $1
        AND consumed_at IS NULL
      `,
      [user.id],
    );

    await client.query(
      `
      UPDATE auth_refresh_tokens
      SET revoked_at = NOW()
      WHERE user_id = $1
        AND revoked_at IS NULL
      `,
      [user.id],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { success: true };
};

module.exports = {
  ensureAuthBootstrap,
  login,
  verifyLoginOtp,
  refresh,
  logout,
  requestPasswordResetOtp,
  verifyOtpAndResetPassword,
};
