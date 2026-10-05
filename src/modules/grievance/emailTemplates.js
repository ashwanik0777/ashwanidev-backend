function getStatusColor(status) {
    switch (status) {
        case 'Open': return 'blue';
        case 'In Progress': return 'orange';
        case 'Resolved': return 'green';
        case 'Rejected': return 'red';
        default: return 'black';
    }
}

function grievanceCreatedEmail(data) {
    return `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <div style="background-color: #003366; color: white; padding: 15px; text-align: center;">
                <h2>GBU Grievance Portal</h2>
            </div>
            <div style="padding: 20px; border: 1px solid #ddd;">
                <p>Dear ${data.submitter_name},</p>
                <p>Your grievance has been successfully registered. Here are the details:</p>
                <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                    <tr>
                        <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Ticket ID</td>
                        <td style="padding: 8px; border: 1px solid #ddd;">${data.ticket_id}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Category</td>
                        <td style="padding: 8px; border: 1px solid #ddd;">${data.category} - ${data.sub_category}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Subject</td>
                        <td style="padding: 8px; border: 1px solid #ddd;">${data.subject}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Priority</td>
                        <td style="padding: 8px; border: 1px solid #ddd;">${data.priority}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #ddd; font-weight: bold;">Submitted On</td>
                        <td style="padding: 8px; border: 1px solid #ddd;">${new Date().toLocaleString()}</td>
                    </tr>
                </table>
                <p style="margin-top: 20px;">We will process your request and update you soon.</p>
                <p>Best Regards,<br>Grievance Redressal Cell, GBU</p>
            </div>
        </div>
    `;
}

function grievanceStatusUpdateEmail(data) {
    const color = getStatusColor(data.status);
    return `
        <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <div style="background-color: #003366; color: white; padding: 15px; text-align: center;">
                <h2>GBU Grievance Portal - Status Update</h2>
            </div>
            <div style="padding: 20px; border: 1px solid #ddd;">
                <p>Dear ${data.submitter_name},</p>
                <p>The status of your grievance (Ticket ID: <strong>${data.ticket_id}</strong>) has been updated.</p>
                <div style="margin: 20px 0; padding: 15px; border-left: 4px solid ${color}; background-color: #f9f9f9;">
                    <p style="margin: 0;"><strong>New Status:</strong> <span style="color: ${color}; font-weight: bold;">${data.status}</span></p>
                    ${data.assigned_to ? `<p style="margin: 10px 0 0;"><strong>Assigned To / Reviewed By:</strong> ${data.assigned_to}</p>` : ''}
                    ${data.admin_remark ? `<p style="margin: 10px 0 0;"><strong>Remark:</strong> ${data.admin_remark}</p>` : ''}
                </div>
                <p>Updated On: ${new Date().toLocaleString()}</p>
                <p>Best Regards,<br>Grievance Redressal Cell, GBU</p>
            </div>
        </div>
    `;
}

module.exports = {
    grievanceCreatedEmail,
    grievanceStatusUpdateEmail
};
