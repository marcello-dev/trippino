export default {
  testEnvironment: "node",
  transform: {},
  testMatch: ["**/test/**/*.test.js"],
  verbose: true,
  testTimeout: 10000,
  // Don't run background jobs in tests
  globals: {
    SKIP_BACKGROUND_JOBS: true,
  },
};
