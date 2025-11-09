/**
 * Test Setup
 * Runs before all tests to configure the test environment
 */

// Set test environment variables
process.env.NODE_ENV = "test";
process.env.PORT = "0"; // Use random available port
process.env.SESSION_SECRET = "test-secret-key-for-testing-only";
process.env.SKIP_EMAIL_SENDING = "true"; // Don't send real emails in tests
process.env.SKIP_BACKGROUND_JOBS = "true"; // Don't run cleanup jobs in tests

// Mock console methods to reduce noise in test output (optional)
// Uncomment if you want quieter tests
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
// };
