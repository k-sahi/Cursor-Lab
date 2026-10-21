module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setupEnv.js'],
  // Route tests start a server and talk to MongoDB; give them room on slow CI runners.
  testTimeout: 20000,
};
