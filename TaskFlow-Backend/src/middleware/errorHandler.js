const { createLogger } = require('../utils/logger');

const logger = createLogger('errorHandler');

// Global error handler. Express 5 forwards rejected promises from async handlers
// here, so routes don't need try/catch just to avoid unhandled rejections.
// Mongoose and MongoDB errors caused by bad input are client errors, not 500s.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err.name === 'CastError') {
    // e.g. GET /api/projects/not-an-id
    return res.status(400).json({ message: `Invalid ${err.path || 'id'}` });
  }

  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors || {})
      .map((e) => e.message)
      .join(' ');
    return res.status(400).json({ message: message || 'Validation failed' });
  }

  if (err.code === 11000) {
    // Unique index violation, e.g. a second project with the same code for one user.
    const field = Object.keys(err.keyPattern || err.keyValue || {}).pop() || 'value';
    return res.status(409).json({ message: `A record with this ${field} already exists` });
  }

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body is not valid JSON' });
  }

  const status = err.status || err.statusCode || 500;
  logger.error('Unhandled error', {
    method: req.method,
    path: req.originalUrl,
    status,
    errorMessage: err.message,
  });
  return res
    .status(status)
    .json({ message: status === 500 ? 'Internal server error' : err.message });
}

module.exports = errorHandler;
