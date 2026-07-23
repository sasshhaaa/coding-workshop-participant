import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
  },
  test: {
    globals: true,
    // Component tests need a DOM; jsdom provides one without a real browser.
    environment: "jsdom",
    setupFiles: "./src/test/setup.js",
    css: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{js,jsx}"],
      exclude: [
        "src/main.jsx",        // entry point, nothing to assert
        "src/theme.js",        // design tokens, no logic
        "src/test/**",
        "**/*.test.jsx",
      ],
    },
  },
});