const jwt = require('jsonwebtoken');
const { getJwtConfig } = require('../config');

// jwt.verify throws on expired, malformed or wrongly signed tokens.
// Those are the client's problem, so answer 401 instead of letting the global
// error handler turn them into a 500.
const TOKEN_ERRORS = new Set(['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError']);

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (!token || scheme !== 'Bearer') {
    return res.status(401).json({ message: 'Missing Authorization header' });
  }

  let payload;
  try {
    payload = jwt.verify(token, getJwtConfig().secret);
  } catch (err) {
    if (TOKEN_ERRORS.has(err.name)) {
      const message = err.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token';
      return res.status(401).json({ message });
    }
    return next(err);
  }

  req.userId = payload.sub;
  req.userEmail = payload.email;

  next();
}

module.exports = requireAuth;
