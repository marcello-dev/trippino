# Backend Unit Tests

This directory contains comprehensive unit tests for the Trippino backend API.

## Test Structure

- `setup.js` - Test environment configuration
- `helpers.js` - Shared test utilities and database helpers
- `auth.test.js` - Authentication API tests (signup, login, logout, email verification, password change)
- `trips.test.js` - Trip CRUD API tests
- `cities.test.js` - City CRUD API tests and sort order management
- `sessions.test.js` - Session management, expiration, and security tests

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode (re-run on file changes)
npm run test:watch

# Run tests with coverage report
npm run test:coverage
```

## Test Coverage

### Authentication (`auth.test.js`)

- ✅ User signup with validation
- ✅ Email verification flow
- ✅ Login with credentials
- ✅ Session management
- ✅ Logout functionality
- ✅ Password change with session invalidation
- ✅ Session expiration handling

### Trips (`trips.test.js`)

- ✅ Create trip with validation
- ✅ List user trips
- ✅ Get single trip with cities
- ✅ Update trip name and start date
- ✅ Delete trip with CASCADE to cities
- ✅ Authorization (user can only access own trips)
- ✅ Authentication requirements

### Cities (`cities.test.js`)

- ✅ Create city with auto sort order
- ✅ Update city (name, nights, notes)
- ✅ Batch update sort order (move up/down)
- ✅ Delete city
- ✅ Sort order management
- ✅ Trip ownership validation
- ✅ Field validation (nights minimum, etc.)

### Sessions (`sessions.test.js`)

- ✅ Session creation with timestamps
- ✅ Session expiration (7-day timeout)
- ✅ Background cleanup simulation
- ✅ Password change invalidation
- ✅ CASCADE delete on user deletion
- ✅ Multiple sessions per user
- ✅ Session security edge cases

## Test Database

Tests use an in-memory SQLite database that is:

- Created fresh for each test
- Isolated between tests
- Automatically cleaned up after each test
- Does not affect production data

## Environment Variables

Test environment automatically sets:

- `NODE_ENV=test`
- `PORT=0` (random available port)
- `SESSION_SECRET=test-secret-key-for-testing-only`
- `SKIP_EMAIL_SENDING=true` (no real emails sent)
- `SKIP_BACKGROUND_JOBS=true` (no cleanup jobs)

## Test Utilities

The `helpers.js` file provides:

- `createTestDatabase()` - Create in-memory test DB
- `initTestDatabase(run)` - Initialize schema
- `createTestUser(run, email, password, verified)` - Create test user
- `createTestSession(run, userId)` - Create test session
- `createTestTrip(run, userId, name, startDate)` - Create test trip
- `createTestCity(run, tripId, name, nights, sortOrder)` - Create test city
- `extractSessionCookie(response)` - Extract session from response
- `extractCsrfToken(response)` - Extract CSRF token
- `cleanupDatabase(db)` - Close database connection

## Writing New Tests

1. Import helpers: `import { createTestDatabase, initTestDatabase, ... } from './helpers.js'`
2. Set up test database in `beforeEach()`
3. Clean up in `afterEach()` with `cleanupDatabase(db)`
4. Use test utilities to create fixtures
5. Make requests with `supertest`
6. Assert responses and database state

Example:

```javascript
describe("New Feature", () => {
  let app, db, run, get, all;

  beforeEach(async () => {
    const testDb = createTestDatabase();
    db = testDb.db;
    run = testDb.run;
    get = testDb.get;
    all = testDb.all;

    await initTestDatabase(run);

    // Set up Express app...
  });

  afterEach(async () => {
    await cleanupDatabase(db);
  });

  it("should do something", async () => {
    const user = await createTestUser(run);
    const sid = await createTestSession(run, user.id);

    const response = await request(app)
      .get("/api/endpoint")
      .set("Cookie", `trippino_sid=${sid}`);

    expect(response.status).toBe(200);
  });
});
```

## CI/CD Integration

Tests can be integrated into CI/CD pipelines:

```yaml
# GitHub Actions example
- name: Run tests
  run: npm test

- name: Upload coverage
  run: npm run test:coverage
```

## Notes

- Tests are isolated and can run in parallel
- Each test file contains self-contained Express app setup
- CSRF protection is not included in test apps for simplicity
- Rate limiting is not applied in tests
- Email sending is mocked (SKIP_EMAIL_SENDING=true)
- Background jobs are disabled (SKIP_BACKGROUND_JOBS=true)
