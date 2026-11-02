const express = require('express');
const jwt = require('jsonwebtoken');
const env = require('../config/env');

/*
 * JSON / form body parsing with two size limits.
 *
 * Portal users need a large limit: the admin and school dashboards save a whole
 * school's CMS content as one JSON document. Everyone else — public forms such
 * as bookings, subscriptions and analytics — never sends more than a few KB, so
 * giving them the same multi-MB limit only lets anonymous clients make the
 * server buffer and parse huge bodies.
 *
 * The large limit requires a correctly signed session token, not just an
 * Authorization header; whether the session is still live is checked later by
 * `authenticate` on the route itself.
 */
const parsers = (limit) => [
  express.json({ limit }),
  express.urlencoded({ extended: true, limit }),
];

const portalParsers = parsers(env.jsonBodyLimit);
const publicParsers = parsers(env.publicBodyLimit);

const hasSessionToken = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  try {
    // An expired-but-genuine token still gets the large limit, so a big save
    // fails with authenticate's 401 (which the frontend refreshes and retries)
    // rather than a 413.
    const payload = jwt.verify(authHeader.slice(7), env.jwtAccessSecret, {
      algorithms: ['HS256'],
      ignoreExpiration: true,
    });
    return Boolean(payload?.sub) && !payload.type && !payload.purpose;
  } catch {
    return false;
  }
};

const parseBody = (req, res, next) => {
  const [json, urlencoded] = hasSessionToken(req) ? portalParsers : publicParsers;
  json(req, res, (error) => (error ? next(error) : urlencoded(req, res, next)));
};

module.exports = { parseBody };
