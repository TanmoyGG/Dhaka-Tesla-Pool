"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

// Landing-page demo credentials (docs/frontend-design.md §6.6). These are
// INTENTIONALLY PUBLIC: the deployed build is a free public testing/demo
// project, and a reviewer must be able to sign in as a passenger or a driver
// without creating an account.
//
// The three passenger and four driver identities are the canonical PRD cast
// (AGENTS.md): Nusrat / Rafiq / Shirin pool together, and Jashim / Karim /
// Rahim / Faruq cover the first-wins driver-accept race. Their Clerk identities
// live in the demo's Clerk instance and are mapped to the seeded database rows
// by apps/api/scripts/map-cast-clerk-ids.sql — this component only displays
// them and never participates in authentication.
//
// No DRIVER self-registration exists in the MVP: provisioning always creates
// PASSENGER (apps/api/src/auth/user-resolver.ts), and DRIVER/ADMIN are
// database-only assignments. That is why driver testing needs one of these four
// accounts, and the intro copy says so explicitly.
//
// Portaled to <body> for the same reason as the completion modals: the sticky
// header's `backdrop-filter` makes it a containing block for `position: fixed`.
// Unlike the one-time cash-acknowledgement modals, this one is purely
// informational, so Escape and the overlay both dismiss it (no confirmation
// gate — there is nothing to acknowledge).

export interface DemoAccount {
  name: string;
  email: string;
  password: string;
}

const PASSENGERS: DemoAccount[] = [
  { name: "Nusrat", email: "nusrat@example.com", password: "Nusrat@teslapool" },
  { name: "Rafiq", email: "rafiq@example.com", password: "Rafiq@teslapool" },
  { name: "Shirin", email: "shirin@example.com", password: "Shirin@teslapool" },
];

const DRIVERS: DemoAccount[] = [
  { name: "Jashim", email: "jashim@example.com", password: "Jashim@teslapool" },
  { name: "Karim", email: "karim@example.com", password: "Karim@teslapool" },
  { name: "Rahim", email: "rahim@example.com", password: "Rahim@teslapool" },
  { name: "Faruq", email: "faruq@example.com", password: "Faruq@teslapool" },
];

const MASK = "••••••••";
const COPIED_MS = 1600;

export function CredentialsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);

  // Per-field reveal state is transient UI, so it resets whenever the modal
  // closes — reopening never shows a password still revealed from last time.
  useEffect(() => {
    if (open) return;
    setRevealed({});
    setCopied(null);
  }, [open]);

  // Escape closes (informational modal — dismissal is always allowed).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock page scroll while open (app-drawer pattern, same as AppMenu).
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Copy feedback is transient; clear it so the label always returns to "Copy".
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!open) return null;

  function toggleReveal(email: string) {
    setRevealed((state) => ({ ...state, [email]: !state[email] }));
  }

  async function copy(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
    } catch {
      // Clipboard access can be denied (insecure context, permissions). The
      // password is already visible via Reveal, so a silent no-op is correct
      // here — a demo must not surface an error it has no recovery for.
    }
  }

  return createPortal(
    <div className="credentials-modal">
      <div className="credentials-modal-overlay" onClick={onClose} />
      <div
        className="credentials-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="credentials-heading"
      >
        <h2 id="credentials-heading">Credentials for testing</h2>

        <p className="text-muted credentials-intro">
          Want to test as a passenger? Create your own account using Sign Up.
        </p>
        <p className="text-muted credentials-intro">
          Driver registration is not available in this MVP. Use one of the demo
          driver accounts below to test the driver experience.
        </p>

        <CredentialGroup
          title="Passengers"
          accounts={PASSENGERS}
          revealed={revealed}
          copied={copied}
          onToggleReveal={toggleReveal}
          onCopy={copy}
        />
        <CredentialGroup
          title="Drivers"
          accounts={DRIVERS}
          revealed={revealed}
          copied={copied}
          onToggleReveal={toggleReveal}
          onCopy={copy}
        />

        <p className="credentials-note text-muted">
          These are intentionally public demo credentials for this testing build.
        </p>

        <button
          type="button"
          className="btn btn-primary btn-full"
          onClick={onClose}
        >
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}

function CredentialGroup({
  title,
  accounts,
  revealed,
  copied,
  onToggleReveal,
  onCopy,
}: {
  title: string;
  accounts: DemoAccount[];
  revealed: Record<string, boolean>;
  copied: string | null;
  onToggleReveal: (email: string) => void;
  onCopy: (value: string, key: string) => void;
}) {
  return (
    <section className="credentials-group">
      <h3 className="credentials-group-title">{title}</h3>
      <ul className="credentials-list">
        {accounts.map((account) => {
          const isRevealed = revealed[account.email] === true;
          const emailKey = `email:${account.email}`;
          const passwordKey = `password:${account.email}`;

          return (
            <li key={account.email} className="credentials-item">
              <div className="credentials-item-head">
                <span className="credentials-name">{account.name}</span>
                <span className="credentials-field-row">
                  <span className="credentials-value">{account.email}</span>
                  <button
                    type="button"
                    className="credentials-action"
                    onClick={() => onCopy(account.email, emailKey)}
                  >
                    {copied === emailKey ? "Copied" : "Copy email"}
                  </button>
                </span>
                <span className="credentials-field-row">
                  <span className="credentials-value">
                    {isRevealed ? account.password : MASK}
                  </span>
                  <button
                    type="button"
                    className="credentials-action"
                    aria-label={`${
                      isRevealed ? "Hide" : "Reveal"
                    } password for ${account.name}`}
                    onClick={() => onToggleReveal(account.email)}
                  >
                    {isRevealed ? "Hide" : "Show"}
                  </button>
                  <button
                    type="button"
                    className="credentials-action"
                    onClick={() => onCopy(account.password, passwordKey)}
                  >
                    {copied === passwordKey ? "Copied" : "Copy password"}
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
