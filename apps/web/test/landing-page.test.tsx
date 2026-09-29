// Landing-page action layout (frontend-design.md §3, §3.1). The two primary
// auth buttons stay together in the "Get started" nav; "Credentials for
// Testing" is a secondary control rendered *after* that nav, on its own line.
// jsdom has no layout engine, so this asserts DOM order/siblingry — the
// structural contract the centering CSS (.landing-secondary) then styles — not
// pixel geometry.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import HomePage from "@/app/(main)/page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: () => undefined }),
}));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
}));
vi.mock("@/lib/queries", () => ({
  useMe: () => ({ isLoading: false, isError: false, isSuccess: false }),
}));

describe("HomePage action layout", () => {
  it("keeps both primary auth buttons inside the get-started nav", () => {
    render(<HomePage />);

    const nav = screen.getByRole("navigation", { name: "Get started" });
    const links = Array.from(nav.querySelectorAll("a"));
    expect(links.map((l) => l.textContent)).toEqual([
      "Create an account",
      "Sign in",
    ]);
  });

  it("places the credentials button after the nav, not beside the auth buttons", () => {
    render(<HomePage />);

    const nav = screen.getByRole("navigation", { name: "Get started" });
    const button = screen.getByRole("button", { name: "Credentials for Testing" });

    expect(nav.contains(button)).toBe(false);
    expect(nav.nextElementSibling).toBe(button.parentElement);
    expect(button.parentElement).toHaveClass("landing-secondary");
  });
});
