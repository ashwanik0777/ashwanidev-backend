const normalize = (value) => String(value || "").trim();

// SVG Icons mimicking Lucide React Icons (24x24)
const ICONS = {
  LOCK: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block; margin: 0 auto;"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  KEY: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block; margin: 0 auto;"><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></svg>`,
  ALERT: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: block; margin: 0 auto;"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`
};

const buildBaseTemplate = ({ title, iconSvg, contentHtml, portalName = "Faculty Portal" }) => {
  const isDanger = iconSvg.includes('stroke="#dc2626"');
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      background-color: #f8fafc;
      color: #1e293b;
      margin: 0;
      padding: 0;
    }
    .wrapper {
      padding: 30px 15px;
      background-color: #f8fafc;
      box-sizing: border-box;
    }
    .card {
      max-width: 480px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
      padding: 32px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .header {
      text-align: center;
      margin-bottom: 24px;
    }
    .portal-tag {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #2563eb;
    }
    .portal-tag.danger {
      color: #dc2626;
    }
    .icon-box {
      margin: 16px auto 0 auto;
      padding: 12px;
      background-color: #eff6ff;
      border-radius: 50%;
      width: 24px;
      height: 24px;
      display: inline-block;
    }
    .icon-box.danger {
      background-color: #fef2f2;
    }
    .content {
      font-size: 14px;
      line-height: 1.6;
      color: #334155;
    }
    .content p {
      margin: 0 0 16px 0;
    }
    .otp-display {
      display: block;
      margin: 20px auto;
      padding: 12px;
      background-color: #f1f5f9;
      border-radius: 8px;
      font-size: 26px;
      font-weight: 700;
      letter-spacing: 4px;
      text-align: center;
      color: #0f172a;
      border: 1px solid #e2e8f0;
      max-width: 200px;
    }
    .btn {
      display: inline-block;
      padding: 10px 20px;
      background-color: #2563eb;
      color: #ffffff !important;
      text-decoration: none;
      font-weight: 600;
      font-size: 13px;
      border-radius: 8px;
      text-align: center;
      margin: 8px 0;
    }
    .btn:hover {
      background-color: #1d4ed8;
    }
    .table-details {
      width: 100%;
      margin: 20px 0;
      border-collapse: collapse;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      overflow: hidden;
    }
    .table-details td {
      padding: 10px 14px;
      border-bottom: 1px solid #e2e8f0;
      font-size: 13px;
      color: #334155;
    }
    .table-details tr:last-child td {
      border-bottom: none;
    }
    .lbl {
      font-weight: 600;
      color: #64748b;
      width: 40%;
    }
    .val {
      font-family: monospace;
      font-weight: 700;
      color: #0f172a;
    }
    .footer {
      margin-top: 24px;
      text-align: center;
      font-size: 11px;
      color: #94a3b8;
      line-height: 1.4;
      border-top: 1px solid #f1f5f9;
      padding-top: 16px;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <div class="portal-tag ${isDanger ? 'danger' : ''}">${portalName}</div>
        <div class="icon-box ${isDanger ? 'danger' : ''}">
          ${iconSvg}
        </div>
      </div>
      <div class="content">
        ${contentHtml}
      </div>
      <div class="footer">
        <strong>Gautam Buddha University</strong><br/>
        Yamuna Expressway, Greater Noida, U.P. - 201312<br/>
        &copy; ${new Date().getFullYear()} GBU
      </div>
    </div>
  </div>
</body>
</html>`;
};

// Template 1: OTP Email
const buildOtpEmail = (recipientName, otpCode, expiresMinutes, purposeText, portalName = "Faculty Portal") => {
  const safeName = normalize(recipientName) || "User";
  const title = `${portalName} Verification OTP`;
  
  const contentHtml = `
    <p>Dear ${safeName},</p>
    <p>Your verification OTP code is:</p>
    <div class="otp-display">${otpCode}</div>
    <p>This code is valid for <strong>${expiresMinutes || 10} minutes</strong>. Please do not share it with anyone.</p>
    <p>Regards,<br/><strong>GBU Team</strong></p>
  `;

  return buildBaseTemplate({
    title,
    iconSvg: ICONS.LOCK,
    contentHtml,
    portalName
  });
};

// Template 2: Credentials Email
const buildCredentialsEmail = (recipientName, username, password, loginUrl, linkedFacultyId, portalName = "Faculty Portal") => {
  const safeName = normalize(recipientName) || "Portal User";
  const safeUsername = normalize(username);
  const safePassword = normalize(password);
  const title = `${portalName} Login Credentials`;

  const contentHtml = `
    <p>Dear ${safeName},</p>
    <p>Your login credentials are ready:</p>
    <table class="table-details">
      <tr>
        <td class="lbl">Login ID / Email:</td>
        <td class="val">${safeUsername}</td>
      </tr>
      <tr>
        <td class="lbl">Temporary Password:</td>
        <td class="val">${safePassword}</td>
      </tr>
      ${linkedFacultyId && linkedFacultyId !== "N/A" ? `
      <tr>
        <td class="lbl">Linked Faculty ID:</td>
        <td class="val">${normalize(linkedFacultyId)}</td>
      </tr>` : ""}
    </table>
    <p>Please change your password immediately on your first login.</p>
    <div style="text-align: center;">
      <a href="${loginUrl}" class="btn" target="_blank">Access Portal</a>
    </div>
    <p>Regards,<br/><strong>GBU Team</strong></p>
  `;

  return buildBaseTemplate({
    title,
    iconSvg: ICONS.KEY,
    contentHtml,
    portalName
  });
};

// Template 3: Rejection Email
const buildRejectionEmail = (recipientName, reason, portalName = "Faculty Portal") => {
  const safeName = normalize(recipientName) || "Applicant";
  const title = `${portalName} Registration Update`;

  const contentHtml = `
    <p>Dear ${safeName},</p>
    <p>We regret to inform you that your registration request has been <strong>rejected</strong> by the administration.</p>
    ${reason ? `<div style="padding: 12px 14px; background-color: #fef2f2; border-left: 3px solid #dc2626; border-radius: 4px; margin-bottom: 16px; font-size: 13px; color: #991b1b;">
      <strong>Reason:</strong> ${normalize(reason)}
    </div>` : ""}
    <p>Regards,<br/><strong>GBU Team</strong></p>
  `;

  return buildBaseTemplate({
    title,
    iconSvg: ICONS.ALERT,
    contentHtml,
    portalName
  });
};

module.exports = {
  buildOtpEmail,
  buildCredentialsEmail,
  buildRejectionEmail
};
