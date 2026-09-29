// CredentialsModal — the public demo-credentials dialog on the signed-out
// landing page (frontend-design.md §6.6). These credentials are intentionally
// public, so the test asserts the full set is present and usable; it verifies
// copy/reveal through the rendered UI and never asserts on clipboard internals
// beyond the value handed to the API.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { CredentialsModal } from "@/components/credentials-modal";

const writeText = vi.fn<(text: string) => Promise<void>>();

function renderOpen() {
  return render(<CredentialsModal open onClose={vi.fn()} />);
}

describe("CredentialsModal", () => {
  beforeEach(() => {
    writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders nothing while closed", () => {
    render(<CredentialsModal open={false} onClose={vi.fn()} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens with the dialog semantics and both intro messages", () => {
    renderOpen();

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      screen.getByRole("heading", { name: "Credentials for testing" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/create your own account using sign up/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/driver registration is not available in this mvp/i),
    ).toBeInTheDocument();
  });

  it("locks body scroll while open and restores it on close", () => {
    const { rerender } = renderOpen();
    expect(document.body.style.overflow).toBe("hidden");

    rerender(<CredentialsModal open={false} onClose={vi.fn()} />);
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("closes on the Close button, the overlay, and Escape", () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <CredentialsModal open onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(
      document.querySelector(".credentials-modal-overlay") as HTMLElement,
    );
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);

    // Dismissing hides the dialog once the parent reflects the closed state.
    rerender(<CredentialsModal open={false} onClose={onClose} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders the passenger and driver groups with all seven accounts", () => {
    renderOpen();

    const passengers = screen.getByRole("heading", { name: "Passengers" });
    const drivers = screen.getByRole("heading", { name: "Drivers" });
    expect(passengers).toBeInTheDocument();
    expect(drivers).toBeInTheDocument();

    for (const email of [
      "nusrat@example.com",
      "rafiq@example.com",
      "shirin@example.com",
      "jashim@example.com",
      "karim@example.com",
      "rahim@example.com",
      "faruq@example.com",
    ]) {
      expect(screen.getByText(email)).toBeInTheDocument();
    }

    // Seven credential rows: one per account, not one per field.
    expect(document.querySelectorAll(".credentials-item")).toHaveLength(7);
  });

  it("masks passwords until revealed, then shows them", () => {
    renderOpen();

    // Every password starts masked.
    expect(screen.queryByText("Nusrat@teslapool")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Reveal password for Nusrat" }),
    );
    expect(screen.getByText("Nusrat@teslapool")).toBeInTheDocument();

    // Reveal is per-account: the others stay hidden.
    expect(screen.queryByText("Rafiq@teslapool")).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Hide password for Nusrat" }),
    );
    expect(screen.queryByText("Nusrat@teslapool")).not.toBeInTheDocument();
  });

  it("hides revealed passwords again after a close/reopen cycle", () => {
    const onClose = vi.fn();
    const { rerender } = render(<CredentialsModal open onClose={onClose} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Reveal password for Jashim" }),
    );
    expect(screen.getByText("Jashim@teslapool")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    rerender(<CredentialsModal open={false} onClose={onClose} />);
    rerender(<CredentialsModal open onClose={onClose} />);

    expect(screen.queryByText("Jashim@teslapool")).not.toBeInTheDocument();
  });

  it("copies an email and confirms it", async () => {
    renderOpen();

    const row = screen.getByText("rafiq@example.com").closest(
      ".credentials-field-row",
    ) as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Copy email" }));

    expect(writeText).toHaveBeenCalledWith("rafiq@example.com");
    expect(
      await within(row).findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
  });

  it("copies a revealed password and confirms it", async () => {
    renderOpen();

    const row = screen.getByText("karim@example.com").closest(
      ".credentials-item",
    ) as HTMLElement;
    fireEvent.click(
      within(row).getByRole("button", { name: "Reveal password for Karim" }),
    );
    fireEvent.click(within(row).getByRole("button", { name: "Copy password" }));

    expect(writeText).toHaveBeenCalledWith("Karim@teslapool");
    expect(
      await within(row).findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
  });

  it("survives a denied clipboard without breaking the modal", async () => {
    writeText.mockRejectedValueOnce(new Error("clipboard blocked"));
    renderOpen();

    const row = screen.getByText("shirin@example.com").closest(
      ".credentials-field-row",
    ) as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Copy email" }));

    // No "Copied" confirmation, but the dialog stays usable and the button
    // returns to its normal label.
    expect(
      within(row).getByRole("button", { name: "Copy email" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("states the credentials are intentionally public", () => {
    renderOpen();
    expect(
      screen.getByText(/intentionally public demo credentials/i),
    ).toBeInTheDocument();
  });
});
