const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const env = require('../config/env');

const shouldSkipRateLimit = (req) => {
  const path = String(req.path || '').toLowerCase();
  return req.method === 'OPTIONS' || path === '/health' || path === '/api/health';
};

const apiRateLimiter = rateLimit({
  windowMs: env.apiRateLimitWindowMs,
  max: env.apiRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skip: shouldSkipRateLimit,
  message: {
    success: false,
    message: 'Too many requests, please try again later.',
    errors: [{ field: 'rateLimit', message: 'Rate limit exceeded' }],
  },
});

/*
 * Sign-in limits.
 *
 * Everyone on the campus network reaches us from the same public IP, and one school login is
 * shared by its office staff. A single counter per IP for every auth call (the old setup: 20 per
 * 15 minutes, with token refreshes and logouts counted too) locked whole offices out after a few
 * ordinary logins. Now:
 *  - only failed attempts count for sign-in, OTP check and password reset;
 *  - they count per account and network, so one person's typos do not block colleagues,
 *    with a larger cap per network so trying many accounts is still stopped;
 *  - token refresh and logout have their own counter, again counting only failures;
 *  - password-reset OTP emails are capped per address, since those requests always succeed.
 */

const minutesLeft = (req) => {
  const reset = req.rateLimit?.resetTime;
  const ms = reset instanceof Date ? reset.getTime() - Date.now() : env.authRateLimitWindowMs;
  return Math.max(1, Math.ceil(ms / 60000));
};

const limitMessage = (reason) => (req) => {
  const minutes = minutesLeft(req);
  const message = `${reason} Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
  return { success: false, message, errors: [{ field: 'rateLimit', message }] };
};

const loginIdOf = (req) => String(req.body?.email || req.body?.username || '').trim().toLowerCase();
const networkAndAccount = (req) => `${ipKeyGenerator(req.ip)}|${loginIdOf(req) || '-'}`;

const failedAttemptsPerAccount = rateLimit({
  windowMs: env.authRateLimitWindowMs,
  limit: env.authRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: networkAndAccount,
  message: limitMessage('Too many failed attempts for this account.'),
});

const failedAttemptsPerNetwork = rateLimit({
  windowMs: env.authRateLimitWindowMs,
  limit: env.authRateLimitIpMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: limitMessage('Too many failed sign-in attempts from this network.'),
});

// Sign-in, login OTP check and password-reset OTP check.
const loginRateLimiter = [failedAttemptsPerNetwork, failedAttemptsPerAccount];

// Token refresh and logout: open dashboards refresh every few minutes, so only failures count.
const sessionRateLimiter = rateLimit({
  windowMs: env.authRateLimitWindowMs,
  limit: env.sessionRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: limitMessage('Too many session requests.'),
});

// Password-reset OTP emails: the request always succeeds, so every request counts.
const otpRequestRateLimiter = rateLimit({
  windowMs: env.authRateLimitWindowMs,
  limit: env.otpRequestRateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: networkAndAccount,
  message: limitMessage('Too many reset codes requested for this email.'),
});

module.exports = {
  apiRateLimiter,
  loginRateLimiter,
  sessionRateLimiter,
  otpRequestRateLimiter,
};
