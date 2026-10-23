const model = require('./model');
const { sendMail } = require('../../utils/mailer');
const { logError } = require('../../config/logger');
const env = require('../../config/env');

const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

const buildEmail = ({ recipientName, title, message, ticketId, rows = [] }) => {
    const portalLink = env.appBaseUrl ? `<p style="margin-top:16px;"><a href="${escapeHtml(env.appBaseUrl)}/login">Open the GBU portal</a></p>` : '';
    const detailRows = rows
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([label, value]) => `
            <tr>
                <td style="padding:8px;border:1px solid #ddd;font-weight:bold;width:40%;">${escapeHtml(label)}</td>
                <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(value)}</td>
            </tr>`)
        .join('');

    return `
        <div style="font-family:Arial,sans-serif;padding:20px;color:#333;">
            <div style="background-color:#003366;color:white;padding:15px;text-align:center;">
                <h2 style="margin:0;">GBU Maintenance Grievance Portal</h2>
            </div>
            <div style="padding:20px;border:1px solid #ddd;">
                <p>Dear ${escapeHtml(recipientName || 'User')},</p>
                <p><strong>${escapeHtml(title)}</strong></p>
                <p>${escapeHtml(message)}</p>
                <table style="width:100%;border-collapse:collapse;margin-top:15px;">
                    <tr>
                        <td style="padding:8px;border:1px solid #ddd;font-weight:bold;width:40%;">Ticket ID</td>
                        <td style="padding:8px;border:1px solid #ddd;">${escapeHtml(ticketId)}</td>
                    </tr>
                    ${detailRows}
                </table>
                ${portalLink}
                <p style="margin-top:20px;">Regards,<br>Estate &amp; Maintenance Cell, GBU</p>
            </div>
        </div>`;
};

const sendQuietly = (payload) => {
    sendMail(payload).catch((error) => {
        logError('Maintenance grievance email failed', { to: payload.to, error: error.message });
    });
};

/*
 * In-app notification + email for portal users. Never throws: a failed
 * notification must not roll back the workflow step that triggered it.
 */
async function notifyUsers(userIds, { ticketId, title, message, rows }) {
    const ids = [...new Set((userIds || []).map(Number).filter(Boolean))];
    if (!ids.length) return;

    try {
        await model.insertNotifications(ids, { ticketId, title, message });
        const users = await model.getUsersByIds(ids);
        for (const user of users) {
            sendQuietly({
                to: user.email,
                subject: `${title} - ${ticketId}`,
                text: `${title}\n\n${message}\n\nTicket: ${ticketId}`,
                html: buildEmail({ recipientName: user.name, title, message, ticketId, rows }),
            });
        }
    } catch (error) {
        logError('Maintenance grievance notification failed', { ticketId, error: error.message });
    }
}

async function notifyRole(role, payload) {
    try {
        const ids = await model.getActiveUserIdsByRole(role);
        await notifyUsers(ids, payload);
    } catch (error) {
        logError('Maintenance grievance role notification failed', { role, error: error.message });
    }
}

// The faculty member who raised the ticket (submitter_id holds their users.id).
async function notifySubmitter(ticket, payload) {
    await notifyUsers([Number(ticket.submitter_id)], payload);
}

module.exports = {
    escapeHtml,
    notifyUsers,
    notifyRole,
    notifySubmitter,
};
