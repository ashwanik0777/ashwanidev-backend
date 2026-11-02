const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { query } = require('../config/db');
const { logError } = require('../config/logger');
const { errorResponse } = require('../utils/response');

/*
 * A signed, unexpired access token is not enough on its own: it must still
 * belong to a live session. Each access token carries `sid`, the id of the
 * refresh-token row it was issued for, so revoking that row (logout, password
 * reset) or deactivating the user ends the access token immediately instead of
 * leaving it usable until it expires.
 *
 * Lookups are cached briefly to keep a DB round trip off most requests. This
 * process drops cache entries as soon as it revokes a session, so revocation
 * is immediate here and takes at most SESSION_CACHE_TTL_MS on other instances.
 */
const SESSION_CACHE_TTL_MS = 15 * 1000;
const SESSION_CACHE_MAX_ENTRIES = 5000;
const sessionCache = new Map();

const pruneSessionCache = () => {
  const now = Date.now();
  for (const [key, entry] of sessionCache) {
    if (entry.expiresAt <= now) sessionCache.delete(key);
  }
  if (sessionCache.size > SESSION_CACHE_MAX_ENTRIES) sessionCache.clear();
};

const loadSessionUser = async (payload) => {
  // Tokens issued before `sid` existed are checked against the user only;
  // they expire on their own within one access-token lifetime.
  const key = payload.sid ? `sid:${payload.sid}` : `user:${payload.sub}`;
  const cached = sessionCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const result = payload.sid
    ? await query(
        `SELECT u.id, u.role, u.is_active
         FROM auth_refresh_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.id = $1 AND t.user_id = $2 AND t.revoked_at IS NULL AND t.expires_at > NOW()
         LIMIT 1`,
        [payload.sid, payload.sub],
      )
    : await query(`SELECT id, role, is_active FROM users WHERE id = $1 LIMIT 1`, [payload.sub]);

  const user = result.rows[0] || null;
  if (sessionCache.size >= SESSION_CACHE_MAX_ENTRIES) pruneSessionCache();
  sessionCache.set(key, { user, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
  return user;
};

/** Forget cached session checks after revoking a session (`sid`) or all of a user's sessions. */
const forgetSessions = ({ sid, userId } = {}) => {
  if (sid !== undefined && sid !== null) sessionCache.delete(`sid:${sid}`);
  if (userId !== undefined && userId !== null) {
    sessionCache.delete(`user:${userId}`);
    for (const [key, entry] of sessionCache) {
      if (entry.user && Number(entry.user.id) === Number(userId)) sessionCache.delete(key);
    }
  }
};

const rejectToken = (res) =>
  errorResponse(res, 'Invalid or expired token', [
    { field: 'authorization', message: 'Token is not valid' },
  ], 401);

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse(res, 'Authentication required', [
      { field: 'authorization', message: 'Bearer token missing' },
    ], 401);
  }

  const token = authHeader.split(' ')[1];

  let payload;
  try {
    payload = jwt.verify(token, env.jwtAccessSecret, { algorithms: ['HS256'] });
  } catch (error) {
    return rejectToken(res);
  }

  // Email-verification tokens (booking, faculty registration) are signed with
  // the same secret but are not login sessions.
  if (!payload?.sub || payload.type || payload.purpose) {
    return rejectToken(res);
  }

  try {
    const user = await loadSessionUser(payload);
    // A changed role also invalidates the token; refreshing issues one with the new role.
    if (!user || !user.is_active || user.role !== payload.role) {
      return rejectToken(res);
    }
  } catch (error) {
    logError('Session check failed', { requestId: req.requestId, error: error.message });
    return errorResponse(res, 'Unable to verify session', [], 503);
  }

  req.user = payload;
  return next();
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
  forgetSessions,
};
