const { logError } = require('../config/logger');
const { errorResponse } = require('../utils/response');

const errorHandler = (error, req, res, next) => {
  // Body-parser rejections are the client's fault: answer with their real
  // status instead of a 500, without echoing parser internals.
  if (error?.type === 'entity.too.large') {
    return errorResponse(res, 'Request body is too large', [
      { field: 'body', message: `Maximum allowed size is ${error.limit} bytes` },
    ], 413);
  }
  if (error?.type === 'entity.parse.failed') {
    return errorResponse(res, 'Malformed request body', [
      { field: 'body', message: 'Request body is not valid JSON' },
    ], 400);
  }
  if (error?.expose && error.status >= 400 && error.status < 500) {
    return errorResponse(res, 'Invalid request', [], error.status);
  }

  logError('Unhandled error', {
    requestId: req.requestId,
    path: req.originalUrl,
    method: req.method,
    error: error.message,
    stack: error.stack,
  });

  return errorResponse(
    res,
    'Internal server error',
    [{ field: 'server', message: 'Something went wrong' }],
    500,
  );
};

module.exports = errorHandler;
