import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

// Reads the session cookie, verifies the JWT, and attaches the decoded
// payload to req.user. Routes that call requireAuth get a guaranteed req.user.
export function requireAuth(req, res, next) {
  const token = req.cookies?.htlab_session;

  if (!token) {
    return res.status(401).json({ ok: false, error: 'Not authenticated' });
  }

  try {
    req.user = jwt.verify(token, config.jwt.secret);
    next();
  } catch (err) {
    res.clearCookie('htlab_session');
    return res.status(401).json({ ok: false, error: 'Session expired — please log in again' });
  }
}

// Soft version: populates req.user if a valid cookie exists, but doesn't block
// unauthenticated requests. Useful for public endpoints that behave differently
// when a user is logged in.
export function optionalAuth(req, res, next) {
  const token = req.cookies?.htlab_session;
  if (token) {
    try { req.user = jwt.verify(token, config.jwt.secret); } catch (_) { /* ignore */ }
  }
  next();
}
