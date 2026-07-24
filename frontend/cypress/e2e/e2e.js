// Signing in through the form on every test would triple the runtime and
// test the login page over and over. It's covered once, properly, in the
// critical path spec; everywhere else takes the fast route.
Cypress.Commands.add("signIn", (email, password) => {
  cy.visit("/");
  cy.contains("Sign in").should("be.visible");
  cy.get('input[type="email"]').type(email);
  cy.get('input[type="password"]').type(password);
  cy.contains("button", "Sign in").click();
  cy.contains("Organisation health", { timeout: 15000 }).should("be.visible");
});

// A fresh name per run, so re-running the suite doesn't collide with records
// left behind by a previous run.
Cypress.Commands.add("uniqueName", (prefix) => {
  return cy.wrap(`${prefix} ${Date.now().toString().slice(-6)}`);
});