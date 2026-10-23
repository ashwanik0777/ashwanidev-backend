const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const env = require('../../config/env');
const { GrievanceError } = require('./errors');

// Outside the public /uploads static root, so attachments are only reachable
// through the authorised download endpoint.
const PRIVATE_ROOT = path.resolve(env.privateStoragePath);
const GRIEVANCE_DIR = 'grievances';

const FILE_TYPES = {
    'image/jpeg': { ext: '.jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    'image/jpg': { ext: '.jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    'image/png': { ext: '.png', matches: (b) => b.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
    'image/webp': { ext: '.webp', matches: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
    'application/pdf': { ext: '.pdf', matches: (b) => b.slice(0, 4).toString() === '%PDF' },
};

const readHeader = (filePath) => {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buffer = Buffer.alloc(12);
        fs.readSync(fd, buffer, 0, 12, 0);
        return buffer;
    } finally {
        fs.closeSync(fd);
    }
};

const removeTemp = (file) => {
    if (file?.path) fs.promises.unlink(file.path).catch(() => {});
};

/*
 * Moves a multer temp upload into private storage after checking its real
 * content type. The stored extension always comes from the verified type, never
 * from the client's file name.
 */
async function storeAttachment(file, ticketId) {
    if (!file) return null;

    const type = FILE_TYPES[file.mimetype];
    if (!type || !type.matches(readHeader(file.path))) {
        removeTemp(file);
        throw new GrievanceError('Attachment must be a valid JPG, PNG, WEBP or PDF file.');
    }

    const safeTicket = String(ticketId).replace(/[^A-Za-z0-9-]/g, '');
    const relativePath = path.posix.join(GRIEVANCE_DIR, safeTicket, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${type.ext}`);
    const destination = path.join(PRIVATE_ROOT, relativePath);

    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    try {
        await fs.promises.rename(file.path, destination);
    } catch (error) {
        if (error.code !== 'EXDEV') throw error;
        await fs.promises.copyFile(file.path, destination);
        removeTemp(file);
    }

    return {
        path: relativePath,
        mime: file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype,
        name: String(file.originalname || `attachment${type.ext}`).slice(0, 200),
    };
}

async function discardAttachment(stored) {
    if (!stored?.path) return;
    await fs.promises.unlink(resolveAttachment(stored.path)).catch(() => {});
}

function resolveAttachment(relativePath) {
    const absolute = path.resolve(PRIVATE_ROOT, relativePath);
    if (!absolute.startsWith(PRIVATE_ROOT + path.sep)) {
        throw new GrievanceError('Invalid attachment path', 400);
    }
    return absolute;
}

module.exports = {
    storeAttachment,
    discardAttachment,
    resolveAttachment,
    removeTemp,
};
