const model = require('./model');
const ROLES = require('../../constants/roles');
const env = require('../../config/env');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { grievanceCreatedEmail, grievanceStatusUpdateEmail } = require('./emailTemplates');

const transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    auth: { user: env.smtpUser, pass: env.smtpPass }
});

function validateWordCount(text, max = 100) {
    if (!text) return true;
    const wordCount = text.trim().split(/\s+/).length;
    return wordCount <= max;
}

async function generateTicketId(prefix) {
    for (let i = 0; i < 10; i++) {
        const year = new Date().getFullYear();
        const randomNum = Math.floor(10000 + Math.random() * 90000); // 5-digit
        const ticketId = `${prefix}-${year}-${randomNum}`;
        const exists = await model.ticketIdExists(ticketId);
        if (!exists) return ticketId;
    }
    throw new Error('Failed to generate unique ticket ID');
}

function getCategories(type) {
    if (type === 'faculty') {
        return {
            categories: ['Civil', 'Carpentry', 'Plumbing', 'Water', 'Electrical', 'Cleanliness', 'Other'],
            complaintForOptions: ['School', 'Residential', 'Others']
        };
    }
    return {
        categories: {
            'Hostel & Mess': ['Room Allotment & Bed Issues', 'Cleanliness Hygiene & Washroom Sanitation', 'Mess Food Quality & Catering', 'Water Supply & Drinking Water Coolers', 'Electrical Light & Geyser Faults', 'Furniture & Room Fixtures Repair', 'Hostel Wi-Fi & LAN Network', 'Warden / Hostel Staff Concern', 'Other Hostel Issue'],
            'Academic & Exam': ['Attendance Discrepancy / Correction', 'Class Timetable Conflict / Overlap', 'Internal Assessment / Mid-Sem Marks Query', 'End-Sem Exam Result / Grade Card Query', 'Course Syllabus & Study Material', 'Faculty Allocation Query', 'Admit Card / Hall Ticket Issue', 'Other Academic Issue'],
            'Fee & Accounts': ['Fee Payment Receipt / Txn Status Pending', 'Excess Fee Charged / Fee Difference', 'Scholarship / Fellowship Disbursement', 'Refund Request & Caution Money', 'No Dues / Financial Clearance', 'Other Fee & Accounts Issue'],
            'Maintenance': ['Laboratory Equipment / PC Maintenance', 'Classroom Projector AC & Lighting', 'Library Facilities & Book Issue', 'Sports Complex & Campus Grounds', 'Security Gate Pass & Campus Safety', 'Other Infrastructure & Maintenance'],
            'IT Support': ['Student ERP Login & Password Reset', 'Mobile Portal Responsiveness / Layout', 'Profile Information Correction', 'Registration / File Upload Technical Error', 'Wi-Fi Access Credentials', 'Other IT & Portal Support'],
            'General Office': ['Character / Bonafide / NOC Certificate', 'Student Identity Card Issue / Re-issue', 'Campus Bus & Transportation Services', 'University Canteen & Amenities', 'General Administrative Assistance'],
            'Other': ['General Feedback or Complaint']
        }
    };
}

async function submitGrievance(user, body, file) {
    if (!validateWordCount(body.description, 100)) {
        throw new Error('Description exceeds 100 words limit.');
    }

    const isStudent = user.role === ROLES.STUDENT;
    const prefix = isStudent ? 'GRV' : 'FAC-GRV';
    const ticketId = await generateTicketId(prefix);

    let attachmentUrl = null;
    if (file) {
        const uploadDir = path.join(process.cwd(), 'storage', 'uploads', 'grievances');
        if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
        
        const fileName = `${ticketId}-${Date.now()}${path.extname(file.originalname)}`;
        const dest = path.join(uploadDir, fileName);
        try {
            fs.renameSync(file.path, dest);
        } catch (err) {
            if (err.code === 'EXDEV') {
                fs.copyFileSync(file.path, dest);
                fs.unlinkSync(file.path);
            } else {
                throw err;
            }
        }
        attachmentUrl = `/uploads/grievances/${fileName}`;
    }

    const data = {
        ticket_id: ticketId,
        submitter_type: isStudent ? 'student' : 'faculty',
        submitter_id: String(user.sub),
        submitter_name: user.name,
        submitter_email: user.email,
        submitter_contact: body.submitter_contact || null,
        hostel_or_designation: body.hostel_or_designation || null,
        complaint_for: body.complaint_for || null,
        school_name: user.schoolName || body.school_name || null,
        school_code: user.schoolCode || body.school_code || null,
        department_name: user.departmentName || body.department_name || null,
        programme_name: user.programmeName || body.programme_name || null,
        category: body.category,
        sub_category: body.sub_category,
        priority: body.priority || 'Medium',
        subject: body.subject,
        description: body.description,
        attachment_url: attachmentUrl,
        is_student_grievance: isStudent
    };

    const record = await model.createGrievance(data);

    try {
        await transporter.sendMail({
            from: env.smtpFrom,
            to: record.submitter_email,
            subject: `Grievance Registered - ${record.ticket_id}`,
            html: grievanceCreatedEmail(record)
        });
    } catch (err) {
        console.error('Failed to send email:', err);
    }

    return record;
}

async function getMyGrievances(user) {
    const type = user.role === ROLES.STUDENT ? 'student' : 'faculty';
    return await model.getGrievancesBySubmitter(String(user.sub), type);
}

async function getMyGrievanceDetail(user, ticketId) {
    const record = await model.getGrievanceDetailForSubmitter(ticketId, String(user.sub));
    if (!record) throw new Error('Grievance not found or unauthorized');
    return record;
}

function getGrievanceScope(user) {
    if (user.role === ROLES.SUPER_ADMIN) {
        return { where: '1=1', params: [], canUpdate: true };
    }
    
    const grRole = user.grievanceRole;
    if (grRole === 'vc') {
        return { where: '1=1', params: [], canUpdate: false };
    }
    if (grRole === 'dean') {
        return { where: 'school_code = $1', params: [user.schoolCode], canUpdate: true };
    }
    if (grRole === 'hod') {
        return { where: 'school_code = $1 AND department_name = $2', params: [user.schoolCode, user.departmentName], canUpdate: true };
    }
    return null;
}

async function getGrievancesForManagement(user, filters) {
    const scope = getGrievanceScope(user);
    if (!scope) throw new Error('Unauthorized');
    return await model.getAllGrievances(filters, scope);
}

async function getStatsForManagement(user) {
    const scope = getGrievanceScope(user);
    if (!scope) throw new Error('Unauthorized');
    const rows = await model.getGrievanceStats(scope);
    
    // Transform [{status: 'Open', count: '2'}, ...] into {total, open, in_progress, resolved, rejected}
    const stats = { total: 0, open: 0, in_progress: 0, resolved: 0, rejected: 0 };
    for (const row of rows) {
        const count = parseInt(row.count, 10);
        stats.total += count;
        if (row.status === 'Open') stats.open = count;
        else if (row.status === 'In Progress') stats.in_progress = count;
        else if (row.status === 'Resolved') stats.resolved = count;
        else if (row.status === 'Rejected') stats.rejected = count;
    }
    return stats;
}

async function updateGrievance(user, ticketId, status, remark, req) {
    const scope = getGrievanceScope(user);
    if (!scope || !scope.canUpdate) throw new Error('Unauthorized to update');

    const grievance = await model.getGrievanceDetail(ticketId);
    if (!grievance) throw new Error('Grievance not found');

    const updated = await model.updateGrievanceStatus(ticketId, status, remark, user.name);

    await model.createAuditLog({
        ticket_id: ticketId,
        action: 'STATUS_UPDATE',
        performed_by: user.name,
        performer_id: user.sub,
        user_role: user.role,
        grievance_role: user.grievanceRole,
        old_status: grievance.status,
        new_status: status,
        remark: remark,
        ip_address: req.ip,
        user_agent: req.headers['user-agent']
    });

    try {
        await transporter.sendMail({
            from: env.smtpFrom,
            to: updated.submitter_email,
            subject: `Grievance Status Updated - ${ticketId}`,
            html: grievanceStatusUpdateEmail(updated)
        });
    } catch (err) {
        console.error('Failed to send status update email:', err);
    }

    return updated;
}

async function getSetting(key) {
    return await model.getGrievanceSetting(key);
}

async function updateSetting(key, value, userId) {
    return await model.updateGrievanceSetting(key, value, userId);
}

module.exports = {
    generateTicketId,
    validateWordCount,
    submitGrievance,
    getMyGrievances,
    getMyGrievanceDetail,
    getGrievancesForManagement,
    getStatsForManagement,
    updateGrievance,
    getGrievanceScope,
    getSetting,
    updateSetting,
    getCategories
};
