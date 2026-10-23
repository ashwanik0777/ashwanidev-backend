// Expected, user-facing failure with an HTTP status. Anything else is reported as a generic 500.
class GrievanceError extends Error {
    constructor(message, status = 400) {
        super(message);
        this.name = 'GrievanceError';
        this.status = status;
    }
}

module.exports = { GrievanceError };
