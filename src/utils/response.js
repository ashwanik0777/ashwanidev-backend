const successResponse = (res, message, data = {}, statusCode = 200, pagination) => {
  const payload = {
    success: true,
    message,
    data,
    errors: [],
  };

  if (pagination) {
    payload.pagination = pagination;
  }

  return res.status(statusCode).json(payload);
};

const errorResponse = (res, message, errors = [], statusCode = 400) => {
  return res.status(statusCode).json({
    success: false,
    message,
    data: null,
    errors,
  });
};

module.exports = {
  successResponse,
  errorResponse,
};
