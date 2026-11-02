const { logError } = require("../config/logger");

const successResponse =(res, message, data = {}, statusCode = 200, pagination) => {
  const payload = {
    success: true,
    message,
    data,
  };

  if (pagination) {
    payload.pagination = pagination;
  }

  return res.status(statusCode).json(payload);
};

const GENERIC_SERVER_ERROR = "Something went wrong. Please try again.";

const errorResponse = (res, message, errors = [], statusCode = 400) => {
  if (statusCode >= 500) {
    // Many handlers pass `error.message` straight through on a 5xx, which
    // exposes database/filesystem internals (table and constraint names, DB
    // host, absolute paths). Log the details server-side and give the client
    // only a generic message plus the request id to quote when reporting it.
    const requestId = res.req?.requestId;
    logError("Server error response", {
      requestId,
      method: res.req?.method,
      path: res.req?.originalUrl,
      statusCode,
      message,
      errors,
    });
    return res.status(statusCode).json({
      success: false,
      message,
      errors: [{ field: "server", message: GENERIC_SERVER_ERROR }],
      requestId,
    });
  }

  return res.status(statusCode).json({
    success: false,
    message,
    errors,
  });
};

module.exports = {
  successResponse,
  errorResponse,
};
