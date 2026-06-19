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
    });
  }

  return transporter;
};

const getLogoPath = () => {
  // Try dynamic relative path from mailer.js
  const relPath = path.join(__dirname, "../../../gbu-website/public/assets/logo1.png");
  if (fs.existsSync(relPath)) return relPath;

  // Try user's exact absolute path
  const absPath = "/Users/ashwanikushwaha/gbu-full-web/gbu-website/public/assets/logo1.png";
  if (fs.existsSync(absPath)) return absPath;

  return null;
};

const sendMail = async ({ to, subject, text, html }) => {
  const transport = getTransporter();

  if (!transport) {
    logInfo("SMTP not configured. Email was not sent.", { to, subject });
    return { queued: false };
  }

  try {
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
        mailOptions.attachments = [
          {
            filename: 'logo1.png',
            path: logoPath,
            cid: 'gbulogo'
          }
        ];
      }
    }

    const result = await transport.sendMail(mailOptions);

    return { queued: true, messageId: result.messageId };
  } catch (error) {
    logError("Failed to send email", {
      to,
      subject,
      error: error.message,
    });
    throw error;
  }
};

module.exports = {
  sendMail,
  isMailConfigured,
};
