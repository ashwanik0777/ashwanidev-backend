const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { errorResponse } = require('../utils/response');

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse(res, 'Authentication required', [
      { field: 'authorization', message: 'Bearer token missing' },
    ], 401);
  }

  const token = authHeader.split(' ')[1];

  try {
    const payload = jwt.verify(token, env.jwtAccessSecret);
    req.user = payload;
    return next();
  } catch (error) {
    return errorResponse(res, 'Invalid or expired token', [
      { field: 'authorization', message: 'Token is not valid' },
    ], 401);
  }
};

const authorize = (...allowedRoles) => {
  const roles = allowedRoles.flat(Infinity);
  return (req, res, next) => {
    if (!req.user?.role) {
      return errorResponse(res, 'Unauthorized', [
        { field: 'role', message: 'Role is missing in token' },
      ], 403);
    }

    if (!roles.includes(req.user.role)) {
      return errorResponse(res, 'Forbidden', [
        { field: 'role', message: 'You do not have permission for this route' },
      ], 403);
    }

    return next();
  };
};

module.exports = {
  authenticate,
  authorize,
};
