import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:3000",
    // These tests drive the real app against the real API and database, so
    // they need longer than a unit test would.
    defaultCommandTimeout: 10000,
    requestTimeout: 15000,
    video: false,
    screenshotOnRunFailure: true,
    viewportWidth: 1400,
    viewportHeight: 900,
    supportFile: "cypress/support/e2e.js",
  },
});
