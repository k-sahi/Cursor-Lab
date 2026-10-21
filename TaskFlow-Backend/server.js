const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config({ path: '.env.local' });
dotenv.config();

const { assertConfig } = require('./src/config');
const { createApp } = require('./src/app');
const { createLogger } = require('./src/utils/logger');

const logger = createLogger('server');
const PORT = process.env.PORT || 4000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/taskflow';

async function start() {
  // Fail fast on missing auth config instead of 500s on the first login.
  try {
    assertConfig();
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGO_URI, { dbName: 'taskflow' });
    logger.info('Connected to MongoDB');
  } catch (err) {
    logger.error('MongoDB connection error', { errorMessage: err.message });
    process.exit(1);
  }

  createApp().listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
  });
}

start();
