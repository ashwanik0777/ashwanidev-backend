const normalize = (value) => String(value || "").trim();

// SVG Icons mimicking Lucide React Icons
const ICONS = {
  LOCK: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block; margin: 0 auto;"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  KEY: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block; margin: 0 auto;"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>`,
  ALERT: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block; margin: 0 auto;"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`
};

const buildBaseTemplate = ({ title, iconSvg, contentHtml }) => {
  const isDanger = iconSvg.includes('stroke="#dc2626"');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #f8fafc;
      color: #1e293b;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f8fafc;
      padding: 40px 20px;
      box-sizing: border-box;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      border: 1px solid #e2e8f0;
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
    }
    .header {
      background-color: #ffffff;
      padding: 32px 32px 20px 32px;
      text-align: center;
      border-bottom: 1px solid #f1f5f9;
    }
    .logo-text {
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: -0.5px;
      margin-top: 8px;
    }
    .logo-sub {
      font-size: 11px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      font-weight: 600;
    }
    .icon-container {
      margin: 20px auto 0 auto;
      display: inline-block;
      padding: 16px;
      background-color: #eff6ff;
      border-radius: 50%;
      width: 48px;
      height: 48px;
    }
    .icon-container.danger {
      background-color: #fef2f2;
    }
    .content {
      padding: 32px;
      line-height: 1.6;
      font-size: 15px;
    }
    .content p {
      margin-top: 0;
      margin-bottom: 16px;
      color: #334155;
    }
    .otp-code {
      display: block;
      width: fit-content;
      margin: 24px auto;
      padding: 14px 28px;
      background-color: #f1f5f9;
      border-radius: 12px;
      font-size: 32px;
      font-weight: 700;
      color: #0f172a;
      letter-spacing: 6px;
      text-align: center;
      border: 1px solid #e2e8f0;
    }
    .btn {
      display: inline-block;
      padding: 12px 24px;
      background-color: #2563eb;
      color: #ffffff !important;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      border-radius: 10px;
      text-align: center;
      margin: 16px 0;
    }
    .btn:hover {
      background-color: #1d4ed8;
    }
    .credentials-table {
      width: 100%;
      border-collapse: collapse;
      margin: 24px 0;
      background-color: #f8fafc;
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
    }
    .credentials-table td {
      padding: 12px 16px;
      border-bottom: 1px solid #e2e8f0;
      font-size: 14px;
      color: #334155;
    }
    .credentials-table tr:last-child td {
      border-bottom: none;
    }
    .credentials-label {
      font-weight: 600;
      color: #475569;
      width: 40%;
    }
    .credentials-value {
      font-family: Courier, monospace;
      font-weight: 700;
      color: #0f172a;
    }
    .footer {
      padding: 24px 32px 40px 32px;
      text-align: center;
      font-size: 12px;
      color: #64748b;
      line-height: 1.5;
      border-top: 1px solid #f1f5f9;
      background-color: #fafbfd;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <div class="logo-sub">Gautam Buddha University</div>
        <div class="logo-text">Faculty Portal</div>
        <div class="icon-container ${isDanger ? 'danger' : ''}">
          ${iconSvg}
        </div>
      </div>
      <div class="content">
        ${contentHtml}
      </div>
      <div class="footer">
        <p>This is an automated message from Gautam Buddha University Faculty Portal.</p>
        <p>Yamuna Expressway, Greater Noida, G.B. Nagar, U.P. - 201312</p>
        <p>&copy; ${new Date().getFullYear()} GBU. All rights reserved.</p>
      </div>
    </div>
  </div>
</body>
</html>`;
};

// Template 1: OTP Email
const buildOtpEmail = (recipientName, otpCode, expiresMinutes, purposeText) => {
  const safeName = normalize(recipientName) || "User";
  const title = `GBU Login Verification - OTP`;
  
  const contentHtml = `
    <p>Dear ${safeName},</p>
    <p>We received a request for ${purposeText || "verifying your identity"}. Your One-Time Password (OTP) is:</p>
    <div class="otp-code">${otpCode}</div>
    <p>This OTP is confidential and valid for <strong>${expiresMinutes || 10} minutes</strong>. Please do not share this code with anyone.</p>
    <p>If you did not request this OTP, please ignore this email or contact security support.</p>
    <p>Regards,<br/><strong>GBU Faculty Portal Team</strong></p>
  `;

  return buildBaseTemplate({
    title,
    iconSvg: ICONS.LOCK,
    contentHtml
  });
};

// Template 2: Credentials Email
const buildCredentialsEmail = (recipientName, username, password, loginUrl, linkedFacultyId) => {
  const safeName = normalize(recipientName) || "Faculty Member";
  const safeUsername = normalize(username);
  const safePassword = normalize(password);
  const title = `GBU Faculty Portal - Login Credentials`;

  const contentHtml = `
    <p>Dear ${safeName},</p>
    <p>Welcome to the Gautam Buddha University Faculty Portal. Your registration has been approved, and your official portal login account is ready.</p>
    <p>Your credentials are listed below:</p>
    <table class="credentials-table">
      <tr>
        <td class="credentials-label">Login ID / Email:</td>
        <td class="credentials-value">${safeUsername}</td>
      </tr>
      <tr>
        <td class="credentials-label">Temporary Password:</td>
        <td class="credentials-value">${safePassword}</td>
      </tr>
      ${linkedFacultyId && linkedFacultyId !== "N/A" ? `
      <tr>
        <td class="credentials-label">Linked Faculty ID:</td>
        <td class="credentials-value">${normalize(linkedFacultyId)}</td>
      </tr>` : ""}
    </table>
    <p>Please click the button below to log in and change your password immediately on your first access.</p>
    <div style="text-align: center;">
      <a href="${loginUrl}" class="btn" target="_blank">Access Faculty Portal</a>
    </div>
    <p>If you have any difficulty logging in, please reach out to the administrator.</p>
    <p>Regards,<br/><strong>GBU Faculty Portal Team</strong></p>
  `;

  return buildBaseTemplate({
    title,
    iconSvg: ICONS.KEY,
    contentHtml
  });
};

// Template 3: Rejection Email
const buildRejectionEmail = (recipientName, reason) => {
  const safeName = normalize(recipientName) || "Applicant";
  const title = `GBU Faculty Portal - Registration Update`;

  const contentHtml = `
    <p>Dear ${safeName},</p>
    <p>Thank you for submitting your registration request to the Gautam Buddha University Faculty Portal.</p>
    <p>After reviewing your request, we regret to inform you that it has been <strong>rejected</strong> by the administration.</p>
    ${reason ? `<p><strong>Reason for rejection:</strong></p>
    <div style="padding: 12px 16px; background-color: #fef2f2; border-left: 4px solid #dc2626; border-radius: 4px; margin-bottom: 20px; font-size: 14px; color: #991b1b;">
      ${normalize(reason)}
    </div>` : ""}
    <p>If you believe this is an error or have additional questions, please feel free to submit a new request or reach out to the university administration department.</p>
    <p>Regards,<br/><strong>GBU Faculty Portal Team</strong></p>
  `;

  return buildBaseTemplate({
    title,
    iconSvg: ICONS.ALERT,
    contentHtml
  });
};

module.exports = {
  buildOtpEmail,
  buildCredentialsEmail,
  buildRejectionEmail
};
