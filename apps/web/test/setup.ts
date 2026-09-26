// Test bootstrap: jest-dom matchers (toBeInTheDocument etc.) plus RTL
// auto-cleanup after every test so DOM from one test never leaks into the
// next.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});