const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const env = require("../config/env");
const { logInfo, logError } = require("../config/logger");

let transporter;

const isMailConfigured = () => {
  return Boolean(env.smtpHost && env.smtpUser && env.smtpPass);
};

const getTransporter = () => {
  if (!isMailConfigured()) {
    return null;
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpSecure,
      auth: {
        user: env.smtpUser,
        pass: env.smtpPass,
      },
      // Connection pooling — reuse the same SMTP connection for multiple emails
      // instead of login/logout for each one (which triggers Google's rate limit)
      pool: true,
      maxConnections: 1,
      maxMessages: 10,
      // Increase timeouts for bulk operations
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });
  }

  return transporter;
};

const getLogoPath = () => {
  // Prefer the optimised webp (≈5 KB) over the full-size PNG (≈110 KB)
  const candidates = [
    path.join(__dirname, "../assets/logo_email.webp"),           // backend's own copy (works on production)
    path.join(__dirname, "../../../gbu-website/public/assets/logo_email.webp"),  // local dev
    path.join(__dirname, "../../../gbu-website/public/assets/logo1.png"),        // fallback PNG
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
};

/**
 * Helper to wait for a given number of milliseconds.
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Send a single email with retry logic.
 * On "Too many login attempts" (454 error), waits and retries.
 */
const sendMail = async ({ to, subject, text, html }, retries = 2) => {
  const transport = getTransporter();

  if (!transport) {
    logInfo("SMTP not configured. Email was not sent.", { to, subject });
    return { queued: false };
  }

  const mailOptions = {
    from: env.smtpFrom,
    to,
    subject,
    text,
    html,
  };

  if (html && html.includes("cid:gbulogo")) {
    const logoPath = getLogoPath();
    if (logoPath) {
      const isWebp = logoPath.endsWith(".webp");
      mailOptions.attachments = [
        {
          filename: isWebp ? "logo.webp" : "logo.png",
          path: logoPath,
          cid: "gbulogo",
          contentType: isWebp ? "image/webp" : "image/png",
        }
      ];
    }
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await transport.sendMail(mailOptions);
      return { queued: true, messageId: result.messageId };
    } catch (error) {
      const isRateLimit =
        error.responseCode === 454 ||
        (error.message && error.message.includes("Too many login attempts"));

      if (isRateLimit && attempt < retries) {
        // Wait before retrying — exponential backoff (10s, then 30s)
        const waitTime = (attempt + 1) * 10000 + Math.random() * 5000;
        logInfo(`Rate limited by SMTP. Waiting ${Math.round(waitTime / 1000)}s before retry ${attempt + 1}/${retries}`, { to });

        // Force close and recreate transporter to get a fresh connection
        try {
          transporter.close();
        } catch (_) { /* ignore */ }
        transporter = null;

        await delay(waitTime);
        continue;
      }

      logError("Failed to send email", {
        to,
        subject,
        error: error.message,
        attempt: attempt + 1,
      });
      throw error;
    }
  }
};

module.exports = {
  sendMail,
  isMailConfigured,
  delay,
};
