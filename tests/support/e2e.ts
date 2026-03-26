// Cypress support file
import './commands';

// Add global Cypress commands
declare global {
  namespace Cypress {
    interface Chainable {
      // Add custom commands here
    }
  }
}
