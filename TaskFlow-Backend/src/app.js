const express = require('express');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');

// The Express app without a database connection or a listening port, so tests
// can mount it on an ephemeral port against a test database (see test/routes.test.js).
function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check.
  app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'TaskFlow API is running' });
  });

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/projects', require('./routes/projects'));
  app.use('/api/notifications', require('./routes/notifications'));

  app.use((req, res) => {
    res.status(404).json({ message: 'Not found' });
  });

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
