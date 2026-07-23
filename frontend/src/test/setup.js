import "@testing-library/jest-dom";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Unmount between tests so one test's DOM can't leak into the next.
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// react-responsive reads matchMedia, which jsdom doesn't implement.
// Reporting "not mobile" keeps components on their desktop layout.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});