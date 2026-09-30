// Sign-in-page demo auto-fill. Clerk owns the form; this feature only types into
// it. The Clerk component is mocked with a structure matching its documented
// sign-in markup (identifier input, password input, submit row inside the form,
// and a "…Sign up" footer outside it), because jsdom cannot boot clerk.js.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import Link from "next/link";
import SignInPage from "@/app/(auth)/sign-in/[[...sign-in]]/page";
import { DEMO_DRIVERS, DEMO_PASSENGERS } from "@/components/credentials-modal";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: { children: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock("@clerk/nextjs", () => ({
  SignIn: () => (
    <div className="cl-rootBox">
      <div className="cl-cardBox">
        <form aria-label="Sign in">
          <input name="identifier" aria-label="Email" />
          <input type="password" aria-label="Password" />
          <div className="cl-formButtonRow">
            <button type="submit">Continue</button>
          </div>
        </form>
        <div className="cl-footer">
          Don&apos;t have an account? <Link href="/sign-up">Sign up</Link>
        </div>
      </div>
    </div>
  ),
}));

function identifier() {
  return screen.getByLabelText("Email") as HTMLInputElement;
}

function password() {
  return screen.getByLabelText("Password") as HTMLInputElement;
}

async function openPicker() {
  const trigger = await screen.findByRole("button", {
    name: /auto-fill demo credentials/i,
  });
  fireEvent.click(trigger);
  return screen.getByRole("dialog");
}

describe("sign-in demo auto-fill", () => {
  it("places the button after Continue and before the sign-up footer", async () => {
    render(<SignInPage />);
    const trigger = await screen.findByRole("button", {
      name: /auto-fill demo credentials/i,
    });

    const card = screen.getByText("Continue").closest(".cl-cardBox")!;
    const submitRow = screen.getByText("Continue").closest(".cl-formButtonRow")!;
    const footer = card.querySelector(".cl-footer")!;

    // Below the submit row...
    expect(
      submitRow.compareDocumentPosition(trigger.parentElement!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // ...and above the "…Sign up" footer.
    expect(
      trigger.parentElement!.compareDocumentPosition(footer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("lists the demo cast grouped by role without leaking any credential", async () => {
    render(<SignInPage />);
    const dialog = await openPicker();

    expect(within(dialog).getByText("Passengers")).toBeInTheDocument();
    expect(within(dialog).getByText("Drivers")).toBeInTheDocument();

    for (const account of [...DEMO_PASSENGERS, ...DEMO_DRIVERS]) {
      expect(within(dialog).getByText(account.name)).toBeInTheDocument();
    }
    expect(within(dialog).getAllByRole("button", { name: "Auto-fill" })).toHaveLength(7);

    // The picker must never display the credentials themselves, and must not
    // offer the reveal/copy controls the landing modal has.
    const text = dialog.textContent ?? "";
    for (const account of [...DEMO_PASSENGERS, ...DEMO_DRIVERS]) {
      expect(text).not.toContain(account.email);
      expect(text).not.toContain(account.password);
    }
    expect(within(dialog).queryByRole("button", { name: /copy/i })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: /show|hide/i })).toBeNull();
  });

  it("fills the Clerk form without submitting it", async () => {
    const onSubmit = vi.fn((event: Event) => event.preventDefault());
    render(<SignInPage />);
    const form = screen.getByLabelText("Sign in");
    form.addEventListener("submit", onSubmit);

    const dialog = await openPicker();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Auto-fill" })[0]);

    // Nusrat is the first passenger.
    await waitFor(() => expect(identifier().value).toBe("nusrat@example.com"));
    expect(password().value).toBe("Nusrat@teslapool");

    // The picker is gone and nothing was submitted: the user still clicks
    // Continue themselves.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("fills whichever demo identity was picked", async () => {
    render(<SignInPage />);

    const dialog = await openPicker();
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Auto-fill" })[0]);

    const next = await openPicker();
    fireEvent.click(within(next).getAllByRole("button", { name: "Auto-fill" })[6]);

    // Faruq is the last driver.
    await waitFor(() => expect(identifier().value).toBe("faruq@example.com"));
    expect(password().value).toBe("Faruq@teslapool");
  });

  it("closes without touching the form", async () => {
    render(<SignInPage />);

    const dialog = await openPicker();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(identifier().value).toBe("");
    expect(password().value).toBe("");
  });

  it("closes on Escape", async () => {
    render(<SignInPage />);
    await openPicker();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
