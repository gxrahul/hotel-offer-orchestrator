const baseConfig = require('./jest.config');

module.exports = {
  ...baseConfig,
  roots: ['<rootDir>/test/integration'],
  testPathIgnorePatterns: ['/node_modules/'],
};
