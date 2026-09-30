"use client";

import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  DEMO_DRIVERS,
  DEMO_PASSENGERS,
  type DemoAccount,
} from "./credentials-modal";

// Sign-in-page demo shortcut (docs/frontend-design.md §3.1). Reviewers testing
// the demo should not have to read a password off the landing page and type it
// back in: the sign-in page gets one quiet secondary button that opens a picker
// of the canonical PRD cast, and "Auto-fill" types that identity into the
// sign-in form.
//
// Clerk still owns the entire form. Nothing here authenticates, validates or
// submits anything — it is the same text a person would have typed. Clerk's
// password field has no supported setter (`initialValues` intentionally covers
// only email/username/phone), so the values are written into the real inputs.
//
// Placement: the button has to sit between Clerk's "Continue" submit button and
// Clerk's own "Don't have an account? Sign up" footer, which are both inside
// Clerk's DOM. So the button is rendered through a portal into a small anchor
// node that is inserted next to the submit row once Clerk has mounted. If the
// markup ever moves, the anchor simply falls back to just after the <form> —
// still below Continue, still above the sign-up footer.

/**
 * Write a value into a React-controlled input the way a keystroke would.
 *
 * React caches the previous value on the DOM node, so assigning `input.value`
 * directly is swallowed as "no change". Going through the prototype's native
 * setter and then dispatching `input` produces the exact sequence React's own
 * onChange handler expects, which is what Clerk listens to.
 */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * Clerk's identifier (email) input. The `name="identifier"` selector is what
 * Clerk documents for its sign-in form; the autocomplete/type selectors are
 * fallbacks so a Clerk markup change degrades to "still works" rather than
 * "silently fills nothing".
 */
function findIdentifierInput(root: HTMLElement): HTMLInputElement | null {
  const selectors = [
    'input[name="identifier"]',
    'input[autocomplete="username"]',
    'input[type="email"]',
  ];
  for (const selector of selectors) {
    const input = root.querySelector<HTMLInputElement>(selector);
    if (input) return input;
  }
  return null;
}

function findPasswordInput(root: HTMLElement): HTMLInputElement | null {
  return root.querySelector<HTMLInputElement>('input[type="password"]');
}

export function SignInDemoAutofill({
  cardRef,
}: {
  /** The `.auth-card` wrapper holding Clerk's sign-in form. */
  cardRef: RefObject<HTMLElement | null>;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const node = document.createElement("div");
    node.className = "signin-demo-autofill";

    const place = (): boolean => {
      if (node.isConnected) return true;
      // Clerk renders on the client after clerk.js loads, so the form is often
      // not in the DOM yet when this effect first runs.
      const form = card.querySelector("form");
      if (!form) return false;
      const submit = form.querySelector('button[type="submit"]');
      const host = submit?.parentElement ?? form;
      host.insertAdjacentElement("afterend", node);
      setAnchor(node);
      return true;
    };

    if (place()) {
      return () => node.remove();
    }

    const observer = new MutationObserver(() => {
      if (place()) observer.disconnect();
    });
    observer.observe(card, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      node.remove();
    };
  }, [cardRef]);

  function fill(account: DemoAccount) {
    const card = cardRef.current;
    if (card) {
      const identifier = findIdentifierInput(card);
      const password = findPasswordInput(card);
      // Each field is independent: if one is missing (a Clerk flow without a
      // password step, say) the other still gets filled and the user types the
      // rest. Never submit — Continue stays the user's click.
      if (identifier) typeInto(identifier, account.email);
      if (password) typeInto(password, account.password);
    }
    setOpen(false);
  }

  return (
    <>
      {anchor &&
        createPortal(
          <button
            type="button"
            className="btn btn-secondary btn-full"
            onClick={() => setOpen(true)}
          >
            Auto-fill demo credentials
          </button>,
          anchor,
        )}
      {open && (
        <DemoPicker
          onClose={() => setOpen(false)}
          onPick={fill}
        />
      )}
    </>
  );
}

// Same visual language as the landing-page credentials modal (it reuses those
// exact classes), but deliberately shows only the identities: no emails, no
// passwords, no Show and no Copy — the whole point is to fill the form, not to
// read credentials off the screen.
function DemoPicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (account: DemoAccount) => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  return createPortal(
    <div className="credentials-modal">
      <div className="credentials-modal-overlay" onClick={onClose} />
      <div
        className="credentials-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-autofill-heading"
      >
        <h2 id="demo-autofill-heading">Auto-fill demo credentials</h2>

        <p className="text-muted credentials-intro">
          Pick an identity to fill the form with. Nothing is signed in until you
          press Continue.
        </p>

        <DemoGroup title="Passengers" accounts={DEMO_PASSENGERS} onPick={onPick} />
        <DemoGroup title="Drivers" accounts={DEMO_DRIVERS} onPick={onPick} />

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

function DemoGroup({
  title,
  accounts,
  onPick,
}: {
  title: string;
  accounts: DemoAccount[];
  onPick: (account: DemoAccount) => void;
}) {
  return (
    <section className="credentials-group">
      <h3 className="credentials-group-title">{title}</h3>
      <ul className="credentials-list">
        {accounts.map((account) => (
          <li key={account.email} className="credentials-item">
            <div className="credentials-fill-row">
              <span className="credentials-fill-name">{account.name}</span>
              <button
                type="button"
                className="credentials-action"
                onClick={() => onPick(account)}
              >
                Auto-fill
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
