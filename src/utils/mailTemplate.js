const normalize = (value) => String(value || "").trim();

const buildBaseTemplate = ({ title, contentHtml, portalName = "Faculty Portal", isDanger = false }) => {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: #fafaf9;
      color: #44403c;
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      padding: 24px 10px;
      background-color: #fafaf9;
      box-sizing: border-box;
    }
    .card {
      max-width: 420px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 12px;
      border: 1px solid #e7e5e4;
      padding: 24px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.02);
    }
    .header {
      text-align: center;
      margin-bottom: 20px;
    }
    .logo-img {
      width: 52px;
      height: 52px;
      display: block;
      margin: 0 auto 12px auto;
      object-fit: contain;
    }
    .portal-tag {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #78716c;
      background-color: #f5f5f4;
      padding: 4px 10px;
      border-radius: 16px;
      display: inline-block;
    }
    .portal-tag.danger {
      color: #dc2626;
      background-color: #fef2f2;
    }
    .content {
      font-size: 13px;
      line-height: 1.5;
      color: #44403c;
    }
    .content p {
      margin: 0 0 12px 0;
    }
    .otp-display {
      display: block;
      margin: 16px auto;
      padding: 10px;
      background-color: #f5f5f4;
      border-radius: 8px;
      font-size: 28px;
      font-weight: 700;
      letter-spacing: 4px;
      text-align: center;
      color: #1c1917;
      border: 1px dashed #d6d3d1;
      max-width: 180px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .btn {
      display: inline-block;
      padding: 10px 24px;
      background-color: #1c1917;
      color: #ffffff !important;
      text-decoration: none;
      font-weight: 600;
      font-size: 13px;
      border-radius: 6px;
      text-align: center;
      margin: 12px 0;
      border: 1px solid #1c1917;
    }
    .table-details {
      width: 100%;
      margin: 16px 0;
      border-collapse: collapse;
      border: 1px solid #e7e5e4;
      border-radius: 8px;
      overflow: hidden;
      background-color: #fafaf9;
    }
    .table-details td {
      padding: 10px 14px;
      border-bottom: 1px solid #e7e5e4;
      font-size: 12px;
      color: #44403c;
    }
    .table-details tr:last-child td {
      border-bottom: none;
    }
    .lbl {
      font-weight: 600;
      color: #78716c;
      width: 35%;
    }
    .val {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-weight: 700;
      color: #1c1917;
      word-break: break-all;
    }
    .footer {
      margin-top: 24px;
      text-align: center;
      font-size: 10px;
      color: #78716c;
      line-height: 1.4;
      border-top: 1px solid #e7e5e4;
      padding-top: 16px;
    }
    .footer-title {
      font-size: 11px;
      font-weight: 600;
      color: #1c1917;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    .footer-copy {
      font-size: 9px;
      color: #a8a29e;
      margin-top: 6px;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div class="header">
        <img src="cid:gbulogo" alt="GBU Logo" class="logo-img" />
        <div class="portal-tag ${isDanger ? 'danger' : ''}">${portalName}</div>
      </div>
      <div class="content">
        ${contentHtml}
      </div>
      <div class="footer">
        <div class="footer-title">GAUTAM BUDDHA UNIVERSITY</div>
        <div>Yamuna Expressway, Greater Noida, U.P. - 201312</div>
        <div class="footer-copy">&copy; ${new Date().getFullYear()} GBU. All rights reserved.</div>
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
    contentHtml,
    portalName,
    isDanger: false
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
    contentHtml,
    portalName,
    isDanger: false
  });
};

// Template 3: Rejection Email
const buildRejectionEmail = (recipientName, reason, portalName = "Faculty Portal") => {
  const safeName = normalize(recipientName) || "Applicant";
  const title = `${portalName} Registration Update`;

  const contentHtml = `
    <p>Dear ${safeName},</p>
    <p>We regret to inform you that your registration request has been <strong>rejected</strong> by the administration.</p>
    ${reason ? `
    <div style="padding: 12px; background-color: #fef2f2; border-left: 3px solid #dc2626; border-radius: 6px; margin: 16px 0; font-size: 12px; color: #991b1b; line-height: 1.4;">
      <div style="font-weight: 700; margin-bottom: 2px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px;">Rejection Reason</div>
      ${normalize(reason)}
    </div>` : ""}
    <p>Regards,<br/><strong>GBU Team</strong></p>
  `;

  return buildBaseTemplate({
    title,
    contentHtml,
    portalName,
    isDanger: true
  });
};

const formatDate = (dateString) => {
  if (!dateString) return "N/A";
  try {
    const d = new Date(dateString);
    return d.toLocaleString('en-IN', {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch (e) {
    return dateString;
  }
};

const buildBookingNotificationEmail = (inChargeName, booking) => {
  const safeName = normalize(inChargeName) || "In-Charge";
  const bToken = normalize(booking.token);
  const bFacility = normalize(booking.facilityName || booking.facility_name);
  const bUser = normalize(booking.userName || booking.user_name);
  const bOrg = normalize(booking.organization);
  const bPurpose = normalize(booking.purpose);
  const bEmail = normalize(booking.userEmail || booking.user_email);
  const bPhone = normalize(booking.userPhonePrimary || booking.user_phone_primary);
  const bPhoneSec = normalize(booking.userPhoneSecondary || booking.user_phone_secondary);
  const bStart = formatDate(booking.startTime || booking.start_time);
  const bEnd = formatDate(booking.endTime || booking.end_time);

  const title = `New Facility Booking Request - ${bToken}`;
  
  const contentHtml = `
    <p>Dear ${safeName},</p>
    <p>A new booking request has been submitted for the facility: <strong>${bFacility}</strong>.</p>
    <p>Please review the details below:</p>
    <table class="table-details">
      <tr>
        <td class="lbl">Booking Token:</td>
        <td class="val">${bToken}</td>
      </tr>
      <tr>
        <td class="lbl">Applicant Name:</td>
        <td class="val">${bUser}</td>
      </tr>
      <tr>
        <td class="lbl">Organization:</td>
        <td class="val">${bOrg || "N/A"}</td>
      </tr>
      <tr>
        <td class="lbl">Schedule:</td>
        <td class="val">${bStart} to ${bEnd}</td>
      </tr>
      <tr>
        <td class="lbl">Purpose:</td>
        <td class="val">${bPurpose}</td>
      </tr>
      <tr>
        <td class="lbl">Contact:</td>
        <td class="val">${bEmail}<br/>${bPhone} ${bPhoneSec ? '/ ' + bPhoneSec : ''}</td>
      </tr>
    </table>
    <p>Please log in to the GBU Admin Portal to approve or reject this booking request.</p>
    <p>Regards,<br/><strong>GBU Facilities Team</strong></p>
  `;

  return buildBaseTemplate({
    title,
    contentHtml,
    portalName: "Admin Portal",
    isDanger: false
  });
};

const buildBookingStatusEmail = (userName, booking, status, remarks) => {
  const safeName = normalize(userName) || "Applicant";
  const bToken = normalize(booking.token);
  const bFacility = normalize(booking.facilityName || booking.facility_name);
  const bStart = formatDate(booking.startTime || booking.start_time);
  const bEnd = formatDate(booking.endTime || booking.end_time);
  const isPending = String(status).toLowerCase() === "pending";
  const isRejected = String(status).toLowerCase() === "rejected";
  const isApproved = String(status).toLowerCase() === "approved";
  
  const title = isPending ? `Facility Booking Received - ${bToken}` : `Facility Booking Update - ${bToken}`;

  const contentHtml = `
    <p>Dear ${safeName},</p>
    <p>${isPending 
      ? `Your booking request for <strong>${bFacility}</strong> has been successfully submitted and is currently pending administrative review.` 
      : `The status of your booking request for <strong>${bFacility}</strong> has been updated.`}</p>
      
    <p><strong>Current Status: <span style="color: ${isRejected ? '#dc2626' : (isPending ? '#d97706' : '#16a34a')}; text-transform: uppercase;">${normalize(status)}</span></strong></p>
    
    <table class="table-details">
      <tr>
        <td class="lbl">Booking Token:</td>
        <td class="val">${bToken}</td>
      </tr>
      <tr>
        <td class="lbl">Schedule:</td>
        <td class="val">${bStart} to ${bEnd}</td>
      </tr>
    </table>
    
    ${isRejected && remarks ? `
    <div style="padding: 12px; background-color: #fef2f2; border-left: 3px solid #dc2626; border-radius: 6px; margin: 16px 0; font-size: 12px; color: #991b1b; line-height: 1.4;">
      <div style="font-weight: 700; margin-bottom: 2px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.5px;">Rejection Remarks</div>
      ${normalize(remarks)}
    </div>` : ""}
    
    ${isPending ? `
    <div style="margin-top: 20px; padding: 12px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px;">
      <p style="margin: 0; font-size: 13px; color: #475569;"><strong>How to track your request?</strong><br/>You can track the live status of your application anytime by visiting the GBU Booking Portal and entering your <strong>Booking Token</strong>.</p>
    </div>
    ` : ""}

    ${isApproved ? `
    <p>Please coordinate with the facility in-charge for access and other arrangements.</p>
    ` : ""}
    
    <p>Regards,<br/><strong>GBU Facilities Team</strong></p>
  `;

  return buildBaseTemplate({
    title,
    contentHtml,
    portalName: "GBU Booking Portal",
    isDanger: isRejected
  });
};

const buildApprovalEmail = (recipientName, facultyId, portalUrl, portalName = "Faculty Profile Portal") => {
  const safeName = normalize(recipientName) || "Faculty Member";
  const title = `${portalName} — Registration Approved`;

  const contentHtml = `
    <p>Dear ${safeName},</p>
    <p>We are pleased to inform you that your faculty registration request has been <strong style="color: #059669;">approved</strong> by the administration.</p>
    <table class="table-details">
      <tr>
        <td class="lbl">Name:</td>
        <td class="val">${safeName}</td>
      </tr>
      <tr>
        <td class="lbl">Faculty ID:</td>
        <td class="val">${normalize(facultyId)}</td>
      </tr>
    </table>
    <p>You can now complete your faculty profile by visiting the Faculty Profile Portal. Please use your registered email to log in via OTP.</p>
    <div style="text-align: center;">
      <a href="${normalize(portalUrl)}" class="btn" target="_blank">Complete Your Profile</a>
    </div>
    <p style="font-size: 12px; color: #78716c; margin-top: 16px;">If you have any questions, please contact the university administration.</p>
    <p>Regards,<br/><strong>GBU Team</strong></p>
  `;

  return buildBaseTemplate({
    title,
    contentHtml,
    portalName,
    isDanger: false
  });
};

module.exports = {
  buildOtpEmail,
  buildCredentialsEmail,
  buildRejectionEmail,
  buildApprovalEmail,
  buildBookingNotificationEmail,
  buildBookingStatusEmail
};

