# E2E Test Setup

## Installation

Install the required dependencies:

```bash
npm install
```

## Running Tests

### Playwright Tests
```bash
# Run all tests
npm run test:e2e

# Run tests with UI
npm run test:e2e:ui

# Run tests in headed mode
npm run test:e2e:headed
```

### Cypress Tests
```bash
# Open Cypress test runner
npm run test:cypress

# Run tests in headless mode
npm run test:cypress:headless
```

## Configuration

- **Playwright**: Configured in `playwright.config.ts`
- **Cypress**: Configured in `cypress.config.ts`

## Test Structure

- `e2e/full-journey.spec.ts` - Playwright end-to-end tests
- `e2e/full-journey-cypress.cy.ts` - Cypress end-to-end tests

## Coverage

The test suites cover:
- ✅ Navigation and routing
- ✅ CRUD operations (Projects, Units, Payments)
- ✅ Form validation
- ✅ Search and filtering
- ✅ Network error handling
- ✅ Accessibility testing
- ✅ Performance monitoring
- ✅ Data integrity validation

## Notes

- Tests are configured to run against `http://localhost:3000`
- Electron-specific configuration is included
- Video recording and screenshots are enabled on failure
- Tests use stable selectors with `data-testid` attributes
